const fs = require("fs")
const path = require("path")
const http = require("node:http")
const { WebSocketServer } = require("ws")
const { randomUUID } = require("node:crypto")
const overlayNetwork = require("./overlay-network.js")

const clients = new Set()
// _wss atiende las conexiones por el puerto HTTP (ruta /ws, sin puerto extra);
// _legacyWss es el puerto WebSocket aparte (7778 por defecto) que ya existía.
let _wss = null
let _legacyWss = null
let _server = null
let _handleRequest = null
let _activeConfig = null
let _started = false
let _status = emptyStatus()

const WS_PATH = "/ws"
const LOOPBACK_HOST = "127.0.0.1"
const ANY_HOST = "0.0.0.0"
const DEFAULT_HTTP_PORT = 7777

const OVERLAY_PATH = path.join(__dirname, "overlay.html")
// Overlay 2: segunda fuente para OBS con los widgets nuevos (avatares flotantes...).
const OVERLAY2_PATH = path.join(__dirname, "overlay2.html")
// Overlay 3: tercera fuente para OBS, para los widgets que no caben en las otras dos.
const OVERLAY3_PATH = path.join(__dirname, "overlay3.html")
// Overlay VTuber: objetos con fisica y sonidos de las Reacciones VTuber.
const OVERLAY_VTUBER_PATH = path.join(__dirname, "overlay-vtuber.html")
const VTUBER_KIT_DIR = path.join(__dirname, "overlay-vtuber")
const VTUBER_KIT_PATTERN = /^\/vtuber-kit\/([a-z][a-z-]{0,40}\.js)$/
const OVERLAY_PAGES = { "/overlay": OVERLAY_PATH, "/overlay2": OVERLAY2_PATH, "/overlay3": OVERLAY3_PATH, "/vtuber": OVERLAY_VTUBER_PATH }
const PANEL_DIR = path.join(__dirname, "..", "..", "mod-panel")
const API_TOKEN = randomUUID()

// carpeta donde se guardan los audios de emotes (local en la PC del streamer)
const { app } = require("electron")
const AUDIO_DIR = path.join(app.getPath("userData"), "emote-sounds")
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true })

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".m4a": "audio/mp4", ".webm": "audio/webm",
}

function emptyStatus() {
  return { running: false, error: null, httpPort: null, wsPort: null, host: null, wsError: null }
}

function start() {
  if (_started) return
  _started = true
  // Event Engine compartido: se registran Command Engine y Sound Trigger
  // Engine UNA sola vez aquí (no en twitch.js), porque start() siempre
  // corre al arrancar Mimiku, se conecte o no Twitch. Si el registro
  // dependiera de que se cargue twitch.js, un streamer que solo use SSN
  // (sin conectar nunca Twitch) no tendría comandos ni sound triggers.
  const eventEngine = require("../core/events/event-engine.js").getDefaultEventEngine()
  const vipService = require("./vips.js")
  vipService.init(payload => broadcast(payload))
  require("../core/interactions/command-engine.js").registerCommandEngine(eventEngine, {
    // La salida visual pertenece al runtime local, no a Twitch. Así los
    // minijuegos recibidos por SSN también llegan a la fuente de OBS.
    overlay: broadcast,
    notify: (channel, payload) => require("../integrations/twitch/twitch-adapter.js").sendToRenderer(channel, payload),
    vipService,
  })
  require("../core/interactions/sound-trigger-engine.js").registerSoundTriggerEngine(eventEngine)
  // Directos (tarjeta de fidelidad y Top 3 del chat): Twitch dice cuando
  // empieza cada directo y, sin ese dato, la actividad del chat lo mantiene abierto.
  require("./twitch-live-status.js").getDefaultLiveStatus().start()
  // Subathon: vigila cuando el contador llega a 0.
  require("./subathon.js").getDefaultSubathon().start()
  // Top 3 del chat: cuenta mensajes del directo actual y avisa al overlay cuando cambia.
  const chatTop = require("./chat-top.js").getDefaultChatTopService(snapshot => {
    broadcast({ type: "chat_top", ...snapshot })
    require("../integrations/twitch/twitch-adapter.js").sendToRenderer("chatTop:update", snapshot)
  })
  eventEngine.subscribe("chat_message", event => {
    try { chatTop.recordMessage(event) } catch (error) {
      console.warn("[chat-top] no se pudo contar el mensaje:", error.message)
    }
  })
  eventEngine.subscribe("chat_message", vipService.handleChatMessage)
  // Regalos de plataformas de directo (TikTok): puntos + donaciones + reglas de Mimic.
  const giftService = require("./gifts.js")
  giftService.registerGiftConsumer(eventEngine, giftService.getDefaultGiftService())
  // Reacciones VTuber: follows, subs, bits, regalos... -> objetos, voz y VTube Studio.
  require("./vtuber-reactions.js").getDefaultVtuberReactions().register(eventEngine)
  // Rangos (superfan): barrido periodico por cambio de mes o caducidad de overrides.
  // Solo se anuncia en el overlay la ENTRADA al rango; las salidas no se anuncian.
  require("./ranks.js").getDefaultRankService().start()
  eventEngine.subscribe("rank_change", event => {
    if (event.payload?.change !== "enter") return
    const label = require("./ranks.js").rankLabel(event.payload.rankId)
    broadcast({ type: "alert", text: `${event.actor.displayName} ahora es ${label}`, duration: 5000 })
  })

  // Actividad general de chat (Fase 1.5): viewers activos + XP/niveles/
  // widget de avatar/AFK/mini-reto. Mismo motivo que Command/Sound arriba —
  // registrado siempre al arrancar, nunca solo al conectar Twitch.
  const activityTracker = require("../core/interactions/activity-consumer.js")
    .getDefaultActivityTracker()
  require("../core/interactions/activity-consumer.js").registerActivityConsumer(eventEngine, activityTracker)
  require("../core/interactions/chat-activity-consumers.js").registerChatActivityConsumers(eventEngine, {
    xp: { getPointsPerMessage: event => vipService.pointsPerMessage(event, 2) },
    challenge: { announce: msg => require("../integrations/twitch/twitch-adapter.js").say(msg) },
    // Feed de chat multiplataforma para el Dashboard (Fase 1.6) — reemplaza
    // a "twitch:message" como fuente; ver docs/multiplatform-architecture.md.
    chatFeed: { notify: (channel, payload) => require("../integrations/twitch/twitch-adapter.js").sendToRenderer(channel, payload) },
  })

  const localApi = require("./local-api.js")
  const apiHandler = localApi.createLocalApiHandler({
    platform: require("./local-runtime.js").getLocalPlatform(),
    getChannel: () => require("./currentChannel.js").get(),
    token: API_TOKEN,
    broadcast,
    arenaService: require("./arena.js"),
  })
  // Social Stream Ninja es una fuente OPCIONAL: si el streamer nunca la
  // configura, esta ruta simplemente nunca recibe una request y no hace nada.
  // No es un requisito de arranque de Mimiku.
  const ssnRoute = localApi.createSocialStreamNinjaRoute({
    token: require("./app-config.js").getSocialStreamNinjaToken(),
    adapter: require("../integrations/social-stream-ninja/social-stream-ninja-adapter.js").getDefaultSocialStreamNinjaAdapter(),
  })
  _handleRequest = createRequestHandler({ localApi, apiHandler, ssnRoute })
  startNetwork(currentOverlayConfig())
}

// Con el servidor accesible desde la red local, la API, el panel de mods (que
// incrusta el token de la API) y la ruta de SSN solo deben responder a
// conexiones de esta misma máquina. El overlay, /assets y /audio son públicos.
function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress || ""
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.")
}

function createRequestHandler({ localApi, apiHandler, ssnRoute }) {
  return (req, res) => {
    const isPrivileged = req.url.startsWith(localApi.SSN_PATH_PREFIX)
      || req.url.startsWith("/api/v1/")
      || req.url.startsWith("/panel")
    if (isPrivileged && !isLoopbackRequest(req)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" })
      res.end("Solo disponible desde este equipo")
      return
    }
    if (req.url.startsWith(localApi.SSN_PATH_PREFIX)) {
      ssnRoute(req, res)
      return
    }
    if (req.url.startsWith("/api/v1/")) {
      apiHandler(req, res)
      return
    }
    const kitScript = VTUBER_KIT_PATTERN.exec(req.url.split("?")[0])
    if (kitScript) {
      // Scripts del overlay VTuber: solo nombres simples de esa carpeta.
      const file = path.join(VTUBER_KIT_DIR, kitScript[1])
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache, no-store, must-revalidate" })
      res.end(fs.readFileSync(file, "utf8"))
      return
    }
    if (Object.prototype.hasOwnProperty.call(OVERLAY_PAGES, req.url)) {
      // leer el archivo en cada request — sin cache
      const html = fs.readFileSync(OVERLAY_PAGES[req.url], "utf8")
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      })
      res.end(html)
    } else if (req.url === "/panel") {
      res.writeHead(302, { Location: "/panel/" }); res.end()
    } else if (req.url === "/panel/") {
      const html = fs.readFileSync(path.join(PANEL_DIR, "index.html"), "utf8")
        .replace("</head>", `<meta name="mimiku-api-token" content="${API_TOKEN}"></head>`)
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
      res.end(html)
    } else if (req.url.startsWith("/panel/")) {
      const fileName = path.basename(req.url.split("?")[0])
      const fp = path.join(PANEL_DIR, fileName)
      if (!fs.existsSync(fp)) { res.writeHead(404); res.end(); return }
      const type = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }[path.extname(fp)] || "application/octet-stream"
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" })
      fs.createReadStream(fp).pipe(res)
    } else if (req.url.startsWith("/assets/")) {
      const assetId = decodeURIComponent(req.url.replace("/assets/", "").split("?")[0])
      const fp = require("./local-assets.js").getLocalAssetStore().resolve(assetId)
      if (!fp) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" })
      fs.createReadStream(fp).pipe(res)
    } else if (req.url.startsWith("/audio/")) {
      // servir archivo de audio local
      const fname = decodeURIComponent(req.url.replace("/audio/", "").split("?")[0])
      const safe  = path.basename(fname)   // evita path traversal
      const fp    = path.join(AUDIO_DIR, safe)
      if (fs.existsSync(fp)) {
        const ext = path.extname(fp).toLowerCase()
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" })
        fs.createReadStream(fp).pipe(res)
      } else {
        res.writeHead(404); res.end()
      }
    } else {
      res.writeHead(404); res.end()
    }
  }
}

function currentOverlayConfig() {
  return require("./app-config.js").getAppConfig().overlay
}

function handleConnection(ws) {
  clients.add(ws)
  ws.on("close", () => clients.delete(ws))
  ws.on("message", data => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === "get_channel") {
        const ch = require("./currentChannel.js").get()
        ws.send(JSON.stringify({ type: "set_channel", channel: ch }))
      } else if (msg.type === "vtuber_hit") {
        // Un objeto del overlay VTuber golpeo la cabeza del modelo.
        require("./vtuber-reactions.js").getDefaultVtuberReactions().handleHit({ by: msg.by, direction: msg.direction })
          .catch(error => console.warn("[reacciones] impacto:", error.message))
      }
    } catch {}
  })
  const ch = require("./currentChannel.js").get()
  if (ch) ws.send(JSON.stringify({ type: "set_channel", channel: ch }))
  // Un overlay que se (re)conecta a mitad de directo recibe el Top 3 actual.
  try {
    ws.send(JSON.stringify(require("./widgets.js").chatTopConfigMessage()))
    ws.send(JSON.stringify(require("./widgets.js").floatAvatarsConfigMessage()))
    ws.send(JSON.stringify(require("./widgets.js").jailConfigMessage()))
    ws.send(JSON.stringify(require("./jail.js").getDefaultJail().state()))
    ws.send(JSON.stringify({ type: "chat_top", ...require("./chat-top.js").getDefaultChatTopService().snapshot() }))
    for (const message of require("./vtuber-reactions.js").getDefaultVtuberReactions().overlayState()) ws.send(JSON.stringify(message))
  } catch (error) {
    console.warn("[chat-top] no se pudo enviar el estado inicial:", error.message)
  }
  try {
    const subathon = require("./subathon.js").getDefaultSubathon()
    ws.send(JSON.stringify({ type: "subathon_timer", ...subathon.timer.snapshot() }))
    for (const type of subathon.goals.types) ws.send(JSON.stringify({ type: "subathon_goal", ...subathon.goals.snapshot(type) }))
  } catch (error) {
    console.warn("[subathon] no se pudo enviar el estado inicial:", error.message)
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
}

function listenWebSocket(port, host) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host })
    wss.once("error", reject)
    wss.once("listening", () => {
      wss.removeListener("error", reject)
      wss.on("error", error => reportServerError("ws:" + port, error))
      resolve(wss)
    })
  })
}

function closeServer(server) {
  return new Promise(resolve => {
    if (!server) { resolve(); return }
    server.close(() => resolve())
    // Sin esto, las conexiones keep-alive mantienen el puerto ocupado y un
    // reinicio con el mismo puerto falla con EADDRINUSE.
    server.closeAllConnections?.()
  })
}

async function stopNetwork() {
  for (const client of clients) {
    try { client.terminate() } catch {}
  }
  clients.clear()
  const [server, wss, legacy] = [_server, _wss, _legacyWss]
  _server = _wss = _legacyWss = null
  await Promise.all([closeServer(server), closeServer(wss), closeServer(legacy)])
}

// Levanta HTTP (+ WebSocket) con la configuración dada. Nunca lanza: deja el
// resultado en _status para que la UI lo consulte (ver ipc "overlay:getStatus").
async function startNetwork(config) {
  await stopNetwork()
  const host = config.allowLan ? ANY_HOST : LOOPBACK_HOST
  const server = http.createServer(_handleRequest)
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", handleConnection)
  server.on("upgrade", (req, socket, head) => {
    if (req.url.split("?")[0] !== WS_PATH) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req))
  })
  try {
    await listen(server, config.httpPort, host)
    // Recién ahora: un fallo de listen() ya lo maneja el catch de abajo.
    server.on("error", error => reportServerError("http:" + config.httpPort, error))
  } catch (error) {
    const friendly = overlayNetwork.describeListenError(error, { host, port: config.httpPort })
    _status = { ...emptyStatus(), error: friendly, httpPort: config.httpPort, host }
    console.error("[overlay]", friendly)
    return _status
  }
  _server = server
  _wss = wss
  _activeConfig = config

  // El puerto WebSocket aparte es opcional: si está ocupado el overlay sigue
  // funcionando por /ws en el puerto HTTP, así que solo se avisa.
  let wsError = null
  if (config.wsPort) {
    try {
      _legacyWss = await listenWebSocket(config.wsPort, host)
      _legacyWss.on("connection", handleConnection)
    } catch (error) {
      wsError = overlayNetwork.describeListenError(error, { host, port: config.wsPort })
      console.error("[overlay]", wsError)
    }
  }
  _status = {
    running: true, error: null, httpPort: config.httpPort, host, wsError,
    wsPort: _legacyWss ? config.wsPort : null,
  }
  console.log(`[overlay] ${host}:${config.httpPort} / ws ${_status.wsPort || "solo /ws"}`)
  return _status
}

// Aplica una configuración nueva sin cerrar la app. Si no se puede (puerto
// ocupado, sin permisos), restaura la anterior y devuelve el motivo.
async function reconfigure(config) {
  if (!_started) throw new Error("El servidor local todavía no se inició")
  const previous = _activeConfig
  const status = await startNetwork(config)
  if (status.running) return { ok: true, status }
  const error = status.error
  if (previous) await startNetwork(previous)
  return { ok: false, error, status: _status }
}

// Error de ejecución con el servidor ya levantado (el de arranque lo maneja
// startNetwork). Queda como estado consultable en vez de una excepción sin
// capturar que cerraría toda la app.
function reportServerError(where, error) {
  const friendly = `El servidor local (${where}) falló: ${error.message}`
  _status = { ..._status, running: false, error: friendly }
  console.error("[overlay]", friendly)
}

function getStatus() { return _status }

function stop() {
  stopNetwork().catch(() => {})
  _started = false
  _activeConfig = null
  _status = emptyStatus()
}

// Base para URLs que Mimiku genera hacia su propio servidor (audio, assets).
function getBaseUrl() {
  return `http://${LOOPBACK_HOST}:${_status.httpPort || DEFAULT_HTTP_PORT}`
}

function broadcast(payload) {
  const raw = JSON.stringify(payload)
  let sent = 0
  for (const ws of clients) if (ws.readyState === 1) { ws.send(raw); sent++ }
  console.log("[overlay] broadcast", payload.type, "→", sent, "de", clients.size, "clientes")
}

module.exports = { start, stop, reconfigure, broadcast, clients, getApiToken: () => API_TOKEN, getStatus, getBaseUrl }
