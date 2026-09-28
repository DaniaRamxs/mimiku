// services/twitch-live-status.js — sabe si el canal de Twitch esta en vivo y
// con que id de stream. Lo usa la tarjeta de fidelidad para distinguir los
// directos de un mismo dia.
//
// Usa el mismo token OAuth del chat: /oauth2/validate devuelve el client_id
// del token, y con eso /helix/streams responde sin scopes extra ni Client
// Secret. Si falta el token o Twitch no responde, `get()` devuelve null y la
// tarjeta usa su deteccion por inactividad del chat.
const POLL_MS = 60_000
const STALE_MS = 3 * POLL_MS
const REQUEST_TIMEOUT_MS = 10_000

function cleanToken(token) {
  return String(token || "").trim().replace(/^oauth:/i, "")
}

function createTwitchLiveStatus({ getToken, getChannel, fetchImpl = globalThis.fetch, now = Date.now, log = console }) {
  let timer = null
  let state = null      // { live, streamId, startedAt, checkedAt }
  let clientId = null
  let clientIdFor = null
  let warned = false

  async function request(url, headers) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal })
      if (!response.ok) throw new Error(`Twitch respondio ${response.status}`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  async function check() {
    try {
      const token = cleanToken(getToken())
      const channel = String(getChannel() || "").trim().toLowerCase()
      if (!token || !channel || typeof fetchImpl !== "function") { state = null; return state }
      if (clientIdFor !== token) {
        const info = await request("https://id.twitch.tv/oauth2/validate", { Authorization: `OAuth ${token}` })
        clientId = info.client_id
        clientIdFor = token
      }
      const body = await request(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, {
        Authorization: `Bearer ${token}`, "Client-Id": clientId,
      })
      const stream = Array.isArray(body.data) ? body.data[0] : null
      state = stream
        ? { live: true, streamId: String(stream.id), startedAt: stream.started_at, checkedAt: now() }
        : { live: false, streamId: null, startedAt: null, checkedAt: now() }
      warned = false
    } catch (error) {
      clientIdFor = null
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

  return { start, stop, check, get }
}

let defaultStatus = null
function getDefaultLiveStatus() {
  if (!defaultStatus) {
    defaultStatus = createTwitchLiveStatus({
      getToken: () => require("./secret-store.js").getDefaultSecretStore().getTwitchToken(),
      getChannel: () => require("./app-config.js").getAppConfig().streamer.twitchChannel || require("./currentChannel.js").get(),
    })
  }
  return defaultStatus
}

module.exports = { createTwitchLiveStatus, getDefaultLiveStatus }
