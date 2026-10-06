// services/predictions.js — predicciones con puntos (como las de Twitch).
//
// El streamer crea una pregunta con 2 a 4 respuestas desde el panel. Durante
// los segundos que elija, los viewers apuestan puntos a una respuesta desde la
// pagina de canje (una respuesta por viewer; puede subir su apuesta). Luego se
// cierra y el streamer marca la respuesta ganadora: quienes acertaron se
// reparten TODO lo apostado, en proporcion a lo que puso cada uno. Si nadie
// acerto, o si el streamer la cancela, se devuelve todo.
// Solo hay una prediccion activa (abierta o cerrada sin resultado) a la vez.
const { randomUUID } = require("node:crypto")

const MIN_BET = 100
const MAX_BET = 500_000
const MIN_SECONDS = 30
const MAX_SECONDS = 900
const MAX_QUESTION = 120
const MAX_OPTION = 40
const SHOW_FINISHED_MS = 15 * 60_000 // la pagina ensena el resultado este rato
const STALE_MS = 24 * 60 * 60_000 // sin resultado en 24 h: se cancela sola y se devuelve todo

function createPredictions({ platform, getChannel, onResolved = () => {}, now = Date.now }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso(ms) { return new Date(ms).toISOString() }

  function rowById(id) {
    return db.prepare("SELECT * FROM predictions WHERE id=? AND channel_id=?").get(String(id || ""), activeChannel()) || null
  }

  // Abierta pasa a cerrada sola cuando se acaba el tiempo.
  function statusOf(row) {
    return row.status === "open" && Date.parse(row.locks_at) <= now() ? "locked" : row.status
  }

  function activeRow() {
    const row = db.prepare("SELECT * FROM predictions WHERE channel_id=? AND status IN ('open','locked') ORDER BY created_at DESC LIMIT 1").get(activeChannel())
    if (row && now() - Date.parse(row.created_at) > STALE_MS) { refundAll(row, "Predicción sin resultado (devuelta)"); return null }
    return row || null
  }

  function lastRow() {
    return db.prepare("SELECT * FROM predictions WHERE channel_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(activeChannel()) || null
  }

  function bets(id) {
    return db.prepare("SELECT * FROM prediction_bets WHERE prediction_id=?").all(id)
  }

  function totals(row) {
    const options = JSON.parse(row.options_json)
    const list = options.map(label => ({ label, total: 0, bettors: 0 }))
    for (const bet of bets(row.id)) {
      if (!list[bet.option_index]) continue
      list[bet.option_index] = { ...list[bet.option_index], total: list[bet.option_index].total + bet.amount, bettors: list[bet.option_index].bettors + 1 }
    }
    return list
  }

  function publicPrediction(row, viewerId = null) {
    const options = totals(row)
    const mine = viewerId ? db.prepare("SELECT option_index, amount, payout FROM prediction_bets WHERE prediction_id=? AND viewer_id=?").get(row.id, viewerId) : null
    return {
      id: row.id, question: row.question, status: statusOf(row), options, winner: row.winner,
      pool: options.reduce((sum, option) => sum + option.total, 0), locksAt: row.locks_at, resolvedAt: row.resolved_at,
      minBet: MIN_BET, maxBet: MAX_BET,
      myBet: mine ? { option: mine.option_index, amount: mine.amount, payout: mine.payout } : null,
    }
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function cleanOptions(options) {
    const list = (Array.isArray(options) ? options : []).map(option => String(option || "").trim()).filter(Boolean)
    if (list.length < 2 || list.length > 4) throw new Error("Pon de 2 a 4 respuestas")
    if (list.some(option => option.length > MAX_OPTION)) throw new Error(`Cada respuesta puede tener hasta ${MAX_OPTION} letras`)
    if (new Set(list.map(option => option.toLowerCase())).size !== list.length) throw new Error("Hay respuestas repetidas")
    return list
  }

  function create({ question, options, seconds } = {}) {
    const text = String(question || "").trim()
    if (!text || text.length > MAX_QUESTION) throw new Error(`Escribe la pregunta (hasta ${MAX_QUESTION} letras)`)
    const list = cleanOptions(options)
    const duration = Number(seconds)
    if (!Number.isInteger(duration) || duration < MIN_SECONDS || duration > MAX_SECONDS) throw new Error(`El tiempo para apostar va de ${MIN_SECONDS} a ${MAX_SECONDS} segundos`)
    if (activeRow()) throw new Error("Ya hay una predicción activa. Resuélvela o cancélala antes de crear otra.")
    const id = randomUUID()
    db.prepare("INSERT INTO predictions(id, channel_id, question, options_json, status, created_at, locks_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, activeChannel(), text, JSON.stringify(list), "open", iso(now()), iso(now() + duration * 1000))
    return summary()
  }

  function requireActive(id) {
    const row = rowById(id)
    if (!row || (row.status !== "open" && row.status !== "locked")) throw new Error("Esa predicción ya terminó")
    return row
  }

  function lock(id) {
    const row = requireActive(id)
    db.prepare("UPDATE predictions SET status='locked', locks_at=? WHERE id=?").run(iso(Math.min(now(), Date.parse(row.locks_at))), row.id)
    return summary()
  }

  function pay(row, bet, amount, reason) {
    if (amount < 1) return
    platform.economy.applyMovement({
      channelId: row.channel_id, viewerId: bet.viewer_id, balanceDelta: amount, idempotencyKey: `prediccion-pago:${row.id}:${bet.viewer_id}`,
      reason, sourceType: "prediction", sourceId: row.id,
    })
    db.prepare("UPDATE prediction_bets SET payout=? WHERE prediction_id=? AND viewer_id=?").run(amount, row.id, bet.viewer_id)
  }

  // Ganadores: se reparten todo el bote en proporcion a lo apostado.
  // Sin ganadores, cada uno recupera lo suyo.
  function resolve(id, winner) {
    const row = requireActive(id)
    if (statusOf(row) === "open") throw new Error("Primero cierra las apuestas (!cerrarpred) o espera a que se acabe el tiempo")
    const options = JSON.parse(row.options_json)
    const index = Number(winner)
    if (!Number.isInteger(index) || index < 0 || index >= options.length) throw new Error("Elige la respuesta ganadora")
    const all = bets(row.id)
    const pool = all.reduce((sum, bet) => sum + bet.amount, 0)
    const winners = all.filter(bet => bet.option_index === index)
    const winningPool = winners.reduce((sum, bet) => sum + bet.amount, 0)
    db.transaction(() => {
      if (!winningPool) for (const bet of all) pay(row, bet, bet.amount, "Predicción sin ganadores (devuelta)")
      else for (const bet of winners) pay(row, bet, Math.floor((bet.amount * pool) / winningPool), "Predicción acertada")
      db.prepare("UPDATE predictions SET status='resolved', winner=?, resolved_at=? WHERE id=?").run(index, iso(now()), row.id)
    })()
    try { onResolved() } catch (error) { /* el resumen nunca debe romper esto */ }
    return summary()
  }

  function refundAll(row, reason) {
    db.transaction(() => {
      for (const bet of bets(row.id)) pay(row, bet, bet.amount, reason)
      db.prepare("UPDATE predictions SET status='cancelled', resolved_at=? WHERE id=?").run(iso(now()), row.id)
    })()
  }

  function cancel(id) {
    refundAll(requireActive(id), "Predicción cancelada (devuelta)")
    return summary()
  }

  // Para el panel: la activa (o la ultima) con totales.
  function summary() {
    const row = activeRow() || lastRow()
    return { prediction: row ? publicPrediction(row) : null, limits: { minBet: MIN_BET, maxBet: MAX_BET, minSeconds: MIN_SECONDS, maxSeconds: MAX_SECONDS } }
  }

  // ── Pagina ───────────────────────────────────────────────────────────────
  // La activa, o la ultima terminada si acabo hace poco.
  function view(viewerId) {
    const row = activeRow() || lastRow()
    if (!row) return null
    const finished = row.status === "resolved" || row.status === "cancelled"
    if (finished && now() - Date.parse(row.resolved_at) > SHOW_FINISHED_MS) return null
    return publicPrediction(row, viewerId)
  }

  // Apuesta `amount` mas a `option`. `key`: clave del navegador (un reintento no cobra dos veces).
  function bet(viewerId, id, option, amount, key) {
    const row = rowById(id)
    if (!row || statusOf(row) !== "open") return { ok: false, reason: "closed" }
    const options = JSON.parse(row.options_json)
    const index = Number(option)
    if (!Number.isInteger(index) || index < 0 || index >= options.length) return { ok: false, reason: "bad-option" }
    const points = Number(amount)
    if (!Number.isInteger(points) || points < 1) return { ok: false, reason: "bad-amount" }
    const ledgerKey = `prediccion:${row.id}:${viewerId}:${key}`
    if (db.prepare("SELECT 1 FROM economy_ledger WHERE idempotency_key=?").get(ledgerKey)) return { ok: true, prediction: publicPrediction(row, viewerId) }
    const current = db.prepare("SELECT * FROM prediction_bets WHERE prediction_id=? AND viewer_id=?").get(row.id, viewerId)
    if (current && current.option_index !== index) return { ok: false, reason: "other-option" }
    const total = (current ? current.amount : 0) + points
    if (total < MIN_BET) return { ok: false, reason: "min" }
    if (total > MAX_BET) return { ok: false, reason: "max" }
    try {
      db.transaction(() => {
        platform.economy.applyMovement({
          channelId: row.channel_id, viewerId, balanceDelta: -points, idempotencyKey: ledgerKey,
          reason: `Predicción: ${options[index]}`.slice(0, 200), sourceType: "prediction", sourceId: row.id,
        })
        if (current) db.prepare("UPDATE prediction_bets SET amount=? WHERE prediction_id=? AND viewer_id=?").run(total, row.id, viewerId)
        else db.prepare("INSERT INTO prediction_bets(prediction_id, viewer_id, option_index, amount, created_at) VALUES(?,?,?,?,?)").run(row.id, viewerId, index, total, iso(now()))
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
    return { ok: true, prediction: publicPrediction(row, viewerId) }
  }

  return { create, lock, resolve, cancel, summary, view, bet }
}

let defaultPredictions = null
function getDefaultPredictions() {
  if (!defaultPredictions) {
    defaultPredictions = createPredictions({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      onResolved: () => require("./stream-recap.js").getDefaultStreamRecap().bump("predictions"),
    })
  }
  return defaultPredictions
}

module.exports = { createPredictions, getDefaultPredictions, MIN_BET, MAX_BET, MIN_SECONDS, MAX_SECONDS }
