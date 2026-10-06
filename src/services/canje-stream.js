// services/canje-stream.js — lo del directo en la pagina de canje, aparte del
// reproductor: puntos por verlo desde la pagina, cofres del directo, bonus de
// minijuegos, predicciones con puntos y, sin directo, el resumen del ultimo y
// los clips del canal. `state()` va dentro de /api/state; las rutas de abajo
// son las acciones del viewer. Cada parte vive en su propio servicio.
const STREAM_ROUTES = {
  "/api/stream/watch": "POST",
  "/api/stream/drop": "POST",
  "/api/stream/predict": "POST",
}
const KEY_PATTERN = /^[a-z0-9-]{8,64}$/i
const ACTION_GAP_MS = 800

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Espera un momento.",
  offline: "El directo no está en marcha.",
  gone: "Ese cofre ya se cerró.",
  already: "Ya abriste este cofre.",
  full: "Llegaste tarde: otros abrieron el cofre antes.",
  closed: "Las apuestas de esta predicción ya están cerradas.",
  "bad-option": "Elige una respuesta.",
  "bad-amount": "Escribe cuántos puntos quieres apostar.",
  "bad-key": "Petición no válida. Recarga la página.",
  "other-option": "Ya apostaste por otra respuesta: solo puedes subir tu apuesta en esa.",
  min: "La apuesta mínima es de 100 puntos.",
  max: "La apuesta máxima es de 500.000 puntos.",
  insufficient: "No te alcanzan los puntos.",
}

function publicRecap(recap) {
  if (!recap) return null
  return {
    id: recap.streamId, title: recap.title, game: recap.game, startedAt: recap.startedAt, endedAt: recap.endedAt, minutes: recap.minutes,
    peakViewers: recap.peakViewers, top: recap.top, pointsEarned: recap.pointsEarned, legendaries: recap.legendaries,
    drops: recap.drops, webWatchers: recap.webWatchers, predictions: recap.predictions,
  }
}

// `getStream()`: estado de twitch-live-status.js (null si no se sabe).
function createCanjeStream({ platform, getStream, watch, drops, bonus, predictions, recap, clips, now = Date.now, log = console }) {
  const lastAction = new Map()

  function viewerOf(twitchId) {
    return platform.db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  // Por viewer y accion: ver el directo no frena abrir un cofre.
  function tooFast(key) {
    const last = lastAction.get(key) || 0
    if (now() - last < ACTION_GAP_MS) return true
    if (lastAction.size > 5000) lastAction.clear()
    lastAction.set(key, now())
    return false
  }

  // Cada parte por separado: si una falla, las demas siguen saliendo.
  function safe(name, run, fallback) {
    try { return run() } catch (error) { log.error(`[directo:${name}]`, error.message); return fallback }
  }

  function state(twitchId) {
    const stream = getStream()
    const live = !!(stream && stream.live)
    const viewer = viewerOf(twitchId)
    return {
      now: now(),
      watch: live ? safe("ver", () => watch.status(twitchId), null) : null,
      drop: live ? safe("cofre", () => drops.current(twitchId), null) : null,
      bonusPercent: live ? safe("bonus", () => bonus.percent(), 0) : 0,
      prediction: viewer ? safe("prediccion", () => predictions.view(viewer.id), null) : null,
      // Sin directo: resumen del ultimo y clips (si se sabe que no hay directo).
      recap: stream && !live ? safe("resumen", () => publicRecap(recap.last()), null) : null,
      clips: stream && !live ? safe("clips", () => clips.list(), []) : [],
    }
  }

  function bet(twitchId, body) {
    const viewer = viewerOf(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const key = typeof body.key === "string" ? body.key : ""
    if (!KEY_PATTERN.test(key)) return { ok: false, reason: "bad-key" }
    return predictions.bet(viewer.id, String(body.id || "").slice(0, 64), body.option, body.amount, key)
  }

  function act(pathname, twitchId, body) {
    if (tooFast(`${twitchId}:${pathname}`)) return { ok: false, reason: "rate-limit" }
    if (pathname === "/api/stream/watch") return watch.ping(twitchId)
    if (pathname === "/api/stream/drop") return drops.claim(twitchId, String(body.id || "").slice(0, 120))
    if (pathname === "/api/stream/predict") return bet(twitchId, body)
    return null
  }

  return { state, act }
}

// Atiende una ruta de STREAM_ROUTES ya autenticada. Devuelve [status, json].
async function handleStreamApi({ pathname, readJson, user, stream }) {
  const raw = await readJson()
  const body = raw && typeof raw === "object" ? raw : {}
  const result = stream.act(pathname, user.twitchId, body)
  if (!result) return [404, { error: "No encontrado" }]
  if (result.ok) return [200, result]
  return [result.reason === "rate-limit" ? 429 : 409, { error: MESSAGES[result.reason] || "No se pudo hacer.", reason: result.reason }]
}

module.exports = { createCanjeStream, handleStreamApi, STREAM_ROUTES, MESSAGES, publicRecap }
