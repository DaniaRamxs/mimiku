const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { createCanjeServer, createTwitchValidator, createSessionSigner, SESSION_DAYS } = require("../src/services/canje-server.js")

const HASH = "b".repeat(64)

async function setup(t, extra = {}) {
  const assetDir = fs.mkdtempSync(path.join(os.tmpdir(), "canje-srv-"))
  fs.writeFileSync(path.join(assetDir, `${HASH}.png`), "PNGDATA")
  fs.writeFileSync(path.join(assetDir, "secreto.txt"), "no")
  const calls = []
  const data = {
    viewerState: id => (id === "111" ? { display: "Luna", mimics: [] } : null),
    redeem: (id, mimicId, key) => { calls.push({ id, mimicId, key }); return mimicId === "m1" ? { ok: true, name: "Confeti" } : { ok: false, reason: "unavailable" } },
    openBox: (id, boxId, key, quantity) => { calls.push({ id, boxId, key, quantity, open: true }); return boxId === "b1" ? { ok: true, name: "Cofre", rewards: [{ name: "Confeti", icon: "*", rarity: "raro", quantity: 1 }] } : { ok: false, reason: "no-chest" } },
    buyBox: (id, boxId, key, quantity) => { calls.push({ id, boxId, key, quantity }); return boxId === "b1" ? { ok: true, name: "Cofre", price: 200 } : { ok: false, reason: boxId === "caro" ? "insufficient" : "not-for-sale" } },
  }
  const validator = { validate: async token => (token === "good" ? { twitchId: "111", login: "luna" } : null) }
  const sessions = createSessionSigner({ getKey: () => "clave-de-prueba" })
  // "good" en los tests = una sesion valida de Mimiku para el viewer 111.
  const goodSession = sessions.issue({ twitchId: "111", login: "luna" }).token
  const server = createCanjeServer({ data, validator, sessions, assetDir, getConfig: () => ({ clientId: "abc123abc123", channelDisplay: "emili" }), log: { error() {} }, ...extra })
  const port = await server.start(0)
  const base = `http://127.0.0.1:${port}`
  const call = (route, { token, rawToken, method = "GET", body, headers = {} } = {}) => fetch(base + route, {
    method,
    headers: { ...(token || rawToken ? { Authorization: `Bearer ${rawToken || (token === "good" ? goodSession : token)}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const cleanup = async () => { await server.stop(); fs.rmSync(assetDir, { recursive: true, force: true }) }
  t.after(cleanup) // tambien si el test falla, para no dejar el servidor colgado
  return { server, port, call, calls, cleanup }
}

test("sirve la pagina con cabeceras de seguridad", async t => {
  const { call } = await setup(t)
  const response = await call("/")
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Canje de Mimics/)
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/)
  assert.equal(response.headers.get("x-frame-options"), "DENY")
})

test("no expone nada mas: panel, API local, overlay y rutas raras dan 404", async t => {
  const { call } = await setup(t)
  for (const route of ["/panel/", "/api/v1/overview", "/overlay", "/../main.cjs", "/assets/secreto.txt", "/assets/..%2F..%2Fmain.cjs", "/src/services/db.js"]) {
    assert.equal((await call(route)).status, 404, route)
  }
})

test("sirve solo imagenes con nombre generado por Mimiku", async t => {
  const { call } = await setup(t)
  const response = await call(`/assets/${HASH}.png`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/png")
})

test("/api/config es publico y solo da el Client ID y el canal", async t => {
  const { call } = await setup(t)
  assert.deepEqual(await (await call("/api/config")).json(), { clientId: "abc123abc123", channel: "emili" })
})

test("/api/session cambia un token de Twitch valido por una sesion de 30 dias", async t => {
  const { call } = await setup(t)
  assert.equal((await call("/api/session", { method: "POST" })).status, 401)
  assert.equal((await call("/api/session", { rawToken: "malo", method: "POST" })).status, 401)
  const response = await call("/api/session", { rawToken: "good", method: "POST" })
  const body = await response.json()
  assert.equal(body.login, "luna")
  assert.match(body.session, /^v1\./)
  assert.ok(Math.abs(body.expiresAt - (Date.now() + SESSION_DAYS * 86_400_000)) < 60_000)
  const state = await call("/api/state", { rawToken: body.session })
  assert.equal(state.status, 200)
})

test("las rutas del viewer no aceptan el token de Twitch directo, solo la sesion", async t => {
  const { call } = await setup(t)
  assert.equal((await call("/api/state", { rawToken: "good" })).status, 401)
})

test("/api/state exige una sesion valida", async t => {
  const { call } = await setup(t)
  assert.equal((await call("/api/state")).status, 401)
  assert.equal((await call("/api/state", { token: "malo" })).status, 401)
  const response = await call("/api/state", { token: "good" })
  assert.deepEqual(await response.json(), { login: "luna", viewer: { display: "Luna", mimics: [] } })
  assert.equal(response.headers.get("cache-control"), "no-store")
})

test("/api/redeem usa el id de Twitch validado, no uno que mande el navegador", async t => {
  const { call, calls } = await setup(t)
  const response = await call("/api/redeem", { token: "good", method: "POST", body: { mimicId: "m1", key: "abcd1234", twitchId: "999" } })
  assert.deepEqual(await response.json(), { ok: true, name: "Confeti" })
  assert.deepEqual(calls, [{ id: "111", mimicId: "m1", key: "abcd1234" }])
})

test("/api/redeem valida el cuerpo y devuelve mensajes claros", async t => {
  const { call } = await setup(t)
  assert.equal((await call("/api/redeem", { token: "good", method: "POST", body: { mimicId: "m1" } })).status, 400)
  assert.equal((await call("/api/redeem", { token: "good", method: "POST", body: { mimicId: "m1", key: "x" } })).status, 400)
  const denied = await call("/api/redeem", { token: "good", method: "POST", body: { mimicId: "m2", key: "abcd1234" } })
  assert.equal(denied.status, 409)
  assert.equal((await denied.json()).error, "Ya no tienes ese Mimic.")
  const notJson = await call("/api/redeem", { token: "good", method: "POST", headers: { "Content-Type": "text/plain" } })
  assert.equal(notJson.status, 415)
  const huge = await call("/api/redeem", { token: "good", method: "POST", body: { mimicId: "m1", key: "abcd1234", pad: "x".repeat(5000) } })
  assert.equal(huge.status, 413)
})

test("/api/buy compra con el id de Twitch validado y responde claro", async t => {
  const { call, calls } = await setup(t)
  assert.equal((await call("/api/buy", { method: "POST", body: { boxId: "b1", key: "abcd1234" } })).status, 401)
  const response = await call("/api/buy", { token: "good", method: "POST", body: { boxId: "b1", key: "abcd1234", twitchId: "999" } })
  assert.deepEqual(await response.json(), { ok: true, name: "Cofre", price: 200 })
  assert.deepEqual(calls, [{ id: "111", boxId: "b1", key: "abcd1234", quantity: 1 }])
  await call("/api/buy", { token: "good", method: "POST", body: { boxId: "b1", key: "abcd1235", quantity: 10 } })
  assert.equal(calls[1].quantity, 10)
  assert.equal((await call("/api/buy", { token: "good", method: "POST", body: { boxId: "b1" } })).status, 400)
  const poor = await call("/api/buy", { token: "good", method: "POST", body: { boxId: "caro", key: "abcd1234" } })
  assert.equal(poor.status, 409)
  assert.equal((await poor.json()).error, "No te alcanzan los puntos.")
  assert.equal((await call("/api/buy", { token: "good" })).status, 404)
})

test("/api/open abre con el id de Twitch validado y devuelve los premios", async t => {
  const { call, calls } = await setup(t)
  assert.equal((await call("/api/open", { method: "POST", body: { boxId: "b1", key: "abcd1234" } })).status, 401)
  const response = await call("/api/open", { token: "good", method: "POST", body: { boxId: "b1", key: "abcd1234", twitchId: "999" } })
  assert.deepEqual(await response.json(), { ok: true, name: "Cofre", rewards: [{ name: "Confeti", icon: "*", rarity: "raro", quantity: 1 }] })
  assert.deepEqual(calls, [{ id: "111", boxId: "b1", key: "abcd1234", quantity: 1, open: true }])
  await call("/api/open", { token: "good", method: "POST", body: { boxId: "b1", key: "abcd1235", quantity: 5 } })
  assert.equal(calls[1].quantity, 5)
  assert.equal((await call("/api/open", { token: "good", method: "POST", body: { key: "abcd1234" } })).status, 400)
  const none = await call("/api/open", { token: "good", method: "POST", body: { boxId: "zz", key: "abcd1234" } })
  assert.equal(none.status, 409)
  assert.equal((await none.json()).error, "Ya no tienes ese cofre.")
})

test("limita las peticiones a la API por visitante", async t => {
  const { call } = await setup(t)
  const headers = { "X-Forwarded-For": "1.2.3.4" }
  for (let i = 0; i < 60; i++) await call("/api/config", { headers })
  assert.equal((await call("/api/config", { headers })).status, 429)
  assert.equal((await call("/api/config", { headers: { "X-Forwarded-For": "5.6.7.8" } })).status, 200)
})

test("escucha solo en 127.0.0.1: desde la IP de red no responde", async t => {
  const { server, port, cleanup } = await setup(t)
  const lanIp = Object.values(os.networkInterfaces()).flat().find(item => item && item.family === "IPv4" && !item.internal)?.address
  if (lanIp) await assert.rejects(fetch(`http://${lanIp}:${port}/api/config`, { signal: AbortSignal.timeout(3000) }))
  else t.diagnostic("sin IP de red en este equipo; solo se comprueba el apagado")
  await cleanup()
  assert.equal(server.isRunning(), false)
})

// ── Validacion de tokens con Twitch ──
function fakeTwitch(responses) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push(options.headers.Authorization)
    const next = responses.shift()
    return { status: next.status, ok: next.status === 200, json: async () => next.body }
  }
  return { calls, fetchImpl }
}

test("el validador acepta solo tokens de nuestra app y los recuerda un rato", async () => {
  const twitch = fakeTwitch([{ status: 200, body: { client_id: "nuestra", user_id: "111", login: "luna", expires_in: 3600 } }])
  const validator = createTwitchValidator({ getClientId: () => "nuestra", fetchImpl: twitch.fetchImpl })
  assert.deepEqual(await validator.validate("tok"), { twitchId: "111", login: "luna" })
  assert.deepEqual(await validator.validate("tok"), { twitchId: "111", login: "luna" })
  assert.deepEqual(twitch.calls, ["OAuth tok"])
})

test("el validador rechaza tokens de otra app y tokens caducados", async () => {
  const twitch = fakeTwitch([
    { status: 200, body: { client_id: "otra-app", user_id: "111", login: "luna", expires_in: 3600 } },
    { status: 401, body: {} },
  ])
  const validator = createTwitchValidator({ getClientId: () => "nuestra", fetchImpl: twitch.fetchImpl })
  assert.equal(await validator.validate("ajeno"), null)
  assert.equal(await validator.validate("caducado"), null)
  assert.equal(await validator.validate(""), null)
  assert.equal(await validator.validate("x".repeat(500)), null)
})

test("el validador vuelve a preguntar a Twitch cuando pasa el tiempo", async () => {
  const clock = { value: 0 }
  const body = { client_id: "nuestra", user_id: "111", login: "luna", expires_in: 3600 }
  const twitch = fakeTwitch([{ status: 200, body }, { status: 200, body }])
  const validator = createTwitchValidator({ getClientId: () => "nuestra", fetchImpl: twitch.fetchImpl, now: () => clock.value })
  await validator.validate("tok")
  clock.value += 6 * 60 * 1000
  await validator.validate("tok")
  assert.equal(twitch.calls.length, 2)
})

test("la sesion firmada caduca, no se puede falsificar y depende de la clave", () => {
  const clock = { value: 1_000_000 }
  const signer = createSessionSigner({ getKey: () => "k1", now: () => clock.value })
  const { token, expiresAt } = signer.issue({ twitchId: "111", login: "luna" })
  assert.equal(expiresAt, 1_000_000 + SESSION_DAYS * 86_400_000)
  assert.deepEqual(signer.verify(token), { twitchId: "111", login: "luna" })

  const [prefix, data, sig] = token.split(".")
  const forged = Buffer.from(JSON.stringify({ id: "999", login: "otro", exp: expiresAt })).toString("base64url")
  assert.equal(signer.verify(`${prefix}.${forged}.${sig}`), null)
  assert.equal(signer.verify(`${prefix}.${data}.${sig.slice(0, -2)}xx`), null)
  assert.equal(signer.verify("basura"), null)
  assert.equal(signer.verify(""), null)
  assert.equal(createSessionSigner({ getKey: () => "k2", now: () => clock.value }).verify(token), null)

  clock.value = expiresAt + 1
  assert.equal(signer.verify(token), null)
})

test("/api/state lleva el directo del canal y la pagina deja cargar el reproductor de Twitch", async t => {
  let state = { live: true, streamId: "s1", startedAt: "2026-10-05T18:00:00Z", login: "HikkiDX", display: "HikkiDX", title: "Gachapon y blackjack", game: "Just Chatting", viewers: 42, thumbnail: "https://static-cdn.jtvnw.net/previews-ttv/live_user_hikkidx-640x360.jpg" }
  const { call } = await setup(t, { getStream: () => state })
  const live = await (await call("/api/state", { token: "good" })).json()
  assert.deepEqual(live.stream, { live: true, login: "hikkidx", display: "HikkiDX", title: "Gachapon y blackjack", game: "Just Chatting", viewers: 42, startedAt: "2026-10-05T18:00:00Z", streamId: "s1", thumbnail: "https://static-cdn.jtvnw.net/previews-ttv/live_user_hikkidx-640x360.jpg" })
  state = { ...state, thumbnail: "https://otro-sitio.example/x.jpg", login: "no valido!" }
  const odd = (await (await call("/api/state", { token: "good" })).json()).stream
  assert.deepEqual([odd.thumbnail, odd.login], ["", ""], "solo miniaturas de Twitch y logins validos")
  state = { live: false, login: "hikkidx" }
  assert.deepEqual((await (await call("/api/state", { token: "good" })).json()).stream, { live: false, login: "hikkidx" })
  state = null
  assert.equal((await (await call("/api/state", { token: "good" })).json()).stream, null, "sin token de Twitch no se sabe")
  const page = await call("/")
  assert.match(page.headers.get("content-security-policy"), /frame-src https:\/\/player\.twitch\.tv/)
})
