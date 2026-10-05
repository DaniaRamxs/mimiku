// services/twitch-eventsub.js — canjes de puntos de canal de Twitch.
//
// El chat (tmi.js) no avisa de los canjes; Twitch los manda por EventSub, un
// WebSocket aparte. Al recibir "session_welcome" se pide la suscripcion a
// channel.channel_points_custom_reward_redemption.add con el token del chat,
// que tiene que ser de la cuenta del canal y llevar el permiso
// channel:read:redemptions. Cada canje se entrega como evento "redemption".
const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws"
const HELIX = "https://api.twitch.tv/helix"
const VALIDATE_URL = "https://id.twitch.tv/oauth2/validate"
const REDEMPTION_TYPE = "channel.channel_points_custom_reward_redemption.add"
const READ_SCOPES = ["channel:read:redemptions", "channel:manage:redemptions"]
const REQUEST_TIMEOUT_MS = 10_000
// Margen sobre el keepalive de Twitch antes de dar la conexion por muerta.
const KEEPALIVE_GRACE_MS = 5_000
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000]
const MAX_SEEN_MESSAGES = 500

const STATUS_TEXT = {
  off: "Desactivado",
  connecting: "Conectando...",
  connected: "Recibiendo canjes",
  reconnecting: "Reconectando...",
  "no-token": "Falta el token de Twitch",
  "missing-scope": "El token no tiene el permiso channel:read:redemptions",
  "wrong-account": "El token no es de la cuenta del canal",
  "not-affiliate": "El canal no tiene puntos de canal (hace falta ser afiliado o partner)",
  error: "Error",
}

function cleanToken(token) {
  return String(token || "").trim().replace(/^oauth:/i, "")
}

// Canje de EventSub -> evento de Mimiku.
function normalizeRedemption(event = {}) {
  const reward = event.reward || {}
  const input = String(event.user_input || "").trim()
  return {
    id: event.id ? `twitch-redemption:${event.id}` : null,
    platform: "twitch",
    type: "redemption",
    actor: {
      platformUserId: String(event.user_id || ""),
      username: String(event.user_login || ""),
      displayName: String(event.user_name || event.user_login || ""),
    },
    message: input ? { text: input } : null,
    payload: { rewardId: String(reward.id || ""), rewardTitle: String(reward.title || ""), cost: Number(reward.cost) || 0 },
  }
}

function createTwitchEventSub({
  getToken, getChannel, emit, onStatus = () => {},
  WebSocketImpl = require("ws"), fetchImpl = globalThis.fetch,
  timers = { setTimeout, clearTimeout }, log = console,
}) {
  let status = { state: "off", detail: "" }
  let socket = null
  let account = null // { clientId, userId, login, token }
  let running = false
  let attempt = 0
  let retryTimer = null
  let keepaliveTimer = null
  let keepaliveMs = 0
  const seen = new Set()

  function setStatus(state, detail = "") {
    status = { state, detail: detail || STATUS_TEXT[state] || "" }
    onStatus({ ...status })
  }

  async function request(url, options = {}) {
    const controller = new AbortController()
    const timer = timers.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal })
    } finally {
      timers.clearTimeout(timer)
    }
  }

  // Comprueba el token antes de abrir el socket: sin permiso o de otra cuenta
  // no tiene sentido reintentar, hay que cambiar el token.
  async function checkAccount() {
    const token = cleanToken(getToken())
    if (!token) return { problem: "no-token" }
    const response = await request(VALIDATE_URL, { headers: { Authorization: `OAuth ${token}` } })
    if (response.status === 401) return { problem: "error", detail: "El token de Twitch caducó o no es válido" }
    if (!response.ok) throw new Error(`Twitch respondió ${response.status}`)
    const info = await response.json()
    const scopes = Array.isArray(info.scopes) ? info.scopes : []
    if (!READ_SCOPES.some(scope => scopes.includes(scope))) return { problem: "missing-scope" }
    const channel = String(getChannel() || "").trim().toLowerCase()
    if (channel && String(info.login || "").toLowerCase() !== channel) {
      return { problem: "wrong-account", detail: `El token es de "${info.login}" y el canal es "${channel}"` }
    }
    return { account: { clientId: info.client_id, userId: String(info.user_id), login: info.login, token } }
  }

  async function subscribe(sessionId) {
    const response = await request(`${HELIX}/eventsub/subscriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.token}`, "Client-Id": account.clientId, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: REDEMPTION_TYPE, version: "1",
        condition: { broadcaster_user_id: account.userId },
        transport: { method: "websocket", session_id: sessionId },
      }),
    })
    if (response.ok) return null
    if (response.status === 403) return "not-affiliate"
    if (response.status === 401) return "missing-scope"
    throw new Error(`Twitch rechazó la suscripción (${response.status})`)
  }

  function armKeepalive() {
    if (keepaliveTimer) timers.clearTimeout(keepaliveTimer)
    if (!keepaliveMs) return
    keepaliveTimer = timers.setTimeout(() => {
      log.warn("[eventsub] Twitch dejó de responder; reconectando")
      dropSocket()
      scheduleRetry()
    }, keepaliveMs + KEEPALIVE_GRACE_MS)
  }

  function dropSocket() {
    if (keepaliveTimer) timers.clearTimeout(keepaliveTimer)
    keepaliveTimer = null
    const old = socket
    socket = null
    if (old) {
      old.removeAllListeners?.()
      old.on?.("error", () => {})
      try { old.close() } catch {}
    }
  }

  function scheduleRetry() {
    if (!running || retryTimer) return
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
    attempt++
    setStatus("reconnecting")
    retryTimer = timers.setTimeout(() => {
      retryTimer = null
      connect()
    }, delay)
  }

  // Un message_id ya visto es un reenvio de Twitch: se ignora.
  function isRepeated(messageId) {
    if (!messageId) return false
    if (seen.has(messageId)) return true
    seen.add(messageId)
    if (seen.size > MAX_SEEN_MESSAGES) seen.delete(seen.values().next().value)
    return false
  }

  async function onWelcome(ws, session, needsSubscribe) {
    keepaliveMs = (Number(session.keepalive_timeout_seconds) || 10) * 1000
    armKeepalive()
    if (!needsSubscribe) { attempt = 0; setStatus("connected"); return }
    try {
      const problem = await subscribe(session.id)
      if (socket !== ws) return
      if (problem) { stopWith(problem); return }
      attempt = 0
      setStatus("connected")
    } catch (error) {
      log.warn("[eventsub] no se pudo suscribir:", error.message)
      dropSocket()
      scheduleRetry()
    }
  }

  function onMessage(ws, raw, needsSubscribe) {
    if (socket !== ws) return
    let message
    try { message = JSON.parse(String(raw)) } catch { return }
    const meta = message.metadata || {}
    const payload = message.payload || {}
    armKeepalive()
    if (isRepeated(meta.message_id)) return
    switch (meta.message_type) {
      case "session_welcome": onWelcome(ws, payload.session || {}, needsSubscribe); break
      case "session_reconnect":
        // Twitch pide moverse a otra URL; la suscripcion viaja con la sesion.
        if (payload.session?.reconnect_url) openSocket(payload.session.reconnect_url, { subscribe: false })
        break
      case "notification":
        if (meta.subscription_type === REDEMPTION_TYPE && payload.event) {
          try { emit(normalizeRedemption(payload.event)) } catch (error) {
            log.warn("[eventsub] no se pudo entregar el canje:", error.message)
          }
        }
        break
      case "revocation":
        stopWith(payload.subscription?.status === "authorization_revoked" ? "missing-scope" : "error", "Twitch canceló la suscripción a los canjes")
        break
      default: break
    }
  }

  function openSocket(url, { subscribe: needsSubscribe }) {
    if (!running) return
    const previous = socket
    const ws = new WebSocketImpl(url)
    socket = ws
    ws.on("message", raw => {
      // En un session_reconnect el socket viejo se cierra cuando llega el
      // welcome del nuevo.
      if (previous && previous !== ws && socket === ws) {
        previous.removeAllListeners?.()
        previous.on?.("error", () => {})
        try { previous.close() } catch {}
      }
      onMessage(ws, raw, needsSubscribe)
    })
    ws.on("close", () => {
      if (socket !== ws) return
      socket = null
      if (keepaliveTimer) timers.clearTimeout(keepaliveTimer)
      scheduleRetry()
    })
    ws.on("error", error => log.warn("[eventsub] error del socket:", error.message))
  }

  function stopWith(state, detail) {
    running = false
    if (retryTimer) timers.clearTimeout(retryTimer)
    retryTimer = null
    dropSocket()
    setStatus(state, detail)
  }

  // Cada intento vuelve a validar el token: pudo cambiar o caducar.
  async function connect() {
    try {
      const result = await checkAccount()
      if (!running) return
      if (result.problem) { stopWith(result.problem, result.detail); return }
      account = result.account
      openSocket(EVENTSUB_URL, { subscribe: true })
    } catch (error) {
      log.warn("[eventsub] no se pudo comprobar el token:", error.message)
      scheduleRetry()
    }
  }

  async function start() {
    stop()
    running = true
    attempt = 0
    setStatus("connecting")
    await connect()
    return getStatus()
  }

  function stop() {
    if (!running && status.state === "off") return
    stopWith("off")
  }

  function getStatus() { return { ...status } }

  return { start, stop, getStatus }
}

module.exports = { createTwitchEventSub, normalizeRedemption, REDEMPTION_TYPE, EVENTSUB_URL }
