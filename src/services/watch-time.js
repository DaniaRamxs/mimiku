// services/watch-time.js — experiencia por tiempo viendo el directo.
//
// Mimiku no tiene la lista de quien esta conectado al directo, asi que cuenta
// como "viendo" a quien ha escrito en el chat en los ultimos ACTIVE_WINDOW_MS.
// Cada INTERVAL_MS, si el canal esta en directo, se llama a `grant(viewers)`
// con esa gente (levels.js les da `xp_per_5min`). Si no se sabe si hay
// directo (sin token de Twitch), cuenta que lo hay mientras haya chat.
const INTERVAL_MS = 5 * 60_000
const ACTIVE_WINDOW_MS = 10 * 60_000

function createWatchTime({ grant, isLive = () => null, now = Date.now, intervalMs = INTERVAL_MS, windowMs = ACTIVE_WINDOW_MS }) {
  const seen = new Map() // clave -> { username, platformUserId, platform, at }
  let timer = null

  function note(username, platformUserId = "", platform = "twitch") {
    if (!username) return
    const key = `${platform}:${platformUserId || String(username).toLowerCase()}`
    seen.set(key, { username, platformUserId, platform, at: now() })
  }

  // Quien sigue activo; los demas se olvidan.
  function active() {
    const since = now() - windowMs
    for (const [key, viewer] of seen) if (viewer.at < since) seen.delete(key)
    return [...seen.values()]
  }

  function tick() {
    const viewers = active()
    if (!viewers.length) return []
    const live = isLive()
    if (live === false) return []
    grant(viewers)
    return viewers
  }

  function start() {
    if (timer) return
    timer = setInterval(tick, intervalMs)
    if (timer.unref) timer.unref()
  }

  function stop() { clearInterval(timer); timer = null }

  return { note, tick, active, start, stop }
}

module.exports = { createWatchTime, INTERVAL_MS, ACTIVE_WINDOW_MS }
