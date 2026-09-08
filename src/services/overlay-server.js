const fs = require("fs")
const path = require("path")
const { WebSocketServer } = require("ws")
const { randomUUID } = require("node:crypto")

const clients = new Set()
let _wss = null

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
  const apiHandler = require("./local-api.js").createLocalApiHandler({
    platform: require("./local-runtime.js").getLocalPlatform(),
    getChannel: () => require("./currentChannel.js").get(),
    token: API_TOKEN,
    broadcast,
    arenaService: require("./arena.js"),
  })
  const server = require("http").createServer((req, res) => {
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

  server.listen(7777, "127.0.0.1", () => console.log("[overlay] 127.0.0.1:7777 / ws :7778"))
}

function broadcast(payload) {
  const raw = JSON.stringify(payload)
  let sent = 0
  for (const ws of clients) if (ws.readyState === 1) { ws.send(raw); sent++ }
  console.log("[overlay] broadcast", payload.type, "→", sent, "de", clients.size, "clientes")
}

module.exports = { start, broadcast, clients, getApiToken: () => API_TOKEN }
