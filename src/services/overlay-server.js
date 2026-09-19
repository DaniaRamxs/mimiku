const fs = require("fs")
const path = require("path")
const { WebSocketServer } = require("ws")
const { randomUUID } = require("node:crypto")

const clients = new Set()
let _wss = null
let _server = null
let _started = false
let _status = { running: false, error: null }

const OVERLAY_PATH = path.join(__dirname, "overlay.html")
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
  eventEngine.subscribe("chat_message", vipService.handleChatMessage)
  // Regalos de plataformas de directo (TikTok): puntos + donaciones + reglas de Mimic.
  const giftService = require("./gifts.js")
  giftService.registerGiftConsumer(eventEngine, giftService.getDefaultGiftService())
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
    .getDefaultActivityTracker({ onKingUpdate: king => king && broadcast({ type: "king_update", username: king.username, display: king.displayName, messages: king.messages }) })
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
  _server = require("http").createServer((req, res) => {
    if (req.url.startsWith(localApi.SSN_PATH_PREFIX)) {
      ssnRoute(req, res)
      return
    }
    if (req.url.startsWith("/api/v1/")) {
      apiHandler(req, res)
      return
    }
    if (req.url === "/overlay") {
      // leer el archivo en cada request — sin cache
      const html = fs.readFileSync(OVERLAY_PATH, "utf8")
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
  })

  _wss = new WebSocketServer({ port: 7778, host: "127.0.0.1" })
  _wss.on("connection", ws => {
    clients.add(ws)
    ws.on("close", () => clients.delete(ws))
    ws.on("message", data => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === "get_channel") {
          const ch = require("./currentChannel.js").get()
          ws.send(JSON.stringify({ type: "set_channel", channel: ch }))
        }
      } catch {}
    })
    const ch = require("./currentChannel.js").get()
    if (ch) ws.send(JSON.stringify({ type: "set_channel", channel: ch }))
  })
  // Sin este handler, un puerto 7778 ocupado (otra instancia de Mimiku,
  // otra app) tira una excepción no capturada que cierra toda la app.
  _wss.on("error", error => reportServerError("ws:7778", error))

  _server.on("error", error => reportServerError("http:7777", error))
  _server.listen(7777, "127.0.0.1", () => {
    _status = { running: true, error: null }
    console.log("[overlay] 127.0.0.1:7777 / ws :7778")
  })
}

// Puerto ocupado (u otro fallo de arranque) no debe crashear Mimiku — se
// registra un estado consultable desde la UI (ver ipc "overlay:getStatus")
// en vez de dejar una excepción sin capturar.
function reportServerError(where, error) {
  const friendly = error.code === "EADDRINUSE"
    ? `No se pudo iniciar el servidor local (${where}). Comprueba si otra instancia de Mimiku u otra aplicación está usando ese puerto.`
    : `El servidor local (${where}) falló: ${error.message}`
  _status = { running: false, error: friendly }
  console.error("[overlay]", friendly)
}

function getStatus() { return _status }

function stop() {
  for (const client of clients) {
    try { client.terminate() } catch {}
  }
  clients.clear()
  try { _wss?.close() } catch {}
  try { _server?.close() } catch {}
  _wss = null
  _server = null
  _started = false
  _status = { running: false, error: null }
}

function broadcast(payload) {
  const raw = JSON.stringify(payload)
  let sent = 0
  for (const ws of clients) if (ws.readyState === 1) { ws.send(raw); sent++ }
  console.log("[overlay] broadcast", payload.type, "→", sent, "de", clients.size, "clientes")
}

module.exports = { start, stop, broadcast, clients, getApiToken: () => API_TOKEN, getStatus }
