// services/support.js — "Apoya el proyecto": enlace de propinas, aportes que
// el streamer apunta a mano y los tops de la pagina de canje (los mas ricos y
// los que mas han apoyado).
//
// Mimiku no lee nada de StreamElements: el streamer ve la propina alli y la
// apunta aqui. Guardar el aporte y dar los puntos va en una sola transaccion;
// deshacerlo quita los mismos puntos (si el viewer aun los tiene).
const { randomUUID } = require("node:crypto")
const { KNOWN_BOTS } = require("../core/known-bots.js")

const CONFIG_KEY = "support"
const DEFAULT_POINTS_PER_USD = 500_000 // 1M de puntos por cada 2 dolares
const MAX_POINTS_PER_USD = 10_000_000
const MAX_AMOUNT_CENTS = 1_000_000 // 10.000 dolares por aporte
const MAX_TIP_URL = 300
const MAX_NOTE = 120
const TOP_RICH = 20
const TOP_DONORS = 10
const RECENT_DONATIONS = 30
const PLATFORMS = ["twitch", "tiktok", "youtube", "kick"]
// Los bots de chat no compiten en el top de ricos.
const NOT_A_BOT = `LOWER(i.username) NOT IN (${KNOWN_BOTS.map(() => "?").join(", ")})`

function cleanTipUrl(value) {
  const text = String(value || "").trim()
  if (!text) return ""
  let parsed
  try { parsed = new URL(text) } catch { throw new Error("El enlace de propinas no es válido") }
  if (parsed.protocol !== "https:") throw new Error("El enlace de propinas debe empezar con https://")
  if (parsed.href.length > MAX_TIP_URL) throw new Error("El enlace de propinas es demasiado largo")
  return parsed.href
}

function cleanPointsPerUsd(value) {
  const points = Number(value)
  if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS_PER_USD) {
    throw new Error(`Los puntos por dólar deben ser un número entero entre 0 y ${MAX_POINTS_PER_USD.toLocaleString("es")}`)
  }
  return points
}

// Dolares (con hasta 2 decimales) a centavos; 0 si no es un importe valido.
function toCents(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return 0
  const cents = Math.round(value * 100)
  return cents >= 1 && cents <= MAX_AMOUNT_CENTS ? cents : 0
}

function createSupport({ platform, getChannel }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    const points = Number(saved.pointsPerUsd)
    return {
      tipUrl: typeof saved.tipUrl === "string" ? saved.tipUrl : "",
      pointsPerUsd: Number.isInteger(points) && points >= 0 && points <= MAX_POINTS_PER_USD ? points : DEFAULT_POINTS_PER_USD,
    }
  }

  function setConfig(input = {}) {
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, {
      tipUrl: cleanTipUrl(input.tipUrl),
      pointsPerUsd: cleanPointsPerUsd(input.pointsPerUsd ?? DEFAULT_POINTS_PER_USD),
    })
    return getConfig()
  }

  function pointsFor(cents) {
    return Math.floor((cents * getConfig().pointsPerUsd) / 100)
  }

  // Apunta un aporte y da los puntos. `username`: usuario tal como sale en el
  // chat de esa plataforma. Devuelve { ok, reason?, donation? }.
  function registerDonation({ username, platform: platformName = "twitch", amount, note = "" } = {}) {
    const cents = toCents(amount)
    if (!cents) return { ok: false, reason: "bad-amount" }
    const source = String(platformName || "").toLowerCase()
    if (!PLATFORMS.includes(source)) return { ok: false, reason: "bad-platform" }
    const viewer = platform.identities.byUsername(String(username || ""), source)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const channelId = activeChannel()
    const id = randomUUID()
    const points = pointsFor(cents)
    const usd = (cents / 100).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    db.transaction(() => {
      db.prepare("INSERT INTO support_donations(id, channel_id, viewer_id, amount_cents, points, note) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, channelId, viewer.id, cents, points, String(note || "").trim().slice(0, MAX_NOTE))
      if (points > 0) {
        platform.economy.applyMovement({
          channelId, viewerId: viewer.id, balanceDelta: points, idempotencyKey: `support:${id}`,
          reason: `Apoyo al proyecto: ${usd} USD`, sourceType: "support", sourceId: id,
        })
      }
    })()
    return { ok: true, donation: { id, viewer: viewer.display || viewer.username, amountUsd: cents / 100, points } }
  }

  // Quita el aporte del top y los puntos que dio. Falla con "spent" si el
  // viewer ya no tiene esos puntos en la cartera.
  function undoDonation(id) {
    const channelId = activeChannel()
    const row = db.prepare("SELECT * FROM support_donations WHERE id=? AND channel_id=? AND undone_at IS NULL").get(String(id || ""), channelId)
    if (!row) return { ok: false, reason: "gone" }
    try {
      db.transaction(() => {
        if (row.points > 0) {
          platform.economy.applyMovement({
            channelId, viewerId: row.viewer_id, balanceDelta: -row.points, idempotencyKey: `support-undo:${row.id}`,
            reason: "Aporte de apoyo deshecho", sourceType: "support", sourceId: row.id,
          })
        }
        db.prepare("UPDATE support_donations SET undone_at=datetime('now') WHERE id=?").run(row.id)
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "spent" }
      throw error
    }
    return { ok: true }
  }

  function listDonations(limit = RECENT_DONATIONS) {
    return db.prepare(`SELECT d.id, d.amount_cents, d.points, d.note, d.created_at, i.display, i.username, i.platform
      FROM support_donations d JOIN viewer_identities i ON i.id=d.viewer_id
      WHERE d.channel_id=? AND d.undone_at IS NULL ORDER BY d.created_at DESC, d.rowid DESC LIMIT ?`)
      .all(activeChannel(), limit)
      .map(row => ({
        id: row.id, viewer: row.display || row.username, platform: row.platform,
        amountUsd: row.amount_cents / 100, points: row.points, note: row.note, at: row.created_at,
      }))
  }

  function topDonors(limit = TOP_DONORS) {
    return db.prepare(`SELECT d.viewer_id, SUM(d.amount_cents) AS total, i.display, i.username, i.platform
      FROM support_donations d JOIN viewer_identities i ON i.id=d.viewer_id
      WHERE d.channel_id=? AND d.undone_at IS NULL
      GROUP BY d.viewer_id ORDER BY total DESC, MIN(d.created_at) LIMIT ?`)
      .all(activeChannel(), limit)
      .map((row, index) => ({ rank: index + 1, viewerId: row.viewer_id, name: row.display || row.username, platform: row.platform, amountUsd: row.total / 100 }))
  }

  // Los que mas puntos tienen: cartera + banco.
  function richest(limit = TOP_RICH) {
    return db.prepare(`SELECT w.viewer_id, w.balance + w.bank_balance AS total, i.display, i.username, i.platform
      FROM wallets w JOIN viewer_identities i ON i.id=w.viewer_id
      WHERE w.channel_id=? AND w.balance + w.bank_balance > 0 AND ${NOT_A_BOT}
      ORDER BY total DESC, i.created_at LIMIT ?`)
      .all(activeChannel(), ...KNOWN_BOTS, limit)
      .map((row, index) => ({ rank: index + 1, viewerId: row.viewer_id, name: row.display || row.username, platform: row.platform, points: row.total }))
  }

  // Puesto de un viewer en el top de ricos (null si no tiene puntos).
  function richRankOf(viewerId) {
    const channelId = activeChannel()
    const mine = db.prepare("SELECT balance + bank_balance AS total FROM wallets WHERE channel_id=? AND viewer_id=?").get(channelId, viewerId)
    if (!mine || mine.total <= 0) return null
    const ahead = db.prepare(`SELECT COUNT(*) AS n FROM wallets w JOIN viewer_identities i ON i.id=w.viewer_id
      WHERE w.channel_id=? AND w.balance + w.bank_balance > ? AND ${NOT_A_BOT}`).get(channelId, mine.total, ...KNOWN_BOTS).n
    return { rank: ahead + 1, points: mine.total }
  }

  return { getConfig, setConfig, pointsFor, registerDonation, undoDonation, listDonations, topDonors, richest, richRankOf }
}

let defaultSupport = null
function getDefaultSupport() {
  if (!defaultSupport) {
    defaultSupport = createSupport({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
    })
  }
  return defaultSupport
}

module.exports = { createSupport, getDefaultSupport, cleanTipUrl, toCents, DEFAULT_POINTS_PER_USD, PLATFORMS }
