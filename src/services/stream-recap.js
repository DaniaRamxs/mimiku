// services/stream-recap.js — resumen del ultimo directo para la pagina de canje.
//
// Escucha a twitch-live-status.js (una consulta por minuto). Mientras hay
// directo va guardando lo que solo se sabe en ese momento: pico de
// espectadores, top 3 del chat y contadores (legendarios, cofres abiertos,
// viewers que lo vieron desde la pagina, predicciones). Se guarda en la base
// de datos, asi un reinicio de Mimiku a mitad de directo no lo pierde.
// Cuando el directo termina (o empieza otro) se cierra el resumen, se suman
// los puntos que gano la comunidad durante el directo y queda como "ultimo".
const RUNNING_KEY = "stream_recap_running"
const LAST_KEY = "stream_recap_last"
const COUNTERS = ["legendaries", "drops", "webWatchers", "predictions", "bonusPoints"]
// Movimientos que solo pasan puntos de un viewer a otro: no son "ganados".
// Las predicciones solo reparten lo apostado por los propios viewers.
const TRANSFER_SOURCES = ["regalo", "regalo-envio", "robo", "gacha-market", "gacha-trade", "duel", "prediction"]
// Consultas seguidas sin directo antes de cerrar el resumen: un fallo puntual
// de Twitch a mitad de directo no lo parte en dos.
const OFFLINE_CHECKS_TO_END = 2

function sqlTime(iso) {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19)
}

// `getTop()` -> [{ name, messages }] del directo en curso (chat-top.js).
function createStreamRecap({ platform, getChannel, getTop = () => [], now = Date.now, log = console }) {
  let pending = {}
  let live = false
  let offlineChecks = 0

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function load(key) {
    const value = platform.moderation.getConfig(activeChannel(), key)
    return value && value.streamId ? value : null
  }

  function save(key, value) { platform.moderation.setConfig(activeChannel(), key, value || {}) }

  function withPending(counters = {}) {
    const merged = { ...counters }
    for (const [key, amount] of Object.entries(pending)) merged[key] = (merged[key] || 0) + amount
    pending = {}
    return merged
  }

  function pointsEarned(startedAt, endedAt) {
    const marks = TRANSFER_SOURCES.map(() => "?").join(",")
    const row = platform.db.prepare(`SELECT COALESCE(SUM(balance_delta), 0) AS total FROM economy_ledger
      WHERE channel_id=? AND balance_delta > 0 AND bank_delta = 0 AND source_type NOT IN (${marks})
      AND created_at >= ? AND created_at <= ?`).get(activeChannel(), ...TRANSFER_SOURCES, sqlTime(startedAt), sqlTime(endedAt))
    return row ? row.total : 0
  }

  function finalize(running) {
    const endedAt = running.lastSeenAt || new Date(now()).toISOString()
    const startedAt = running.startedAt || endedAt
    const counters = withPending(running.counters)
    const recap = {
      streamId: running.streamId, title: running.title || "", game: running.game || "",
      startedAt, endedAt, minutes: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000)),
      peakViewers: running.peak || 0, top: running.top || [], pointsEarned: pointsEarned(startedAt, endedAt),
      ...Object.fromEntries(COUNTERS.map(key => [key, counters[key] || 0])),
    }
    save(LAST_KEY, recap)
    save(RUNNING_KEY, null)
    return recap
  }

  function topNow() {
    try {
      return (getTop() || []).slice(0, 3).map(entry => ({ name: String(entry.name || entry.username || "?").slice(0, 40), messages: Number(entry.messages) || 0 }))
    } catch (error) { return [] }
  }

  // Lo llama twitch-live-status.js tras cada consulta que sale bien.
  function onUpdate(next) {
    try {
      if (!next) return
      const running = load(RUNNING_KEY)
      if (!next.live || !next.streamId) {
        offlineChecks += 1
        if (offlineChecks < OFFLINE_CHECKS_TO_END) return
        live = false
        if (running) finalize(running)
        return
      }
      offlineChecks = 0
      live = true
      const same = running && running.streamId === String(next.streamId)
      if (running && !same) finalize(running)
      const base = same ? running : { streamId: String(next.streamId), startedAt: next.startedAt || new Date(now()).toISOString(), peak: 0, counters: {} }
      const top = topNow()
      save(RUNNING_KEY, {
        ...base, title: String(next.title || base.title || "").slice(0, 200), game: String(next.game || base.game || "").slice(0, 80),
        peak: Math.max(base.peak || 0, Number(next.viewers) || 0), top: top.length ? top : base.top || [],
        lastSeenAt: new Date(now()).toISOString(), counters: withPending(base.counters),
      })
    } catch (error) {
      log.error("[resumen directo]", error.message)
    }
  }

  // Suma a un contador del directo en curso (fuera de directo no cuenta).
  function bump(key, amount = 1) {
    if (!live || !COUNTERS.includes(key)) return
    const value = Math.trunc(Number(amount))
    if (value > 0) pending = { ...pending, [key]: (pending[key] || 0) + value }
  }

  function last() { return load(LAST_KEY) }

  return { onUpdate, bump, last, finalize }
}

let defaultRecap = null
function getDefaultStreamRecap() {
  if (!defaultRecap) {
    defaultRecap = createStreamRecap({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      getTop: () => require("./chat-top.js").getDefaultChatTopService().snapshot().entries,
    })
  }
  return defaultRecap
}

// Engancha el resumen al estado del directo y al tablon "En vivo" (legendarios).
function startStreamRecap() {
  const recap = getDefaultStreamRecap()
  require("./twitch-live-status.js").getDefaultLiveStatus().onUpdate(next => recap.onUpdate(next))
  require("./live-feed.js").getDefaultLiveFeed().subscribe("recap", (_channel, event) => {
    if (event && event.rarity === "legendario" && event.kind !== "steal") recap.bump("legendaries")
  })
  return recap
}

module.exports = { createStreamRecap, getDefaultStreamRecap, startStreamRecap, TRANSFER_SOURCES }
