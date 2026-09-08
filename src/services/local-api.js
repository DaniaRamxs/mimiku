const { randomUUID } = require("node:crypto")

function send(res, status, body) {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": data.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  res.end(data)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new Error("Solicitud demasiado grande")
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { throw new Error("JSON inválido") }
}

function createLocalApiHandler({ platform, getChannel, token, broadcast = () => {}, arenaService = null }) {
  function activeChannel(url) { return (url.searchParams.get("channel") || getChannel() || "local").toLowerCase() }
  function authorize(req) { return token && req.headers["x-mimiku-token"] === token }

  return async function handleLocalApi(req, res) {
    const url = new URL(req.url, "http://127.0.0.1")
    if (!url.pathname.startsWith("/api/v1/")) return false
    if (!authorize(req)) { send(res, 401, { error: "Sesión local no autorizada" }); return true }
    const ch = activeChannel(url)
    try {
      if (req.method === "GET" && url.pathname === "/api/v1/status") {
        send(res, 200, { ok: true, channel: ch, mode: "local-first" })
      } else if (req.method === "GET" && url.pathname === "/api/v1/overview") {
        const ranking = platform.economy.ranking(ch, 10)
        const totals = platform.db.prepare("SELECT COUNT(*) viewers,COALESCE(SUM(balance),0) points FROM wallets WHERE channel_id=?").get(ch)
        send(res, 200, { ...totals, ranking })
      } else if (req.method === "GET" && url.pathname === "/api/v1/shop") {
        send(res, 200, { items: platform.shop.list(ch) })
      } else if (req.method === "POST" && url.pathname === "/api/v1/shop/purchase") {
        const body = await readJson(req)
        const viewer = platform.identities.resolve(body.identity || {})
        const purchase = platform.shop.purchase({
          channelId: ch, viewerId: viewer.id, itemId: body.itemId,
          quantity: body.quantity || 1,
          idempotencyKey: String(req.headers["idempotency-key"] || body.idempotencyKey || randomUUID()),
        })
        send(res, 200, { purchase, balance: platform.economy.getBalance(ch, viewer.id), inventory: platform.shop.inventory(ch, viewer.id) })
      } else if (req.method === "GET" && url.pathname === "/api/v1/mimics") {
        send(res, 200, { mimics: platform.mimics.list(ch), boxes: platform.mimics.listBoxes(ch) })
      } else if (req.method === "POST" && url.pathname === "/api/v1/mimics/use") {
        const body = await readJson(req)
        const viewer = platform.identities.resolve(body.identity || {})
        const use = platform.mimics.use(ch, viewer.id, body.mimicId, String(req.headers["idempotency-key"] || body.idempotencyKey || randomUUID()))
        send(res, 200, { use })
      } else if (req.method === "POST" && url.pathname === "/api/v1/mimics/gift") {
        const body = await readJson(req)
        const from = platform.identities.resolve(body.identity || {})
        const to = platform.identities.resolve(body.recipient || {})
        const gift = platform.mimics.gift(ch, from.id, to.id, body.mimicId, body.quantity || 1, String(req.headers["idempotency-key"] || body.idempotencyKey || randomUUID()))
        send(res, 200, { gift })
      } else if (req.method === "GET" && url.pathname === "/api/v1/widgets") {
        send(res, 200, { widgets: platform.moderation.listWidgets(ch) })
      } else if (req.method === "POST" && url.pathname === "/api/v1/widgets") {
        const body = await readJson(req)
        const widget = platform.moderation.saveWidget(ch, body)
        broadcast({ type: "widget_add", widget_id: widget.id, content_type: widget.type, content: widget.content, x: widget.x, y: widget.y, w: widget.w, h: widget.h })
        send(res, 200, { widget })
      } else if (req.method === "POST" && url.pathname === "/api/v1/commands") {
        const body = await readJson(req)
        broadcast({ type: body.type || "alert", ...(body.payload || {}) })
        send(res, 200, { ok: true })
      } else if (req.method === "POST" && url.pathname === "/api/v1/arena/join") {
        const body = await readJson(req)
        if (!arenaService?.joinRoom) throw new Error("Arena no está iniciada")
        send(res, 200, { player: arenaService.joinRoom(body.identity || {}) })
      } else if (req.method === "GET" && url.pathname === "/api/v1/arena") {
        const room = arenaService?.getRoom?.() || null
        send(res, 200, { room })
      } else if (req.method === "POST" && url.pathname === "/api/v1/arena/move") {
        const body = await readJson(req)
        const viewer = platform.identities.resolve(body.identity || {})
        if (!arenaService?.submitWord) throw new Error("Arena no está iniciada")
        send(res, 200, { result: await arenaService.submitWord(viewer.username, body.word) })
      } else {
        send(res, 404, { error: "Ruta local no encontrada" })
      }
    } catch (error) {
      const status = /saldo insuficiente|no disponible|no encontrado/i.test(error.message) ? 409 : 400
      send(res, status, { error: error.message })
    }
    return true
  }
}

module.exports = { createLocalApiHandler, readJson }
