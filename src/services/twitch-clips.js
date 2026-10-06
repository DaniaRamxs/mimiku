// services/twitch-clips.js — clips recientes del canal para la pagina de canje
// (se ensenan cuando no hay directo). Usa Helix con el token del chat
// (twitch-helix.js): primero el id del canal y luego sus clips de los ultimos
// CLIP_DAYS dias, los mas vistos primero. Se guardan CACHE_MS y se renuevan
// en segundo plano: la pagina nunca espera a Twitch.
const CACHE_MS = 15 * 60_000
const RETRY_MS = 2 * 60_000
const CLIP_DAYS = 30
const MAX_CLIPS = 6

function cleanClip(clip) {
  const url = String(clip.url || "")
  const thumbnail = String(clip.thumbnail_url || "")
  if (!/^https:\/\/clips\.twitch\.tv\/[A-Za-z0-9_-]+$/.test(url) && !/^https:\/\/www\.twitch\.tv\/[a-z0-9_]+\/clip\/[A-Za-z0-9_-]+$/i.test(url)) return null
  return {
    id: String(clip.id || "").slice(0, 120), url, title: String(clip.title || "Clip").slice(0, 120),
    thumbnail: /^https:\/\/[a-z0-9.-]+\.(jtvnw\.net|twitch\.tv)\//i.test(thumbnail) ? thumbnail : "",
    views: Number(clip.view_count) || 0, seconds: Math.round(Number(clip.duration) || 0), createdAt: String(clip.created_at || ""),
    by: String(clip.creator_name || "").slice(0, 40),
  }
}

function createTwitchClips({ helix, getChannel, now = Date.now, log = console }) {
  let cache = { channel: "", clips: [], at: 0, retryAt: 0 }
  let loading = null

  async function load(channel) {
    const users = await helix.get(`users?login=${encodeURIComponent(channel)}`)
    const user = Array.isArray(users.data) ? users.data[0] : null
    if (!user) return []
    const since = new Date(now() - CLIP_DAYS * 24 * 60 * 60_000).toISOString()
    const body = await helix.get(`clips?broadcaster_id=${encodeURIComponent(user.id)}&first=20&started_at=${encodeURIComponent(since)}`)
    return (Array.isArray(body.data) ? body.data : [])
      .map(cleanClip).filter(Boolean)
      .sort((a, b) => b.views - a.views)
      .slice(0, MAX_CLIPS)
  }

  function refresh(channel) {
    if (loading || !helix.hasToken()) return
    loading = load(channel)
      .then(clips => { cache = { channel, clips, at: now(), retryAt: 0 } })
      .catch(error => {
        cache = { ...cache, retryAt: now() + RETRY_MS }
        log.warn("[clips] no se pudieron leer los clips de Twitch:", error.message)
      })
      .finally(() => { loading = null })
  }

  // Devuelve lo guardado (puede estar vacio la primera vez) y renueva si toca.
  function list() {
    const channel = String(getChannel() || "").trim().toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(channel)) return []
    const fresh = cache.channel === channel && now() - cache.at < CACHE_MS
    if (!fresh && now() >= cache.retryAt) refresh(channel)
    return cache.channel === channel ? cache.clips : []
  }

  return { list }
}

let defaultClips = null
function getDefaultTwitchClips() {
  if (!defaultClips) {
    defaultClips = createTwitchClips({
      helix: require("./twitch-helix.js").getDefaultTwitchHelix(),
      getChannel: () => require("./app-config.js").getAppConfig().streamer.twitchChannel || require("./currentChannel.js").get(),
    })
  }
  return defaultClips
}

module.exports = { createTwitchClips, getDefaultTwitchClips, cleanClip }
