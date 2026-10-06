// services/twitch-live-status.js — sabe si el canal de Twitch esta en vivo y
// con que id de stream. Lo usa stream-sessions.js para distinguir los
// directos de un mismo dia.
//
// Consulta /helix/streams con el token del chat (ver twitch-helix.js). Si
// falta el token o Twitch no responde, `get()` devuelve null y se usa la
// deteccion por inactividad del chat.
const { createTwitchHelix, getDefaultTwitchHelix } = require("./twitch-helix.js")

const POLL_MS = 60_000
const STALE_MS = 3 * POLL_MS

// `helix` es opcional: sin el, se crea uno con `getToken` y `fetchImpl`.
function createTwitchLiveStatus({ getToken, getChannel, fetchImpl, helix = null, now = Date.now, log = console }) {
  const api = helix || createTwitchHelix({ getToken, fetchImpl })
  let timer = null
  let state = null      // { live, streamId, startedAt, checkedAt, title, game, viewers, thumbnail, login, display }
  let warned = false
  const listeners = []

  // Cada consulta que sale bien avisa con (nuevo, anterior): el resumen del
  // directo (stream-recap.js) sabe asi cuando empieza y cuando termina uno.
  function notify(next, previous) {
    for (const listener of listeners) {
      try { listener(next, previous) } catch (error) { log.error("[twitch-live-status]", error.message) }
    }
  }

  async function check() {
    const previous = state
    try {
      const channel = String(getChannel() || "").trim().toLowerCase()
      if (!channel || !api.hasToken()) { state = null; return state }
      const body = await api.get(`streams?user_login=${encodeURIComponent(channel)}`)
      const stream = Array.isArray(body.data) ? body.data[0] : null
      // Titulo, juego, espectadores y miniatura: los ensena la pagina de canje.
      state = stream
        ? {
          live: true, streamId: String(stream.id), startedAt: stream.started_at, checkedAt: now(),
          title: String(stream.title || ""), game: String(stream.game_name || ""), viewers: Number(stream.viewer_count) || 0,
          thumbnail: String(stream.thumbnail_url || "").replace("{width}", "640").replace("{height}", "360"),
          login: String(stream.user_login || channel), display: String(stream.user_name || channel),
        }
        : { live: false, streamId: null, startedAt: null, checkedAt: now(), login: channel }
      warned = false
      notify(state, previous)
    } catch (error) {
      state = null
      if (!warned) {
        warned = true
        log.warn("[twitch-live-status] no se pudo consultar si el canal esta en vivo:", error.message)
      }
    }
    return state
  }

  function start() {
    if (timer) return
    check()
    timer = setInterval(check, POLL_MS)
    if (timer.unref) timer.unref()
  }

  function stop() {
    clearInterval(timer)
    timer = null
  }

  // Un dato viejo (la consulta dejo de responder) no vale como "en vivo".
  function get() {
    if (!state || now() - state.checkedAt > STALE_MS) return null
    return state
  }

  function onUpdate(listener) { if (typeof listener === "function") listeners.push(listener) }

  return { start, stop, check, get, onUpdate }
}

let defaultStatus = null
function getDefaultLiveStatus() {
  if (!defaultStatus) {
    defaultStatus = createTwitchLiveStatus({
      helix: getDefaultTwitchHelix(),
      getChannel: () => require("./app-config.js").getAppConfig().streamer.twitchChannel || require("./currentChannel.js").get(),
    })
  }
  return defaultStatus
}

module.exports = { createTwitchLiveStatus, getDefaultLiveStatus }
