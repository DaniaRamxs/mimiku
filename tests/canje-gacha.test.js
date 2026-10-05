const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")
const { createCanjeGacha, MAX_ACTIONS_PER_MINUTE } = require("../src/services/canje-gacha.js")

async function setup(t, { withGacha = true } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const person = (id, login) => {
    const row = platform.identities.resolve({ platform: "twitch", platformUserId: id, username: login, display: login[0].toUpperCase() + login.slice(1) })
    platform.economy.applyMovement({ channelId: "canal", viewerId: row.id, balanceDelta: 1000, idempotencyKey: `seed-${id}`, reason: "seed" })
    return row
  }
  const luna = person("111", "luna")
  const zorro = person("222", "zorro")
  const dragon = platform.profiles.createCard("canal", { name: "Dragon", rarity: "legendario", imagePath: "https://img.example/d.png" })
  const gato = platform.profiles.createCard("canal", { name: "Gato", rarity: "comun" })
  platform.profiles.grantCard("canal", luna.id, dragon.id, 1, "seed")
  platform.profiles.grantCard("canal", zorro.id, gato.id, 2, "seed")
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const tokens = { luna: sessions.issue({ twitchId: "111", login: "luna" }).token, zorro: sessions.issue({ twitchId: "222", login: "zorro" }).token }
  const gacha = withGacha ? createCanjeGacha({ platform, getChannel: () => "canal" }) : null
  const server = createCanjeServer({
    data: { viewerState: () => null }, gacha, sessions, validator: { validate: async () => null },
    assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const call = async (route, who, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET",
      headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, json: await response.json() }
  }
  const qty = (who, card) => (platform.profiles.getCards("canal", who.id).find(row => row.card_id === card.id) || { quantity: 0 }).quantity
  return { call, platform, luna, zorro, dragon, gato, qty }
}

test("las rutas del gachapon piden sesion y no existen si el servicio no esta", async t => {
  const { call } = await setup(t)
  assert.equal((await call("/api/gacha")).status, 401)
  assert.equal((await call("/api/market/buy", null, { listingId: "x" })).status, 401)
  const bare = await setup(t, { withGacha: false })
  assert.equal((await bare.call("/api/gacha", "luna")).status, 404)
})

test("vender y comprar por la web, con el estado de la pestana", async t => {
  const { call, zorro, dragon, qty } = await setup(t)
  const listed = await call("/api/market/list", "luna", { cardId: dragon.id, price: 400 })
  assert.equal(listed.status, 200)
  const lunaView = (await call("/api/gacha", "luna")).json
  assert.equal(lunaView.feePercent, 5)
  assert.equal(lunaView.myListings.length, 1)
  assert.equal(lunaView.listings.length, 0)
  const zorroView = (await call("/api/gacha", "zorro")).json
  assert.equal(zorroView.listings[0].seller, "Luna")
  assert.deepEqual(zorroView.listings[0].card, { id: dragon.id, name: "Dragon", rarity: "legendario", image: "https://img.example/d.png", description: "" })
  const bought = await call("/api/market/buy", "zorro", { listingId: zorroView.listings[0].id })
  assert.equal(bought.status, 200)
  assert.equal(qty(zorro, dragon), 1)
  const again = await call("/api/market/buy", "zorro", { listingId: zorroView.listings[0].id })
  assert.equal(again.status, 409)
  assert.equal(again.json.error, "Eso ya no está disponible.")
  assert.equal((await call("/api/gacha", "zorro")).json.sales[0].buyer, "Zorro")
})

test("ver la coleccion de otro viewer y tradear por la web", async t => {
  const { call, luna, zorro, dragon, gato, qty } = await setup(t)
  const other = await call("/api/gacha/viewer?login=@Zorro", "luna")
  assert.equal(other.status, 200)
  assert.deepEqual(other.json.cards.map(card => [card.name, card.qty]), [["Gato", 2]])
  assert.equal((await call("/api/gacha/viewer?login=nadie", "luna")).status, 409)

  const offer = await call("/api/trade/create", "luna", { to: "zorro", give: { cards: [{ id: dragon.id }] }, want: { cards: [{ id: gato.id, qty: 2 }] } })
  assert.equal(offer.status, 200)
  const incoming = (await call("/api/gacha", "zorro")).json.trades.incoming
  assert.equal(incoming.length, 1)
  assert.equal(incoming[0].with, "Luna")
  assert.equal(incoming[0].give.cards[0].name, "Dragon")
  const accepted = await call("/api/trade/respond", "zorro", { tradeId: incoming[0].id, accept: true })
  assert.equal(accepted.status, 200)
  assert.equal(qty(zorro, dragon), 1)
  assert.equal(qty(luna, gato), 2)
})

test("ofrecer lo que no se tiene da un mensaje claro", async t => {
  const { call, gato } = await setup(t)
  const result = await call("/api/trade/create", "luna", { to: "zorro", give: { cards: [{ id: gato.id }] }, want: { points: 10 } })
  assert.equal(result.status, 409)
  assert.equal(result.json.error, "No tienes todo lo que ofreces (personajes o puntos).")
})

test("limite de acciones por minuto", async t => {
  const { call } = await setup(t)
  for (let i = 0; i < MAX_ACTIONS_PER_MINUTE; i++) await call("/api/market/cancel", "luna", { listingId: "x" })
  const limited = await call("/api/market/cancel", "luna", { listingId: "x" })
  assert.equal(limited.status, 429)
})

test("forjar por la web: 10 comunes dan un personaje de rango superior", async t => {
  const { call, platform, zorro, gato, dragon, qty } = await setup(t)
  assert.deepEqual((await call("/api/gacha", "zorro")).json.forgeCosts, { comun: 10, raro: 7, epico: 5 })
  const short = await call("/api/forge", "zorro", { cardId: gato.id })
  assert.equal(short.status, 409)
  assert.equal(short.json.error, "No tienes suficientes copias de ese personaje para forjar.")
  platform.profiles.grantCard("canal", zorro.id, gato.id, 8, "seed")
  const forged = await call("/api/forge", "zorro", { cardId: gato.id })
  assert.equal(forged.status, 200)
  assert.equal(forged.json.card.name, "Dragon")
  assert.equal(forged.json.used.qty, 10)
  assert.equal(qty(zorro, gato), 0)
  assert.equal(qty(zorro, dragon), 1)
  const legend = await call("/api/forge", "luna", { cardId: dragon.id })
  assert.equal(legend.json.error, "Los legendarios ya son el rango más alto: no se pueden forjar.")
})

// ── Maquina del gachapon en la web ─────────────────────────────────────────────
const { createGachaponService } = require("../src/services/gachapon.js")

async function setupMachine(t) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const luna = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: luna.id, balanceDelta: 1500, idempotencyKey: "seed", reason: "seed" })
  const gato = platform.profiles.createCard("canal", { name: "Gato", rarity: "comun" })
  platform.profiles.createCard("canal", { name: "Dragon", rarity: "legendario" })
  const shown = []
  const gachapon = createGachaponService({ platform, getChannel: () => "canal", random: () => 0, broadcast: payload => shown.push(payload), log: { error() {} } })
  gachapon.setConfig({ price: 100 })
  platform.profiles.grantCard("canal", luna.id, gato.id, 1, "seed")
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const token = sessions.issue({ twitchId: "111", login: "luna" }).token
  const server = createCanjeServer({
    data: { viewerState: () => null }, gacha: createCanjeGacha({ platform, getChannel: () => "canal", gachapon }), sessions, validator: { validate: async () => null },
    assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const call = async (route, body, auth = true) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET",
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, json: await response.json() }
  }
  return { call, shown }
}

test("web: /api/gacha/machine da precio, probabilidades, garantia y saldo", async t => {
  const { call } = await setupMachine(t)
  const { status, json } = await call("/api/gacha/machine")
  assert.equal(status, 200)
  assert.equal(json.price, 100)
  assert.equal(json.points, 1500)
  assert.equal(json.pity.count, 0)
  assert.deepEqual(json.odds.filter(row => row.count).map(row => row.rarity), ["comun", "legendario"])
  assert.equal((await call("/api/gacha/machine", null, false)).status, 401)
})

test("web: tirar x1 marca si es nuevo, cobra y avisa al overlay", async t => {
  const { call, shown } = await setupMachine(t)
  const { status, json } = await call("/api/gacha/pull", { count: 1, key: "k1" })
  assert.equal(status, 200)
  assert.equal(json.results.length, 1)
  assert.equal(json.results[0].card.name, "Gato")
  assert.equal(json.results[0].isNew, false)
  assert.equal(json.results[0].card.number, 1)
  assert.equal(json.points, 1400)
  assert.equal(json.pity.count, 1)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(shown.filter(item => item.type === "gachapon_result").length, 1)
})

test("web: x10 da diez cartas, un solo aviso al overlay y rechaza sin saldo", async t => {
  const { call, shown } = await setupMachine(t)
  const ten = await call("/api/gacha/pull", { count: 10, key: "k10" })
  assert.equal(ten.status, 200)
  assert.equal(ten.json.results.length, 10)
  assert.equal(ten.json.points, 500)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(shown.filter(item => item.type === "gachapon_result").length, 1)
  const broke = await call("/api/gacha/pull", { count: 10, key: "k10b" })
  assert.equal(broke.status, 409)
  assert.match(broke.json.error, /puntos/)
})
