// Activity Consumer: rastrea viewers activos a partir de cualquier
// chat_message normalizado, sin importar la plataforma de origen (Twitch
// Native, SSN-Twitch, SSN-YouTube, SSN-TikTok...). No importa tmi.js,
// Twitch ni Social Stream Ninja — solo el contrato de evento.
//
// Reemplaza el `sessionMsgs` que vivía dentro de twitch-adapter.js. La
// identidad de cada viewer activo es completa (platform + platformUserId),
// nunca solo username, para que Twitch:luna y YouTube:luna nunca se
// mezclen en el mismo contador de actividad.
const ACTIVE_TTL_MS = 10 * 60 * 1000 // viewer "activo" = escribió en los últimos 10 min

function viewerKey(actor, platform) {
  return `${platform}:${actor.platformUserId || "legacy:" + actor.username}`
}

function createActivityTracker({ ttlMs = ACTIVE_TTL_MS } = {}) {
  const viewers = new Map() // key -> { platform, platformUserId, username, displayName, lastSeenAt, messages }

  function sweep(now = Date.now()) {
    for (const [key, v] of viewers) if (now - v.lastSeenAt > ttlMs) viewers.delete(key)
  }

  function recordMessage(event) {
    const text = event.message && event.message.text
    if (!text) return
    if (text.trim().startsWith("!")) return // los comandos no cuentan como actividad, igual que antes
    sweep()
    const key = viewerKey(event.actor, event.platform)
    const previous = viewers.get(key)
    viewers.set(key, {
      platform: event.platform,
      platformUserId: event.actor.platformUserId || "",
      username: event.actor.username,
      displayName: event.actor.displayName || event.actor.username,
      lastSeenAt: Date.now(),
      messages: (previous?.messages || 0) + 1,
    })
  }

  function getActiveViewerIdentities() {
    sweep()
    return [...viewers.values()]
  }

  // Wrapper legacy: solo usernames, forma histórica de twitch-adapter.js.
  // Pensado para callers que todavía no necesitan identidad completa.
  function getActiveUsernames() {
    return getActiveViewerIdentities().map(v => v.username)
  }

  function reset() { viewers.clear() }

  return { recordMessage, getActiveViewerIdentities, getActiveUsernames, reset }
}

function registerActivityConsumer(eventEngine, tracker) {
  eventEngine.subscribe("chat_message", tracker.recordMessage)
  return tracker
}

let defaultTracker = null
function getDefaultActivityTracker(options) {
  if (!defaultTracker) defaultTracker = createActivityTracker(options)
  return defaultTracker
}

module.exports = { createActivityTracker, registerActivityConsumer, getDefaultActivityTracker }
