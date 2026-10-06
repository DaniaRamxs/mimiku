// services/canje-server.js — servidor PUBLICO de la pagina de canje.
//
// ngrok reenvia las visitas de internet a este puerto y llegan como si vinieran
// de 127.0.0.1. Por eso es un servidor aparte del overlay (7777): si ngrok
// apuntara alli, el panel de mods y la API local ("solo desde este equipo")
// quedarian abiertos a internet. Aqui solo existen la pagina, las imagenes del
// gachapon y las rutas de API de abajo; todo lo demas responde 404.
//
// El viewer entra con Twitch (flujo implicito, solo Client ID publico, sin
// secretos). El token de Twitch se valida UNA vez en /api/session y Mimiku
// entrega su propia sesion firmada (30 dias) con el id de usuario que dio
// Twitch; el navegador nunca elige el id.
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { handleGachaApi, GACHA_ROUTES } = require("./canje-gacha.js")
const { handleGamesApi, GAMES_ROUTES } = require("./canje-games.js")
const { handleEffectsApi, EFFECTS_ROUTES } = require("./canje-effects.js")
const { handlePassApi, PASS_ROUTES } = require("./canje-pass.js")
const { handleSupportApi, SUPPORT_ROUTES } = require("./canje-support.js")
const { handleProfilesApi, PROFILE_ROUTES } = require("./canje-profiles.js")
const { handleLiveApi, LIVE_ROUTES } = require("./canje-live.js")
const { handleRewardsApi, REWARDS_ROUTES } = require("./canje-rewards.js")
const { handlePostsApi, POSTS_ROUTES } = require("./canje-posts.js")
const { handleDuelsApi, DUELS_ROUTES } = require("./canje-duels.js")
const { handleJobsApi, JOBS_ROUTES } = require("./canje-jobs.js")

const WEB_DIR = path.join(__dirname, "..", "canje-web")
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/gacha-cards.js": ["gacha-cards.js", "text/javascript; charset=utf-8"],
  "/fx.js": ["fx.js", "text/javascript; charset=utf-8"],
  "/plinko.js": ["plinko.js", "text/javascript; charset=utf-8"],
  "/games-kit.js": ["games-kit.js", "text/javascript; charset=utf-8"],
  "/game-scratch.js": ["game-scratch.js", "text/javascript; charset=utf-8"],
  "/game-wheel.js": ["game-wheel.js", "text/javascript; charset=utf-8"],
  "/game-slots.js": ["game-slots.js", "text/javascript; charset=utf-8"],
  "/game-hilo.js": ["game-hilo.js", "text/javascript; charset=utf-8"],
  "/game-mines.js": ["game-mines.js", "text/javascript; charset=utf-8"],
  "/jobs-kit.js": ["jobs-kit.js", "text/javascript; charset=utf-8"],
  "/job-dishes.js": ["job-dishes.js", "text/javascript; charset=utf-8"],
  "/job-mine.js": ["job-mine.js", "text/javascript; charset=utf-8"],
  "/job-fish.js": ["job-fish.js", "text/javascript; charset=utf-8"],
  "/jobs.css": ["jobs.css", "text/css; charset=utf-8"],
  "/name-styles.css": ["name-styles.css", "text/css; charset=utf-8"],
  "/effects-ui.js": ["effects-ui.js", "text/javascript; charset=utf-8"],
  "/pass-ui.js": ["pass-ui.js", "text/javascript; charset=utf-8"],
  "/sub-pass-ui.js": ["sub-pass-ui.js", "text/javascript; charset=utf-8"],
  "/top-ui.js": ["top-ui.js", "text/javascript; charset=utf-8"],
  "/top.css": ["top.css", "text/css; charset=utf-8"],
  "/sleeves.css": ["sleeves.css", "text/css; charset=utf-8"],
  "/ranks.css": ["ranks.css", "text/css; charset=utf-8"],
  "/pass.css": ["pass.css", "text/css; charset=utf-8"],
  "/gacha-exchange.js": ["gacha-exchange.js", "text/javascript; charset=utf-8"],
  "/gacha-market-ui.js": ["gacha-market-ui.js", "text/javascript; charset=utf-8"],
  "/gacha-trades-ui.js": ["gacha-trades-ui.js", "text/javascript; charset=utf-8"],
  "/sound-kit.js": ["sound-kit.js", "text/javascript; charset=utf-8"],
  "/live-feed.js": ["live-feed.js", "text/javascript; charset=utf-8"],
  "/live.css": ["live.css", "text/css; charset=utf-8"],
  "/rewards-ui.js": ["rewards-ui.js", "text/javascript; charset=utf-8"],
  "/social-actions.js": ["social-actions.js", "text/javascript; charset=utf-8"],
  "/game-blackjack.js": ["game-blackjack.js", "text/javascript; charset=utf-8"],
  "/blackjack.css": ["blackjack.css", "text/css; charset=utf-8"],
  "/hikki-dealer.png": ["hikki-dealer.png", "image/png"],
  "/rewards.css": ["rewards.css", "text/css; charset=utf-8"],
  "/gacha-fx.js": ["gacha-fx.js", "text/javascript; charset=utf-8"],
  "/gacha-cinematic.js": ["gacha-cinematic.js", "text/javascript; charset=utf-8"],
  "/gacha-machine.js": ["gacha-machine.js", "text/javascript; charset=utf-8"],
  "/gacha-machine.css": ["gacha-machine.css", "text/css; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/gacha-exchange.css": ["gacha-exchange.css", "text/css; charset=utf-8"],
  "/fx.css": ["fx.css", "text/css; charset=utf-8"],
  "/plinko.css": ["plinko.css", "text/css; charset=utf-8"],
  "/games.css": ["games.css", "text/css; charset=utf-8"],
  "/profile-decor.js": ["profile-decor.js", "text/javascript; charset=utf-8"],
  "/profile-kit.js": ["profile-kit.js", "text/javascript; charset=utf-8"],
  "/profile-ui.js": ["profile-ui.js", "text/javascript; charset=utf-8"],
  "/community-ui.js": ["community-ui.js", "text/javascript; charset=utf-8"],
  "/achievements-ui.js": ["achievements-ui.js", "text/javascript; charset=utf-8"],
  "/posts-ui.js": ["posts-ui.js", "text/javascript; charset=utf-8"],
  "/posts.css": ["posts.css", "text/css; charset=utf-8"],
  "/stream-ui.js": ["stream-ui.js", "text/javascript; charset=utf-8"],
  "/stream.css": ["stream.css", "text/css; charset=utf-8"],
  "/duels-ui.js": ["duels-ui.js", "text/javascript; charset=utf-8"],
  "/duels.css": ["duels.css", "text/css; charset=utf-8"],
  "/community.css": ["community.css", "text/css; charset=utf-8"],
  "/cosmetic-spotlight.js": ["cosmetic-spotlight.js", "text/javascript; charset=utf-8"],
  "/spotlight.css": ["spotlight.css", "text/css; charset=utf-8"],
  "/profile.css": ["profile.css", "text/css; charset=utf-8"],
  "/profile-cosmetics.css": ["profile-cosmetics.css", "text/css; charset=utf-8"],
  "/profile-cosmetics-2.css": ["profile-cosmetics-2.css", "text/css; charset=utf-8"],
}
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }
const MAX_BODY_BYTES = 2048
const API_ROUTES = { "/api/config": "GET", "/api/session": "POST", "/api/state": "GET", "/api/redeem": "POST", "/api/buy": "POST", "/api/open": "POST" }
const TOKEN_CACHE_MS = 5 * 60 * 1000
const BAD_TOKEN_CACHE_MS = 30 * 1000
const TOKEN_CACHE_MAX = 2000
const API_REQUESTS_PER_MINUTE = 60
const VALIDATE_TIMEOUT_MS = 8000
const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000
const SESSION_PREFIX = "v1"

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-src https://player.twitch.tv; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}

// Valida tokens de viewers contra Twitch y exige que sean de NUESTRA app
// (un token emitido para otra app no sirve aqui).
function createTwitchValidator({ getClientId, fetchImpl = globalThis.fetch, now = Date.now }) {
  const cache = new Map() // sha256(token) -> { user, until }

  function remember(key, user, ttl) {
    if (cache.size >= TOKEN_CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(key, { user, until: now() + ttl })
  }

  // Devuelve { twitchId, login } o null.
  async function validate(token) {
    const value = String(token || "").trim()
    if (!value || value.length > 200) return null
    const key = crypto.createHash("sha256").update(value).digest("hex")
    const hit = cache.get(key)
    if (hit && hit.until > now()) return hit.user
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS)
    let response
    try {
      response = await fetchImpl("https://id.twitch.tv/oauth2/validate", { headers: { Authorization: `OAuth ${value}` }, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
    if (response.status === 401) { remember(key, null, BAD_TOKEN_CACHE_MS); return null }
    if (!response.ok) throw new Error(`Twitch respondió ${response.status}`)
    const info = await response.json()
    const clientId = String(getClientId() || "")
    const user = clientId && info.client_id === clientId && info.user_id ? { twitchId: String(info.user_id), login: String(info.login || "") } : null
    const ttl = user ? Math.min(TOKEN_CACHE_MS, Math.max(0, Number(info.expires_in) || 0) * 1000) : BAD_TOKEN_CACHE_MS
    remember(key, user, ttl)
    return user
  }

  return { validate }
}

// Sesiones propias: "v1.<datos>.<firma>" con HMAC-SHA256. No se guardan en
// ningun lado; cambiar la clave invalida todas las sesiones a la vez.
// `getKey()` -> string secreta (se crea una vez y se guarda cifrada).
function createSessionSigner({ getKey, now = Date.now, lifetimeMs = SESSION_MS }) {
  function sign(data) {
    return crypto.createHmac("sha256", getKey()).update(`${SESSION_PREFIX}.${data}`).digest("base64url")
  }

  function issue(user) {
    const expiresAt = now() + lifetimeMs
    const data = Buffer.from(JSON.stringify({ id: user.twitchId, login: user.login, exp: expiresAt })).toString("base64url")
    return { token: `${SESSION_PREFIX}.${data}.${sign(data)}`, expiresAt }
  }

  // Devuelve { twitchId, login } o null (firma mala, formato raro o caducada).
  function verify(token) {
    const parts = String(token || "").split(".")
    if (parts.length !== 3 || parts[0] !== SESSION_PREFIX || parts[1].length > 600) return null
    const expected = Buffer.from(sign(parts[1]))
    const given = Buffer.from(parts[2])
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null
    let payload
    try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) } catch { return null }
    if (!payload || typeof payload.id !== "string" || !payload.id || !(Number(payload.exp) > now())) return null
    return { twitchId: payload.id, login: String(payload.login || "") }
  }

  return { issue, verify }
}

function createRateLimiter(limit, now = Date.now) {
  const hits = new Map()
  return key => {
    const windowStart = now() - 60_000
    const recent = (hits.get(key) || []).filter(time => time > windowStart)
    if (recent.length >= limit) { hits.set(key, recent); return false }
    recent.push(now())
    hits.set(key, recent)
    if (hits.size > 5000) hits.delete(hits.keys().next().value)
    return true
  }
}

const REDEEM_MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  unavailable: "Ya no tienes ese Mimic.",
  "rate-limit": "Vas muy rápido, espera un minuto.",
}

const BUY_MESSAGES = {
  "unknown-viewer": REDEEM_MESSAGES["unknown-viewer"],
  "not-for-sale": "Ese cofre ya no está a la venta.",
  insufficient: "No te alcanzan los puntos.",
  "rate-limit": REDEEM_MESSAGES["rate-limit"],
  "bad-quantity": "Cantidad no válida.",
}

const OPEN_MESSAGES = {
  "unknown-viewer": REDEEM_MESSAGES["unknown-viewer"],
  "no-chest": "Ya no tienes ese cofre.",
  "no-mimics": "El streamer todavía no creó Mimics para repartir.",
  "rate-limit": REDEEM_MESSAGES["rate-limit"],
  "bad-quantity": "Cantidad no válida.",
}

// Cantidad de cofres pedida (1 si no viene). La valida canje-data.
function requestQuantity(body) {
  return body.quantity === undefined ? 1 : body.quantity
}

// Lo que la pagina necesita del directo (null si no se sabe: sin token de Twitch).
function publicStream(state) {
  if (!state) return null
  const login = /^[a-z0-9_]{1,25}$/i.test(String(state.login || "")) ? String(state.login).toLowerCase() : ""
  if (!state.live) return { live: false, login }
  const thumbnail = /^https:\/\/static-cdn\.jtvnw\.net\//.test(state.thumbnail || "") ? state.thumbnail : ""
  return {
    live: true, login, display: String(state.display || login).slice(0, 40), title: String(state.title || "").slice(0, 200),
    game: String(state.game || "").slice(0, 80), viewers: Number(state.viewers) || 0, startedAt: state.startedAt || null,
    streamId: state.streamId || null, thumbnail,
  }
}

function requestKey(body) {
  return typeof body.key === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(body.key) ? body.key : ""
}

// `data`: canje-data.js. `assetDir`: carpeta de imagenes de Mimiku.
function createCanjeServer({ data, gacha = null, games = null, effects = null, pass = null, support = null, profiles = null, live = null, rewards = null, subs = null, community = null, posts = null, duels = null, jobs = null, getStream = null, validator, sessions, getConfig, assetDir, log = console, now = Date.now }) {
  // Modulos opcionales de la pagina: cada uno aporta sus rutas y su manejador.
  const modules = [
    gacha && { routes: GACHA_ROUTES, handle: args => handleGachaApi({ ...args, gacha }) },
    games && { routes: GAMES_ROUTES, handle: args => handleGamesApi({ ...args, games }) },
    effects && { routes: EFFECTS_ROUTES, handle: args => handleEffectsApi({ ...args, effects }) },
    pass && { routes: PASS_ROUTES, handle: args => handlePassApi({ ...args, pass }) },
    support && { routes: SUPPORT_ROUTES, handle: args => handleSupportApi({ ...args, support }) },
    profiles && { routes: PROFILE_ROUTES, handle: args => handleProfilesApi({ ...args, profiles }) },
    live && { routes: LIVE_ROUTES, handle: args => handleLiveApi({ ...args, live }) },
    rewards && { routes: REWARDS_ROUTES, handle: args => handleRewardsApi({ ...args, rewards }) },
    posts && { routes: POSTS_ROUTES, handle: args => handlePostsApi({ ...args, posts }) },
    duels && { routes: DUELS_ROUTES, handle: args => handleDuelsApi({ ...args, duels }) },
    jobs && { routes: JOBS_ROUTES, handle: args => handleJobsApi({ ...args, jobs }) },
  ].filter(Boolean)
  const allowApi = createRateLimiter(API_REQUESTS_PER_MINUTE, now)
  let server = null

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers })
    res.end(body)
  }
  function sendJson(res, status, value) {
    send(res, status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  }

  // ngrok pone la IP real del visitante en X-Forwarded-For.
  function clientKey(req) {
    return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?"
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) { reject(Object.assign(new Error("Formato no válido"), { status: 415 })); return }
      let size = 0
      const chunks = []
      req.on("data", chunk => {
        size += chunk.length
        // Se deja de guardar pero se sigue leyendo, para poder contestar 413.
        if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("Petición demasiado grande"), { status: 413 })); return }
        chunks.push(chunk)
      })
      req.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")) } catch { reject(Object.assign(new Error("JSON no válido"), { status: 400 })) }
      })
      req.on("error", reject)
    })
  }

  function bearer(req) {
    const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""))
    return match ? match[1] : ""
  }

  function viewerFrom(req) {
    return sessions.verify(bearer(req))
  }

  function serveStatic(res, route) {
    const [fileName, type] = STATIC_FILES[route]
    fs.readFile(path.join(WEB_DIR, fileName), (error, body) => {
      if (error) { send(res, 500, "Error"); return }
      send(res, 200, body, { "Content-Type": type, "Cache-Control": "no-cache" })
    })
  }

  function serveAsset(res, pathname) {
    const fileName = decodeURIComponent(pathname.slice("/assets/".length))
    const type = IMAGE_TYPES[path.extname(fileName).toLowerCase()]
    // Solo nombres generados por Mimiku (sha256 + extension): sin rutas ni "..".
    if (!type || !/^[a-f0-9]{64}\.[a-z]+$/i.test(fileName)) { send(res, 404, "No encontrado"); return }
    fs.readFile(path.join(assetDir, fileName), (error, body) => {
      if (error) { send(res, 404, "No encontrado"); return }
      send(res, 200, body, { "Content-Type": type, "Cache-Control": "public, max-age=86400" })
    })
  }

  async function handleApi(req, res, pathname) {
    // Rutas desconocidas: 404 antes de pedir sesion, para no revelar nada.
    const extra = modules.find(item => item.routes[pathname] === req.method)
    if (API_ROUTES[pathname] !== req.method && !extra) { sendJson(res, 404, { error: "No encontrado" }); return }
    if (!allowApi(clientKey(req))) { sendJson(res, 429, { error: "Demasiadas peticiones, espera un momento." }); return }
    const config = getConfig()
    if (pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, { clientId: config.clientId, channel: config.channelDisplay })
      return
    }
    // Cambia el token de Twitch (recien llegado del login) por una sesion de Mimiku.
    if (pathname === "/api/session" && req.method === "POST") {
      const twitchToken = bearer(req)
      const twitchUser = await validator.validate(twitchToken)
      if (!twitchUser) { sendJson(res, 401, { error: "No se pudo comprobar tu cuenta de Twitch. Vuelve a entrar." }); return }
      const session = sessions.issue(twitchUser)
      // De paso se comprueba si es sub del canal (el token no se guarda).
      const sub = subs ? await subs.verify(twitchToken, twitchUser) : null
      sendJson(res, 200, { session: session.token, expiresAt: session.expiresAt, login: twitchUser.login, sub })
      return
    }
    const user = viewerFrom(req)
    if (!user) { sendJson(res, 401, { error: "Tu sesión caducó. Vuelve a entrar con Twitch." }); return }
    // Cualquier llamada cuenta como "tiene la pagina abierta" (Comunidad).
    if (community) { try { community.seen(user.twitchId) } catch (error) { log.error("[comunidad]", error.message) } }
    if (extra) {
      const url = new URL(req.url, "http://canje")
      const [status, body] = await extra.handle({ pathname, url, readJson: () => readJson(req), user })
      sendJson(res, status, body)
      return
    }
    if (pathname === "/api/state" && req.method === "GET") {
      // `achievements`: logros recien desbloqueados, para avisar en la pagina.
      const body = { login: user.login, viewer: data.viewerState(user.twitchId) }
      if (community) { try { body.achievements = community.takeFresh(user.twitchId) } catch (error) { log.error("[comunidad]", error.message) } }
      // Directo del canal (aviso, miniatura y reproductor de la pagina).
      if (getStream) { try { body.stream = publicStream(getStream()) } catch (error) { log.error("[directo]", error.message) } }
      // Buzon: sin leer y regalos por reclamar (para la cabecera).
      if (posts) { try { body.mailbox = posts.summary(user.twitchId, user.login) } catch (error) { log.error("[buzon]", error.message) } }
      // Duelos: retos por contestar, turnos pendientes y resultados sin ver.
      if (duels) { try { body.duels = duels.summary(user.twitchId) } catch (error) { log.error("[duelos]", error.message) } }
      sendJson(res, 200, body)
      return
    }
    if (pathname === "/api/redeem" && req.method === "POST") {
      const body = await readJson(req)
      const mimicId = typeof body.mimicId === "string" ? body.mimicId.slice(0, 120) : ""
      const key = requestKey(body)
      if (!mimicId || !key) { sendJson(res, 400, { error: "Petición incompleta." }); return }
      const result = data.redeem(user.twitchId, mimicId, key)
      if (result.ok) sendJson(res, 200, { ok: true, name: result.name })
      else sendJson(res, result.reason === "rate-limit" ? 429 : 409, { error: REDEEM_MESSAGES[result.reason] || "No se pudo canjear." })
      return
    }
    if (pathname === "/api/buy" && req.method === "POST") {
      const body = await readJson(req)
      const boxId = typeof body.boxId === "string" ? body.boxId.slice(0, 120) : ""
      const key = requestKey(body)
      if (!boxId || !key) { sendJson(res, 400, { error: "Petición incompleta." }); return }
      const result = data.buyBox(user.twitchId, boxId, key, requestQuantity(body))
      if (result.ok) sendJson(res, 200, { ok: true, name: result.name, price: result.price, quantity: result.quantity })
      else sendJson(res, result.reason === "rate-limit" ? 429 : 409, { error: BUY_MESSAGES[result.reason] || "No se pudo comprar." })
      return
    }
    if (pathname === "/api/open" && req.method === "POST") {
      const body = await readJson(req)
      const boxId = typeof body.boxId === "string" ? body.boxId.slice(0, 120) : ""
      const key = requestKey(body)
      if (!boxId || !key) { sendJson(res, 400, { error: "Petición incompleta." }); return }
      const result = data.openBox(user.twitchId, boxId, key, requestQuantity(body))
      if (result.ok) sendJson(res, 200, { ok: true, name: result.name, opened: result.opened, rewards: result.rewards })
      else sendJson(res, result.reason === "rate-limit" ? 429 : 409, { error: OPEN_MESSAGES[result.reason] || "No se pudo abrir." })
      return
    }
    sendJson(res, 404, { error: "No encontrado" })
  }

  async function handle(req, res) {
    let pathname
    try { pathname = new URL(req.url, "http://canje").pathname } catch { send(res, 400, "Petición no válida"); return }
    try {
      if (pathname.startsWith("/api/")) { await handleApi(req, res, pathname); return }
      if (req.method !== "GET" && req.method !== "HEAD") { send(res, 405, "Método no permitido"); return }
      if (STATIC_FILES[pathname]) { serveStatic(res, pathname); return }
      if (pathname.startsWith("/assets/")) { serveAsset(res, pathname); return }
      send(res, 404, "No encontrado")
    } catch (error) {
      if (error.status) { sendJson(res, error.status, { error: error.message }); return }
      log.error("[canje-server]", error.message)
      sendJson(res, 500, { error: "Error interno, inténtalo de nuevo." })
    }
  }

  // Escucha SOLO en 127.0.0.1: la unica puerta desde internet es ngrok.
  function start(port) {
    return new Promise((resolve, reject) => {
      const next = http.createServer((req, res) => { handle(req, res) })
      next.once("error", reject)
      next.listen(port, "127.0.0.1", () => {
        next.removeListener("error", reject)
        next.on("error", error => log.error("[canje-server]", error.message))
        server = next
        resolve(next.address().port)
      })
    })
  }

  function stop() {
    return new Promise(resolve => {
      if (!server) { resolve(); return }
      const current = server
      server = null
      current.close(() => resolve())
      current.closeAllConnections?.()
    })
  }

  return { start, stop, handle, isRunning: () => !!server }
}

module.exports = { createCanjeServer, createTwitchValidator, createSessionSigner, createRateLimiter, SECURITY_HEADERS, SESSION_DAYS }
