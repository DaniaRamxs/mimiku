// Social Stream Ninja Transport — Fase "Conectar sin postserver".
//
// Responsabilidad única: mantener (o intentar mantener) una conexión
// WebSocket hacia el relay LOCAL de la app de escritorio de Social Stream
// Ninja (SSApp) y entregar cada payload de chat recibido al
// SocialStreamNinjaAdapter existente — normalizarlo NO es trabajo de este
// archivo. No conoce el Event Engine, Command Engine ni ningún consumidor.
//
// Ver docs/social-stream-ninja-integration.md para la auditoría completa:
// SSApp expone un WebSocket "room- y channel-aware" en 127.0.0.1:3003 (o
// 127.0.0.1:3000 en instalaciones viejas) para relacionar tráfico entre las
// páginas locales de Social Stream — el mismo concepto de canales (1-9) que
// usa el relay en la nube (io.socialstream.ninja), pero 100% local. El canal
// 4 transporta el chat de Extension/SSApp hacia Dock. El código fuente de
// SSApp 0.4.21 confirma que el relay local acepta exactamente el frame
// {"join","in","out"} (o /join/ROOM/IN/OUT), exige la misma room en ambos
// clientes y no responde con ack. Por eso la detección usa dos conexiones y
// verifica activamente ese enrutamiento; abrir el puerto no basta.
const WebSocket = require("ws")
const { randomUUID } = require("node:crypto")

const DEFAULT_PORTS = [3003, 3000] // 3003 = default en instalaciones nuevas; 3000 = compatibilidad con instalaciones viejas
const CHAT_CHANNEL = 4
const BACKOFF_STEPS_MS = [1000, 2000, 5000, 10000, 30000] // tope en 30s, igual que pidió la fase

function maskSessionId(sessionId) {
  if (!sessionId) return "(sin session id)"
  if (sessionId.length <= 6) return "***"
  return `${sessionId.slice(0, 3)}…${sessionId.slice(-3)}`
}

function looksLikeChatPayload(data) {
  return data && typeof data === "object" && !Array.isArray(data) && typeof data.chatmessage === "string"
}

function closeQuietly(socket) {
  if (!socket) return
  try { socket.removeAllListeners?.() } catch (_) {}
  try { socket.terminate ? socket.terminate() : socket.close() } catch (_) {}
}

function probePort({ WebSocketImpl, host, port, timeoutMs, log }) {
  return new Promise(resolve => {
    const nonce = randomUUID()
    const room = `mimiku-probe-${nonce}`
    const url = `ws://${host}:${port}`
    let receiver = null
    let sender = null
    let settled = false
    const finish = detected => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      closeQuietly(receiver)
      closeQuietly(sender)
      resolve({ detected, port: detected ? port : null })
    }
    const timer = setTimeout(() => finish(false), timeoutMs)

    try {
      log(`[ssn-discovery] socket opening ${url} receiver`)
      receiver = new WebSocketImpl(url)
      receiver.on("open", () => {
        log(`[ssn-discovery] socket open ${url} receiver`)
        const join = { join: room, in: 9, out: 8 }
        receiver.send(JSON.stringify(join))
        log(`[ssn-discovery] frame sent receiver join=<probe> in=9 out=8`)

        log(`[ssn-discovery] socket opening ${url} sender`)
        sender = new WebSocketImpl(url)
        sender.on("open", () => {
          log(`[ssn-discovery] socket open ${url} sender`)
          sender.send(JSON.stringify({ join: room, in: 8, out: 9 }))
          log(`[ssn-discovery] frame sent sender join=<probe> in=8 out=9`)
          setTimeout(() => {
            if (!settled && sender?.readyState === WebSocketImpl.OPEN) {
              sender.send(JSON.stringify({ mimikuSsnProbe: nonce }))
              log("[ssn-discovery] frame sent protocol probe")
            }
          }, 10)
        })
        sender.on("error", error => log(`[ssn-discovery] socket error sender: ${error.message || error}`))
        sender.on("close", (code, reason) => log(`[ssn-discovery] socket close sender code=${code} reason=${reason?.toString() || ""}`))
      })
      receiver.on("message", raw => {
        const text = raw.toString()
        log(`[ssn-discovery] response received bytes=${Buffer.byteLength(text)}`)
        try {
          if (JSON.parse(text)?.mimikuSsnProbe === nonce) finish(true)
        } catch (_) {}
      })
      receiver.on("error", error => log(`[ssn-discovery] socket error receiver: ${error.message || error}`))
      receiver.on("close", (code, reason) => log(`[ssn-discovery] socket close receiver code=${code} reason=${reason?.toString() || ""}`))
    } catch (error) {
      log(`[ssn-discovery] socket creation error: ${error.message || error}`)
      finish(false)
    }
  })
}

async function probeSocialStreamNinjaRelay(options = {}) {
  const WebSocketImpl = options.WebSocket || WebSocket
  const host = options.host || "127.0.0.1"
  const ports = options.ports || DEFAULT_PORTS
  const timeoutMs = options.timeoutMs ?? 750
  const log = options.log || (() => {})
  for (const port of ports) {
    const result = await probePort({ WebSocketImpl, host, port, timeoutMs, log })
    if (result.detected) return result
  }
  return { detected: false, port: null }
}

function createSocialStreamNinjaTransport(overrides = {}) {
  const WebSocketImpl = overrides.WebSocket || WebSocket
  let ports = overrides.ports || DEFAULT_PORTS
  const host = overrides.host || "127.0.0.1"
  const backoffSteps = overrides.backoffSteps || BACKOFF_STEPS_MS
  const onPayload = overrides.onPayload || (() => {})
  const onStatusChange = overrides.onStatusChange || (() => {})
  const onDiscoveryChange = overrides.onDiscoveryChange || (() => {})
  const log = overrides.log || (() => {})
  // Sin ping/pong, un cierre "silencioso" del lado de SSApp (proceso matado,
  // red caída) puede dejar al cliente creyendo que sigue conectado para
  // siempre, porque nunca llega un frame de cierre TCP/WS real que dispare
  // el evento "close". Se detecta activamente en vez de confiar solo en eso.
  const heartbeatIntervalMs = overrides.heartbeatIntervalMs ?? 20000
  const heartbeatTimeoutMs = overrides.heartbeatTimeoutMs ?? 10000

  let sessionId = overrides.sessionId || ""
  let ws = null
  let generation = 0 // invalida listeners de sockets viejos tras reconectar — evita duplicados
  let reconnectTimer = null
  let heartbeatInterval = null
  let heartbeatTimeoutTimer = null
  let backoffIndex = 0
  let portIndex = 0
  let desiredConnected = false // true mientras el usuario quiere estar conectado (para distinguir de disconnect() explícito)
  let status = { state: "not_connected", error: null, port: null }
  let firstUnrecognizedPayloadLogged = false
  let firstFrameLogged = false

  // port se incluye solo para que la UI pueda mostrar honestamente a cuál de
  // los puertos candidatos (3003 o el heredado 3000) quedó conectado — no
  // cambia nada del protocolo ni de la lógica de reconexión.
  function setStatus(state, error = null, port = null) {
    status = { state, error, port }
    onStatusChange(status)
  }

  function setSessionId(value) {
    sessionId = value || ""
  }

  function setPorts(values) {
    const normalized = [...new Set((Array.isArray(values) ? values : []).filter(port => Number.isInteger(port) && port >= 1024 && port <= 65535))]
    if (normalized.length) ports = normalized
  }

  function clearReconnectTimer() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  }

  function scheduleReconnect() {
    if (!desiredConnected) return
    clearReconnectTimer()
    const delay = backoffSteps[Math.min(backoffIndex, backoffSteps.length - 1)]
    backoffIndex++
    setStatus("reconnecting", status.error)
    reconnectTimer = setTimeout(() => attemptConnect(), delay)
  }

  function teardownSocket(socket) {
    if (!socket) return
    try { socket.removeAllListeners?.() } catch (e) {}
    try { socket.terminate ? socket.terminate() : socket.close() } catch (e) {}
  }

  function stopHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null }
    if (heartbeatTimeoutTimer) { clearTimeout(heartbeatTimeoutTimer); heartbeatTimeoutTimer = null }
  }

  function startHeartbeat(socket, myGeneration) {
    stopHeartbeat()
    if (typeof socket.ping !== "function") return // el WebSocket inyectado en tests puede no soportar ping/pong
    heartbeatInterval = setInterval(() => {
      if (myGeneration !== generation) return
      try { socket.ping() } catch (e) {}
      heartbeatTimeoutTimer = setTimeout(() => {
        if (myGeneration !== generation) return
        log("[ssn-transport] sin pong a tiempo — la conexión parece muerta, forzando reconexión")
        teardownSocket(socket)
        ws = null
        if (desiredConnected) { portIndex++; scheduleReconnect() }
      }, heartbeatTimeoutMs)
    }, heartbeatIntervalMs)
    socket.on("pong", () => {
      if (heartbeatTimeoutTimer) { clearTimeout(heartbeatTimeoutTimer); heartbeatTimeoutTimer = null }
    })
  }

  function attemptConnect() {
    if (!desiredConnected) return
    generation++
    const myGeneration = generation
    const port = ports[portIndex % ports.length]
    const url = `ws://${host}:${port}`
    let reconnectQueued = false
    const queueReconnectOnce = error => {
      if (reconnectQueued || myGeneration !== generation || !desiredConnected) return
      reconnectQueued = true
      if (error) setStatus("error", error.message || String(error))
      portIndex++
      scheduleReconnect()
    }
    setStatus("connecting", null)
    log(`[ssn-transport] socket opening ${url} (room ${maskSessionId(sessionId)})`)

    let socket
    try {
      socket = new WebSocketImpl(url)
    } catch (error) {
      handleConnectFailure(myGeneration, error)
      return
    }
    ws = socket

    socket.on("open", () => {
      if (myGeneration !== generation) return // conexión superada por una más reciente — ignorar
      backoffIndex = 0
      setStatus("connected", null, port)
      log(`[ssn-transport] socket open ${url}`)
      startHeartbeat(socket, myGeneration)
      try {
        const join = { join: sessionId, in: CHAT_CHANNEL, out: 3 }
        socket.send(JSON.stringify(join))
        log(`[ssn-transport] frame sent join=${maskSessionId(sessionId)} in=${CHAT_CHANNEL} out=3`)
      } catch (error) {
        log(`[ssn-transport] no se pudo enviar el join: ${error.message}`)
      }
    })

    socket.on("message", raw => {
      if (myGeneration !== generation) return
      log(`[ssn-transport] message received bytes=${Buffer.byteLength(raw)}`)
      let parsed
      try { parsed = JSON.parse(raw.toString()) } catch (error) {
        log(`[ssn-transport] first/invalid frame is not JSON: ${raw.toString().slice(0, 300)}`)
        return
      }
      if (!firstFrameLogged) {
        firstFrameLogged = true
        const keys = parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 20).join(",") : ""
        log(`[ssn-transport] first frame received type=${Array.isArray(parsed) ? "array" : typeof parsed} keys=${keys}`)
      }
      if (looksLikeChatPayload(parsed)) {
        log(`[ssn-transport] chat payload received platform=${String(parsed.type || "unknown").slice(0, 40)}`)
        onPayload(parsed)
        return
      }
      // callback de "join"/ack u otro control frame que no es chat — se
      // ignora silenciosamente, salvo el primero, que se registra para
      // poder diagnosticar si el formato real difiere del esperado.
      if (!firstUnrecognizedPayloadLogged) {
        firstUnrecognizedPayloadLogged = true
        log(`[ssn-transport] primer frame no reconocido como chat (puede ser normal, ej. ack de join): ${raw.toString().slice(0, 300)}`)
      }
    })

    socket.on("close", (code, reason) => {
      if (myGeneration !== generation) return
      log(`[ssn-transport] socket close code=${code} reason=${reason?.toString() || ""}`)
      stopHeartbeat()
      ws = null
      queueReconnectOnce()
    })

    socket.on("error", error => {
      if (myGeneration !== generation) return
      log(`[ssn-transport] socket error: ${error.message || error}`)
      queueReconnectOnce(error)
    })
  }

  function handleConnectFailure(myGeneration, error) {
    if (myGeneration !== generation) return
    log(`[ssn-transport] error de conexión: ${error.message}`)
    setStatus("error", error.message)
    if (desiredConnected) {
      portIndex++
      scheduleReconnect()
    }
  }

  function connect(newSessionId) {
    if (newSessionId !== undefined) setSessionId(newSessionId)
    if (desiredConnected && ws) return getStatus() // ya conectado/conectando — evita listeners duplicados
    desiredConnected = true
    backoffIndex = 0
    portIndex = 0
    clearReconnectTimer()
    attemptConnect()
    return getStatus()
  }

  function disconnect() {
    desiredConnected = false
    clearReconnectTimer()
    stopHeartbeat()
    generation++ // invalida cualquier callback en vuelo del socket anterior
    teardownSocket(ws)
    ws = null
    setStatus("not_connected", null)
    return getStatus()
  }

  function getStatus() {
    return { ...status, sessionConfigured: !!sessionId }
  }

  async function detect() {
    onDiscoveryChange("detecting", {})
    const result = await probeSocialStreamNinjaRelay({ WebSocket: WebSocketImpl, ports, host, log })
    onDiscoveryChange(result.detected ? "detected" : "not_detected", { port: result.port })
    return result
  }

  return { connect, disconnect, detect, getStatus, setSessionId, setPorts }
}

let defaultTransport = null
// Singleton conectado al adapter y al estado ya existentes — construido de
// forma perezosa, y solo con overrides reales en el primer llamado (igual
// que getDefaultActivityTracker en la Fase 1.5).
function getDefaultSocialStreamNinjaTransport(overrides) {
  if (!defaultTransport) {
    const merged = { ...overrides }
    if (!merged.onPayload) {
      merged.onPayload = payload => require("./social-stream-ninja-adapter.js").getDefaultSocialStreamNinjaAdapter().handlePayload(payload)
    }
    if (!merged.onStatusChange) {
      merged.onStatusChange = status => require("./social-stream-ninja-state.js").getDefaultSocialStreamNinjaState().setConnectionState(status.state, status.error, status.port)
    }
    if (!merged.log) merged.log = msg => console.log(msg)
    if (!merged.onDiscoveryChange) {
      merged.onDiscoveryChange = (state, details) => require("./social-stream-ninja-state.js").getDefaultSocialStreamNinjaState().setDiscoveryState(state, details)
    }
    defaultTransport = createSocialStreamNinjaTransport(merged)
  }
  return defaultTransport
}

module.exports = {
  createSocialStreamNinjaTransport, getDefaultSocialStreamNinjaTransport,
  probeSocialStreamNinjaRelay, looksLikeChatPayload, maskSessionId,
}
