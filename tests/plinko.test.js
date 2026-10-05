const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createPlinko, SLOTS, DEFAULT_PRICE } = require("../src/services/plinko.js")
const { createCanjeGames, MAX_PLAYS_PER_MINUTE, MAX_BALLS } = require("../src/services/canje-games.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")

// random() devuelve los valores de la lista en orden (y luego 0).
function sequence(values) {
  const queue = [...values]
  return () => (queue.length ? queue.shift() : 0)
}

function setup({ random = Math.random, points = 1000, withCards = true, withMimics = true } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: points, idempotencyKey: "seed", reason: "seed" })
  const items = {}
  if (withCards) items.dragon = platform.profiles.createCard("canal", { name: "Dragon", rarity: "legendario" })
  if (withMimics) items.confeti = platform.mimics.create("canal", { name: "Confeti", icon: "*", rarity: "raro" })
  const plinko = createPlinko({ platform, getChannel: () => "canal", random })
  const balance = () => platform.economy.getBalance("canal", viewer.id).balance
  const cardQty = card => (platform.profiles.getCards("canal", viewer.id).find(row => row.card_id === card.id) || { quantity: 0 }).quantity
  const mimicQty = mimic => (platform.mimics.inventory("canal", viewer.id).find(row => row.mimic_id === mimic.id) || { quantity: 0 }).quantity
  return { db, platform, viewer, items, plinko, balance, cardQty, mimicQty }
}

test("tablero: bordes legendario, luego epico, raro y el centro nada", () => {
  assert.deepEqual(SLOTS, ["legendario", "epico", "raro", "nada", "nada", "nada", "raro", "epico", "legendario"])
})

test("precio por defecto y editable; rechaza precios invalidos", () => {
  const { plinko } = setup()
  assert.equal(plinko.getConfig().price, DEFAULT_PRICE)
  assert.equal(plinko.setConfig({ price: 300 }).price, 300)
  assert.throws(() => plinko.setConfig({ price: 0 }))
  assert.throws(() => plinko.setConfig({ price: 1.5 }))
})

test("solo pueden salir las rarezas que tienen premios", () => {
  const { plinko } = setup()
  const odds = plinko.odds()
  assert.equal(odds.epico, 0)
  assert.ok(odds.legendario > 0 && odds.raro > 0 && odds.nada > 0)
  assert.equal(Math.round(odds.nada + odds.raro + odds.legendario), 100)
})

test("nada: cobra el precio y no da nada, cae en el centro", () => {
  const { plinko, viewer, balance, items, cardQty, mimicQty } = setup({ random: sequence([0, 0.5]) })
  const result = plinko.play(viewer.id, "k1")
  assert.equal(result.ok, true)
  assert.equal(result.tier, "nada")
  assert.equal(result.prize, null)
  assert.equal(SLOTS[result.slot], "nada")
  assert.equal(balance(), 1000 - DEFAULT_PRICE)
  assert.equal(cardQty(items.dragon), 0)
  assert.equal(mimicQty(items.confeti), 0)
})

test("premio mayor: carta legendaria del gachapon en una casilla del borde", () => {
  const { plinko, viewer, items, cardQty } = setup({ random: sequence([0.999, 0.99, 0]) })
  const result = plinko.play(viewer.id, "k1")
  assert.equal(result.tier, "legendario")
  assert.ok(result.slot === 0 || result.slot === 8)
  assert.equal(result.prize.kind, "card")
  assert.equal(cardQty(items.dragon), 1)
})

test("raro: puede dar un Mimic", () => {
  // nada 62 + legendario 3 = 65 de 90 -> 0.8 cae en raro (orden: nada, raro, epico, legendario)
  const { plinko, viewer, items, mimicQty } = setup({ random: sequence([0.8, 0, 0]) })
  const result = plinko.play(viewer.id, "k1")
  assert.equal(result.tier, "raro")
  assert.equal(result.prize.kind, "mimic")
  assert.equal(mimicQty(items.confeti), 1)
})

test("sin puntos suficientes no cobra ni da nada", () => {
  const { plinko, viewer, balance, items, cardQty } = setup({ points: 10, random: sequence([0.999, 0, 0]) })
  assert.deepEqual(plinko.play(viewer.id, "k1"), { ok: false, reason: "insufficient" })
  assert.equal(balance(), 10)
  assert.equal(cardQty(items.dragon), 0)
})

async function webSetup(t, options = {}) {
  const base = setup(options)
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const games = createCanjeGames({ platform: base.platform, getChannel: () => "canal", random: options.random || (() => 0.5) })
  const server = createCanjeServer({
    data: { viewerState: () => null }, games, sessions, validator: { validate: async () => null },
    assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const token = sessions.issue({ twitchId: "111", login: "luna" }).token
  const call = async (route, body, auth = true) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET",
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, json: await response.json() }
  }
  return { ...base, call }
}

test("por la web: info, una bola y reintento con la misma clave", async t => {
  const { call, balance } = await webSetup(t, { random: sequence([0, 0.5]) })
  assert.equal((await call("/api/games", null, false)).status, 401)
  const info = await call("/api/games")
  assert.equal(info.json.plinko.price, DEFAULT_PRICE)
  assert.equal(info.json.plinko.slots.length, 9)
  assert.equal(info.json.plinko.maxBalls, MAX_BALLS)
  const played = await call("/api/games/plinko", { key: "clave-partida-1" })
  assert.equal(played.status, 200)
  assert.equal(played.json.balls.length, 1)
  assert.equal(played.json.balls[0].tier, "nada")
  assert.equal(played.json.balance, 1000 - DEFAULT_PRICE)
  const retry = await call("/api/games/plinko", { key: "clave-partida-1" })
  assert.deepEqual(retry.json, played.json)
  assert.equal(balance(), 1000 - DEFAULT_PRICE)
  assert.equal((await call("/api/games/plinko", { key: "x" })).status, 409)
})

test("varias bolas a la vez: cobra cada una y devuelve todas", async t => {
  const { call, balance } = await webSetup(t)
  const played = await call("/api/games/plinko", { key: "clave-varias-1", count: 5 })
  assert.equal(played.status, 200)
  assert.equal(played.json.requested, 5)
  assert.equal(played.json.balls.length, 5)
  assert.equal(balance(), 1000 - 5 * DEFAULT_PRICE)
  assert.equal((await call("/api/games/plinko", { key: "clave-varias-2", count: 0 })).status, 409)
  assert.equal((await call("/api/games/plinko", { key: "clave-varias-3", count: MAX_BALLS + 1 })).status, 409)
})

test("si los puntos se acaban a mitad, solo juega las bolas que puede pagar", async t => {
  const { call, balance } = await webSetup(t, { points: DEFAULT_PRICE * 3 + 10 })
  const played = await call("/api/games/plinko", { key: "clave-mitad-1", count: 10 })
  assert.equal(played.status, 200)
  assert.equal(played.json.requested, 10)
  assert.equal(played.json.balls.length, 3)
  assert.equal(balance(), 10)
  const broke = await call("/api/games/plinko", { key: "clave-mitad-2", count: 1 })
  assert.equal(broke.status, 409)
  assert.equal(broke.json.error, "No te alcanzan los puntos.")
})

test("el limite por minuto cuenta bolas, no peticiones", async t => {
  const { call } = await webSetup(t, { points: 1_000_000 })
  for (let i = 0; i < MAX_PLAYS_PER_MINUTE / MAX_BALLS; i++) {
    assert.equal((await call("/api/games/plinko", { key: `limite-${i}-partida`, count: MAX_BALLS })).status, 200)
  }
  assert.equal((await call("/api/games/plinko", { key: "limite-de-mas", count: 1 })).status, 429)
})
