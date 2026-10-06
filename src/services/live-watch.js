// services/live-watch.js — ver el directo desde la pagina de canje cuenta.
//
// Mientras el reproductor de la pagina esta abierto y la pestana se ve, la
// pagina avisa cada minuto (POST /api/stream/watch). Cada aviso:
//   - apunta al viewer como "viendo" para la experiencia por tiempo
//     (watch-time.js, igual que si hubiera escrito en el chat), y
//   - suma un minuto; cada WATCH_BLOCK_MIN minutos le da los puntos del panel.
// Solo cuenta con el directo en marcha y como mucho un minuto cada
// MIN_GAP_MS por viewer (abrir varias pestanas no suma mas rapido).
// Los minutos viven en memoria y se cuentan por directo.
const WATCH_BLOCK_MIN = 5
const MIN_GAP_MS = 50_000
const MAX_TRACKED = 5000
const MAX_BLOCKS_PER_STREAM = 24 // puntos por ver: como mucho 2 horas por directo (la experiencia sigue)

function createLiveWatch({ platform, getChannel, getStream, getPoints, noteWatcher = () => {}, onFirstWatch = () => {}, now = Date.now }) {
  const viewers = new Map() // viewerId -> { streamId, minutes, lastAt, earned }

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function findViewer(twitchId) {
    return platform.db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function liveStream() {
    const stream = getStream()
    return stream && stream.live && stream.streamId ? stream : null
  }

  function progressOf(viewerId, streamId) {
    const entry = viewers.get(viewerId)
    return entry && entry.streamId === streamId ? entry : { streamId, minutes: 0, lastAt: 0, earned: 0 }
  }

  function publicProgress(entry, points) {
    return { minutes: entry.minutes, earned: entry.earned, points, blockMin: WATCH_BLOCK_MIN, nextIn: WATCH_BLOCK_MIN - (entry.minutes % WATCH_BLOCK_MIN) }
  }

  // Lo que ensena la pagina (sin contar un minuto).
  function status(twitchId) {
    const stream = liveStream()
    const viewer = stream && findViewer(twitchId)
    if (!viewer) return null
    return publicProgress(progressOf(viewer.id, stream.streamId), pointsPerBlock())
  }

  function pointsPerBlock() {
    const value = Number(getPoints())
    return Number.isInteger(value) && value > 0 ? value : 0
  }

  function ping(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const stream = liveStream()
    if (!stream) return { ok: false, reason: "offline" }
    const previous = progressOf(viewer.id, stream.streamId)
    const points = pointsPerBlock()
    if (now() - previous.lastAt < MIN_GAP_MS) return { ok: true, counted: false, ...publicProgress(previous, points) }
    if (!previous.minutes) { try { onFirstWatch(viewer.id) } catch (error) { /* el resumen nunca debe romper esto */ } }
    const minutes = previous.minutes + 1
    let earned = previous.earned
    let granted = 0
    if (minutes % WATCH_BLOCK_MIN === 0 && points && minutes / WATCH_BLOCK_MIN <= MAX_BLOCKS_PER_STREAM) {
      // Tras un reinicio los minutos vuelven a 1: un bloque ya pagado no se paga ni se anuncia otra vez.
      const key = `ver-web:${stream.streamId}:${viewer.id}:${minutes}`
      if (!platform.db.prepare("SELECT 1 FROM economy_ledger WHERE idempotency_key=?").get(key)) {
        platform.economy.applyMovement({
          channelId: activeChannel(), viewerId: viewer.id, balanceDelta: points, idempotencyKey: key,
          reason: "Viendo el directo en la página", sourceType: "web-watch", sourceId: String(stream.streamId),
        })
        granted = points
        earned += points
      }
    }
    const entry = { streamId: stream.streamId, minutes, lastAt: now(), earned }
    if (viewers.size > MAX_TRACKED) for (const [id, old] of viewers) if (old.streamId !== stream.streamId) viewers.delete(id)
    viewers.set(viewer.id, entry)
    noteWatcher(viewer)
    return { ok: true, counted: true, granted, ...publicProgress(entry, points) }
  }

  return { ping, status }
}

module.exports = { createLiveWatch, WATCH_BLOCK_MIN, MIN_GAP_MS, MAX_BLOCKS_PER_STREAM }
