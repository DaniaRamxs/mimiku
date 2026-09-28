// services/stream-sessions.js — que es "el directo actual".
//
// Lo comparten la tarjeta de fidelidad (!claim: un sello por directo) y el
// Top 3 del chat (se reinicia en cada directo).
//
//   1. Si Twitch informa que el canal esta en vivo, el directo es el stream
//      de Twitch (su id). Dos directos al dia = dos ids distintos.
//   2. Si no hay dato de Twitch (sin token, sin red, solo TikTok), un directo
//      nuevo empieza con el primer mensaje tras `gapHours` sin chat.
//   3. El streamer puede forzar un directo nuevo desde el panel; gana sobre
//      los anteriores porque es el mas reciente.
//
// La tabla se llama `loyalty_streams` porque nacio con la tarjeta (migracion 6).
const { randomUUID } = require("node:crypto")

const HOUR_MS = 3_600_000
// La actividad de chat se escribe como mucho una vez por minuto.
const ACTIVITY_WRITE_INTERVAL_MS = 60_000

// `liveStatus()` devuelve { live: true, streamId, startedAt } o null si no se sabe.
function createStreamSessions({ db, getChannel, now = () => new Date(), liveStatus = () => null, getGapHours = () => 3 }) {
  const listeners = new Set()
  let lastActivityWrite = { id: null, at: 0 }

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function safeLiveStatus() {
    try { return liveStatus() } catch { return null }
  }

  function latest(channelId) {
    return db.prepare("SELECT * FROM loyalty_streams WHERE channel_id=? ORDER BY started_at DESC, rowid DESC LIMIT 1").get(channelId)
  }

  function insert(channelId, id, startedAt, source) {
    const inserted = db.prepare(`INSERT OR IGNORE INTO loyalty_streams(id, channel_id, started_at, last_activity_at, source)
      VALUES (?, ?, ?, ?, ?)`).run(id, channelId, startedAt, now().toISOString(), source).changes > 0
    const row = db.prepare("SELECT * FROM loyalty_streams WHERE id=?").get(id)
    if (inserted) for (const listener of listeners) {
      try { listener(row) } catch (error) { console.warn("[stream-sessions] listener fallo:", error.message) }
    }
    return row
  }

  function isFresh(stream) {
    const gapMs = Math.max(1, Number(getGapHours()) || 3) * HOUR_MS
    return !!stream && now().getTime() - new Date(stream.last_activity_at).getTime() < gapMs
  }

  function touch(stream) {
    const at = now()
    if (lastActivityWrite.id === stream.id && at.getTime() - lastActivityWrite.at < ACTIVITY_WRITE_INTERVAL_MS) return stream
    lastActivityWrite = { id: stream.id, at: at.getTime() }
    db.prepare("UPDATE loyalty_streams SET last_activity_at=? WHERE id=?").run(at.toISOString(), stream.id)
    return { ...stream, last_activity_at: at.toISOString() }
  }

  // Directo al que pertenece algo que pasa ahora (un mensaje, un !claim).
  // Crea la fila si hace falta y marca actividad.
  function resolve() {
    const channelId = activeChannel()
    const live = safeLiveStatus()
    if (live && live.live && live.streamId) {
      const startedAt = live.startedAt && !Number.isNaN(new Date(live.startedAt).getTime())
        ? new Date(live.startedAt).toISOString() : now().toISOString()
      insert(channelId, `twitch:${channelId}:${live.streamId}`, startedAt, "twitch")
      return touch(latest(channelId))
    }
    const current = latest(channelId)
    if (isFresh(current)) return touch(current)
    return insert(channelId, randomUUID(), now().toISOString(), "auto")
  }

  // Directo en curso sin crear ninguno; null si no hay.
  function current() {
    const row = latest(activeChannel())
    const live = safeLiveStatus()
    return row && (isFresh(row) || (live && live.live)) ? row : null
  }

  function startNew() {
    return insert(activeChannel(), randomUUID(), now().toISOString(), "manual")
  }

  function isTwitchLive() {
    const live = safeLiveStatus()
    return !!(live && live.live)
  }

  // `listener(stream)` se llama cada vez que empieza un directo nuevo.
  function onNewStream(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { resolve, current, startNew, isTwitchLive, onNewStream, activeChannel }
}

let defaultSessions = null
function getDefaultStreamSessions() {
  if (!defaultSessions) {
    const platform = require("./local-runtime.js").getLocalPlatform()
    defaultSessions = createStreamSessions({
      db: platform.db,
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      liveStatus: () => require("./twitch-live-status.js").getDefaultLiveStatus().get(),
      // El hueco se configura en el panel de la tarjeta de fidelidad y vale para ambos widgets.
      getGapHours: () => require("./loyalty.js").getDefaultLoyaltyService().getConfig().streamGapHours,
    })
  }
  return defaultSessions
}

module.exports = { createStreamSessions, getDefaultStreamSessions }
