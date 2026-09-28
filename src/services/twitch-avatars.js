// services/twitch-avatars.js — foto de perfil de Twitch de un viewer.
//
// El chat de Twitch no trae la foto, asi que se pide a /helix/users con el
// token del chat. Se guarda en memoria (y en la identidad local, para el resto
// de widgets) para no repetir la consulta; los fallos tambien se recuerdan un
// rato para no martillear la API si el token no sirve.
const HIT_TTL_MS = 24 * 3600 * 1000
const MISS_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 2000

function createTwitchAvatars({ helix, now = Date.now, remember = () => {} }) {
  const cache = new Map()     // login -> { url, at }
  const pending = new Map()   // login -> Promise

  function cached(login) {
    const entry = cache.get(login)
    if (!entry) return undefined
    const ttl = entry.url ? HIT_TTL_MS : MISS_TTL_MS
    return now() - entry.at < ttl ? entry.url : undefined
  }

  function store(login, url) {
    cache.set(login, { url, at: now() })
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  }

  // Devuelve la URL https de la foto o null. Nunca lanza.
  async function getAvatar(username) {
    const login = String(username || "").trim().toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(login)) return null
    const hit = cached(login)
    if (hit !== undefined) return hit
    if (pending.has(login)) return pending.get(login)
    const lookup = (async () => {
      try {
        if (!helix.hasToken()) return null
        const body = await helix.get(`users?login=${encodeURIComponent(login)}`)
        const user = Array.isArray(body.data) ? body.data[0] : null
        const url = user && /^https:\/\//.test(user.profile_image_url || "") ? user.profile_image_url : null
        store(login, url)
        if (url) remember(login, url)
        return url
      } catch {
        store(login, null)
        return null
      } finally {
        pending.delete(login)
      }
    })()
    pending.set(login, lookup)
    return lookup
  }

  return { getAvatar }
}

let defaultAvatars = null
function getDefaultTwitchAvatars() {
  if (!defaultAvatars) {
    defaultAvatars = createTwitchAvatars({
      helix: require("./twitch-helix.js").getDefaultTwitchHelix(),
      // Guarda la foto en la identidad local: la usan tambien avatares de chat y Top 3.
      remember: (login, url) => {
        try {
          const platform = require("./local-runtime.js").getLocalPlatform()
          const viewer = platform.identities.byUsername(login, "twitch")
          if (viewer) platform.db.prepare("UPDATE viewer_identities SET avatar_url=?, updated_at=datetime('now') WHERE id=?").run(url, viewer.id)
        } catch (error) {
          console.warn("[twitch-avatars] no se pudo guardar la foto:", error.message)
        }
      },
    })
  }
  return defaultAvatars
}

module.exports = { createTwitchAvatars, getDefaultTwitchAvatars }
