const test = require("node:test")
const assert = require("node:assert/strict")

const { createSocialStreamNinjaRoute, SSN_PATH_PREFIX } = require("../src/services/local-api.js")

const TOKEN = "test-token-123"

function fakeRequest({ method = "POST", path = `${SSN_PATH_PREFIX}${TOKEN}`, body = "" }) {
  const chunks = [Buffer.from(body)]
  return {
    method,
    url: path,
    headers: {},
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
  }
}

function fakeResponse() {
  const res = { statusCode: null, headers: null, body: null }
  res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers }
  res.end = (data) => { res.body = data ? JSON.parse(data.toString()) : null }
  return res
}

function makeRoute(overrides = {}) {
  const calls = []
  const adapter = { handlePayload: (body) => { calls.push(body); return { accepted: true } } }
  const route = createSocialStreamNinjaRoute({ token: TOKEN, adapter, ...overrides })
  return { route, calls, adapter }
}

test("9: JSON inválido no tumba el endpoint, responde 400 y no llega al adaptador", async () => {
  const { route, calls } = makeRoute()
  const req = fakeRequest({ body: "{ esto no es json" })
  const res = fakeResponse()
  const handled = await route(req, res)
  assert.equal(handled, true)
  assert.equal(res.statusCode, 400)
  assert.equal(calls.length, 0)
})

test("10: un payload por encima del límite se rechaza sin llegar al adaptador", async () => {
  const { route, calls } = makeRoute()
  const bigText = "x".repeat(200 * 1024) // 200KB > límite de 64KB del endpoint
  const req = fakeRequest({ body: JSON.stringify({ type: "twitch", chatmessage: bigText }) })
  const res = fakeResponse()
  await route(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(calls.length, 0)
})

test("token inválido se rechaza con 401 sin llegar al adaptador", async () => {
  const { route, calls } = makeRoute()
  const req = fakeRequest({ path: `${SSN_PATH_PREFIX}token-equivocado`, body: JSON.stringify({ type: "twitch", chatmessage: "hola" }) })
  const res = fakeResponse()
  await route(req, res)
  assert.equal(res.statusCode, 401)
  assert.equal(calls.length, 0)
})

test("método distinto de POST se rechaza con 405", async () => {
  const { route } = makeRoute()
  const req = fakeRequest({ method: "GET", body: "" })
  const res = fakeResponse()
  await route(req, res)
  assert.equal(res.statusCode, 405)
})

test("una ruta que no coincide con el prefijo de SSN no se maneja (devuelve false)", async () => {
  const { route } = makeRoute()
  const req = fakeRequest({ path: "/api/v1/status", body: "" })
  const res = fakeResponse()
  const handled = await route(req, res)
  assert.equal(handled, false)
  assert.equal(res.statusCode, null)
})

test("payload válido con token correcto llega al adaptador y responde 200", async () => {
  const { route, calls } = makeRoute()
  const req = fakeRequest({ body: JSON.stringify({ type: "twitch", chatmessage: "hola" }) })
  const res = fakeResponse()
  await route(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { accepted: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].chatmessage, "hola")
})

test("propiedades de prototype pollution se rechazan sin llegar al adaptador", async () => {
  const { route, calls } = makeRoute()
  const req = fakeRequest({ body: '{"type":"twitch","chatmessage":"hola","__proto__":{"polluted":true}}' })
  const res = fakeResponse()
  await route(req, res)
  assert.equal(res.statusCode, 400)
  assert.equal(calls.length, 0)
  assert.equal({}.polluted, undefined)
})
