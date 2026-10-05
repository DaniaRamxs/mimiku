const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createSupport } = require("../src/services/support.js")
const { createStreamElementsTips, normalizeTip, channelFromToken, ASTRO_URL } = require("../src/services/streamelements.js")

// JWT de prueba con { channel: "se-canal-1" } (la firma no se comprueba en Mimiku).
const TOKEN = ["e30", Buffer.from(JSON.stringify({ channel: "se-canal-1", role: "owner" })).toString("base64url"), "firma"].join(".")

function tip(id, name, amount, currency = "USD", createdAt = new Date(Date.now() + 1000).toISOString()) {
  return { _id: id, createdAt, donation: { user: { username: name }, message: "gracias!", amount, currency } }
}

class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; FakeSocket.last = this }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { if (this.onclose) this.onclose() }
}

function setup({ fetchImpl } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const luna = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "LunaStreamFan" })
  const getChannel = () => "canal"
  const support = createSupport({ platform, getChannel })
  const secretValues = new Map()
  const settingValues = new Map()
  const service = createStreamElementsTips({
    platform, getChannel, support,
    secrets: { getSecret: name => secretValues.get(name) || "", setSecret: (name, value) => secretValues.set(name, value) },
    settings: { get: key => settingValues.get(key), set: (key, value) => settingValues.set(key, value) },
    WebSocketImpl: FakeSocket, fetchImpl: fetchImpl || (async () => ({ ok: true, json: async () => ({ docs: [] }) })), log: { error() {} },
  })
  const balance = () => platform.economy.getBalance("canal", luna.id).balance
  return { db, platform, support, service, luna, balance, settingValues }
}

test("lee el canal del token y normaliza una propina de StreamElements", () => {
  assert.equal(channelFromToken(TOKEN), "se-canal-1")
  assert.equal(channelFromToken("no-es-un-jwt"), null)
  const parsed = normalizeTip(tip("t1", "Luna", 5))
  assert.deepEqual([parsed.id, parsed.name, parsed.amountCents, parsed.currency], ["t1", "Luna", 500, "USD"])
  assert.equal(normalizeTip({ _id: "x" }), null)
})

test("una propina en USD de alguien del chat se apunta sola, una sola vez", () => {
  const { service, support, balance } = setup()
  assert.equal(service.handleTip(tip("t1", "luna", 5)), "applied")
  assert.equal(balance(), 5 * 500000)
  assert.deepEqual(support.topDonors().map(row => [row.name, row.amountUsd]), [["LunaStreamFan", 5]])
  assert.equal(service.handleTip(tip("t1", "luna", 5)), "duplicate")
  assert.equal(balance(), 5 * 500000)
  assert.equal(service.handleTip(tip("t2", "LunaStreamFan", 1)), "applied", "tambien por el nombre a mostrar")
})

test("sin coincidencia o en otra moneda queda pendiente y se puede asignar o descartar", () => {
  const { service, balance } = setup()
  assert.equal(service.handleTip(tip("t1", "desconocido", 3)), "pending")
  assert.equal(service.handleTip(tip("t2", "luna", 100, "MXN")), "pending")
  assert.equal(service.handleTip(tip("t3", "otro", 2)), "pending")
  const pending = service.listPending()
  assert.equal(pending.length, 3)
  assert.equal(pending.find(item => item.id === "t2").reason, "currency")
  assert.equal(service.assign("t1", { username: "luna" }).ok, true)
  assert.equal(balance(), 3 * 500000)
  assert.equal(service.assign("t2", { username: "luna" }).reason, "need-usd")
  assert.equal(service.assign("t2", { username: "luna", amountUsd: 5.2 }).ok, true)
  assert.equal(service.dismiss("t3").ok, true)
  assert.deepEqual(service.listPending(), [])
  assert.equal(service.assign("t3", { username: "luna" }).reason, "gone")
})

test("al conectar se suscribe a channel.tips y apunta las propinas que llegan en directo", () => {
  const { service, balance, settingValues } = setup()
  service.setToken(TOKEN)
  assert.ok(Number(settingValues.get("streamelements_since")) > 0)
  const socket = FakeSocket.last
  assert.equal(socket.url, ASTRO_URL)
  socket.onopen()
  const subscribe = socket.sent[0]
  assert.deepEqual([subscribe.type, subscribe.data.topic, subscribe.data.room, subscribe.data.token_type], ["subscribe", "channel.tips", "se-canal-1", "jwt"])
  socket.onmessage({ data: JSON.stringify({ type: "response", nonce: subscribe.nonce, data: { message: "successfully subscribed to topic" } }) })
  assert.equal(service.status().connected, true)
  socket.onmessage({ data: JSON.stringify({ type: "message", topic: "channel.tips", data: tip("live-1", "luna", 2) }) })
  assert.equal(balance(), 2 * 500000)
  service.stop()
  assert.equal(service.status().connected, false)
})

test("activar la integracion no importa propinas antiguas, pero si las que llegaron con Mimiku cerrado", async () => {
  const old = tip("viejo", "luna", 50, "USD", "2020-01-01T00:00:00Z")
  const fresh = tip("nuevo", "luna", 4)
  const { service, balance } = setup({ fetchImpl: async (url, options) => {
    assert.match(url, /\/tips\/se-canal-1\?limit=25$/)
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`)
    return { ok: true, json: async () => ({ docs: [fresh, old] }) }
  } })
  service.setToken(TOKEN)
  const socket = FakeSocket.last
  socket.onopen()
  socket.onmessage({ data: JSON.stringify({ type: "response", nonce: socket.sent[0].nonce, data: {} }) })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(balance(), 4 * 500000, "solo la nueva; la de 2020 es anterior a conectar")
  service.stop()
})

test("un token que no es JWT de StreamElements se avisa y no conecta", () => {
  const { service } = setup()
  const status = service.setToken("abc123")
  assert.match(status.error, /JWT/)
  assert.equal(status.connected, false)
})
