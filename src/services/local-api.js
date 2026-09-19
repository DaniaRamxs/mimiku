const { randomUUID } = require("node:crypto")
const validate = require("../core/ipc-validation.js")

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

async function readJson(req, maxBytes = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error("Solicitud demasiado grande")
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  let parsed
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) }
  catch { throw new Error("JSON inválido") }
  validateJsonTree(parsed)
  return parsed
}

function validateJsonTree(value, depth = 0, state = { properties: 0 }) {
  if (depth > 8) throw new Error("Payload JSON no permitido")
  if (typeof value === "string" && value.length > 32768) throw new Error("Payload JSON no permitido")
  if (value === null || typeof value !== "object") return
  for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Payload JSON no permitido")
    if (++state.properties > 1000) throw new Error("Payload JSON no permitido")
    validateJsonTree(value[key], depth + 1, state)
  }
}

function normalizedIdentity(value) {
  const input = validate.plainObject(value, "identidad")
  const platform = validate.text(input.platform, { name: "plataforma", max: 30, required: true }).toLowerCase()
  if (!/^[a-z0-9_-]+$/.test(platform)) throw new Error("Plataforma inválida")
  return {
    platform,
    platformUserId: validate.text(input.platformUserId, { max: 160 }),
    username: validate.text(input.username, { name: "usuario", max: 80, required: true }),
    display: validate.text(input.display || input.displayName, { max: 100 }),
    avatarUrl: validate.text(input.avatarUrl, { max: 1000 }),
  }
}

function idempotencyKey(req, body) {
  return validate.text(req.headers["idempotency-key"] || body.idempotencyKey || randomUUID(), { max: 200, required: true })
}

// Endpoint para Social Stream Ninja (`&postserver=` del dock de SSN).
// Vive en el mismo servidor HTTP local que /api/v1/*, pero con su propia
// ruta y su propia autorización: SSN no puede configurarse para enviar la
// cabecera x-mimiku-token que usa /api/v1/*, así que el token viaja en la
// URL (segmento de path) que el streamer copia una sola vez a SSN.
// Todo el body se trata como dato externo no confiable: JSON inválido,
// estructura inesperada o payloads grandes se rechazan sin tumbar el
// servidor ni ejecutar ninguna lógica de negocio aquí — eso lo decide
// exclusivamente el SocialStreamNinjaAdapter inyectado.
const SSN_PATH_PREFIX = "/api/integrations/social-stream-ninja/events/"
const SSN_MAX_BYTES = 64 * 1024 // un mensaje de chat nunca necesita más que esto

function createSocialStreamNinjaRoute({ token, adapter }) {
  return async function handleSocialStreamNinja(req, res) {
    const url = new URL(req.url, "http://127.0.0.1")
    if (!url.pathname.startsWith(SSN_PATH_PREFIX)) return false
    if (req.method !== "POST") { send(res, 405, { error: "Método no permitido" }); return true }
    const suppliedToken = decodeURIComponent(url.pathname.slice(SSN_PATH_PREFIX.length).split("/")[0] || "")
    if (!token || suppliedToken !== token) { send(res, 401, { error: "Token inválido" }); return true }
    try {
      const body = await readJson(req, SSN_MAX_BYTES)
      send(res, 200, adapter.handlePayload(body))
    } catch (error) {
      send(res, 400, { error: error.message })
    }
    return true
  }
}

function createLocalApiHandler({ platform, getChannel, token, broadcast = () => {}, arenaService = null }) {
  function activeChannel(url) { return validate.text(url.searchParams.get("channel") || getChannel() || "local", { max: 80, required: true }).toLowerCase() }
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
        const body = validate.plainObject(await readJson(req), "compra")
        const viewer = platform.identities.resolve(normalizedIdentity(body.identity))
        const purchase = platform.shop.purchase({
          channelId: ch, viewerId: viewer.id, itemId: validate.text(body.itemId, { max: 120, required: true }),
          quantity: body.quantity === undefined ? 1 : validate.integer(body.quantity, { min: 1, max: 99 }),
          idempotencyKey: idempotencyKey(req, body),
        })
        send(res, 200, { purchase, balance: platform.economy.getBalance(ch, viewer.id), inventory: platform.shop.inventory(ch, viewer.id) })
      } else if (req.method === "GET" && url.pathname === "/api/v1/mimics") {
        send(res, 200, { mimics: platform.mimics.list(ch), boxes: platform.mimics.listBoxes(ch) })
      } else if (req.method === "POST" && url.pathname === "/api/v1/mimics/use") {
        const body = validate.plainObject(await readJson(req), "uso de Mimic")
        const viewer = platform.identities.resolve(normalizedIdentity(body.identity))
        const use = platform.mimics.use(ch, viewer.id, validate.text(body.mimicId, { max: 120, required: true }), idempotencyKey(req, body))
        send(res, 200, { use })
      } else if (req.method === "POST" && url.pathname === "/api/v1/mimics/gift") {
        const body = validate.plainObject(await readJson(req), "regalo")
        const from = platform.identities.resolve(normalizedIdentity(body.identity))
        const to = platform.identities.resolve(normalizedIdentity(body.recipient))
        const quantity = body.quantity === undefined ? 1 : validate.integer(body.quantity, { min: 1, max: 99 })
        const gift = platform.mimics.gift(ch, from.id, to.id, validate.text(body.mimicId, { max: 120, required: true }), quantity, idempotencyKey(req, body))
        send(res, 200, { gift })
      } else if (req.method === "GET" && url.pathname === "/api/v1/widgets") {
        send(res, 200, { widgets: platform.moderation.listWidgets(ch) })
      } else if (req.method === "POST" && url.pathname === "/api/v1/widgets") {
        const body = validate.plainObject(await readJson(req), "widget")
        const widget = platform.moderation.saveWidget(ch, {
          id: validate.text(body.id, { max: 100 }),
          type: validate.text(body.type, { max: 20, required: true }),
          content: validate.text(body.content, { max: 4000 }),
          x: Number(body.x) || 0, y: Number(body.y) || 0,
          w: Number(body.w) || 480, h: Number(body.h) || 300,
          visible: body.visible !== false,
          config: validate.plainObject(body.config || {}, "configuración de widget"),
        })
        broadcast({ type: "widget_add", widget_id: widget.id, content_type: widget.type, content: widget.content, x: widget.x, y: widget.y, w: widget.w, h: widget.h })
        send(res, 200, { widget })
      } else if (req.method === "POST" && url.pathname === "/api/v1/commands") {
        const body = validate.plainObject(await readJson(req), "comando")
        const type = validate.text(body.type, { max: 30, required: true })
        if (!new Set(["alert", "widget_add"]).has(type)) throw new Error("Tipo de comando no permitido")
        const payload = validate.plainObject(body.payload || {}, "contenido")
        broadcast({
          type,
          content_type: validate.text(payload.content_type, { max: 20 }),
          content: validate.text(payload.content, { max: 4000 }),
          text: validate.text(payload.text, { max: 1000 }),
          duration: Math.min(60000, Math.max(0, Number(payload.duration) || 0)),
          widget_id: validate.text(payload.widget_id, { max: 100 }),
        })
        send(res, 200, { ok: true })
      } else if (req.method === "POST" && url.pathname === "/api/v1/arena/join") {
        const body = validate.plainObject(await readJson(req), "entrada de Arena")
        if (!arenaService?.joinRoom) throw new Error("Arena no está iniciada")
        send(res, 200, { player: arenaService.joinRoom(normalizedIdentity(body.identity)) })
      } else if (req.method === "GET" && url.pathname === "/api/v1/arena") {
        const room = arenaService?.getRoom?.() || null
        send(res, 200, { room })
      } else if (req.method === "POST" && url.pathname === "/api/v1/arena/move") {
        const body = validate.plainObject(await readJson(req), "jugada de Arena")
        const viewer = platform.identities.resolve(normalizedIdentity(body.identity))
        if (!arenaService?.submitWord) throw new Error("Arena no está iniciada")
        send(res, 200, { result: await arenaService.submitWord(viewer.username, validate.text(body.word, { max: 80, required: true })) })
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

module.exports = { createLocalApiHandler, createSocialStreamNinjaRoute, readJson, validateJsonTree, normalizedIdentity, SSN_PATH_PREFIX }
