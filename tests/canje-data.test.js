const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createCanjeData, publicImage } = require("../src/services/canje-data.js")

const HASH = "a".repeat(64)

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { value: 1_000_000 }
  const data = createCanjeData({ platform, getChannel: () => "Canal", now: () => clock.value })
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: 500, idempotencyKey: "seed", reason: "seed" })
  const mimic = platform.mimics.create("canal", { name: "Confeti", icon: "*", rarity: "raro" })
  platform.mimics.grant("canal", viewer.id, mimic.id, 2, "g1")
  return { db, platform, data, viewer, mimic, clock }
}

test("publicImage sirve las imagenes locales de Mimiku por el servidor de canje", () => {
  assert.equal(publicImage(`http://127.0.0.1:7777/assets/${HASH}.png`), `assets/${HASH}.png`)
  assert.equal(publicImage("https://img.example/x.png"), "https://img.example/x.png")
  assert.equal(publicImage("http://otra.web/x.png"), null)
  assert.equal(publicImage("http://127.0.0.1:7777/assets/..%2Fsecreto.png"), null)
  assert.equal(publicImage("no es url"), null)
})

test("viewerState lee puntos, Mimics, cofres y gachapon del viewer de Twitch", () => {
  const { platform, data, viewer, mimic } = setup()
  const card = platform.profiles.createCard("canal", { name: "Gatito", rarity: "legendary", imagePath: `http://127.0.0.1:7777/assets/${HASH}.png` })
  platform.profiles.grantCard("canal", viewer.id, card.id, 1)
  const state = data.viewerState("111")
  assert.equal(state.display, "Luna")
  assert.equal(state.points, 500)
  assert.deepEqual(state.mimics, [{ id: mimic.id, name: "Confeti", icon: "*", rarity: "raro", description: "", quantity: 2 }])
  assert.deepEqual(state.gacha, [{ id: card.id, name: "Gatito", baseRarity: "legendario", description: "", image: `assets/${HASH}.png`, number: 1, key: card.id, rarity: "legendario", rank: null, sleeve: null, quantity: 1 }])
  assert.deepEqual(state.uses, [])
})

test("viewerState numera las cartas por orden de creacion y cuenta el progreso por rareza", () => {
  const { platform, data, viewer } = setup()
  const first = platform.profiles.createCard("canal", { name: "Zorro", rarity: "comun" })
  platform.profiles.createCard("canal", { name: "Buho", rarity: "comun" })
  const third = platform.profiles.createCard("canal", { name: "Dragon", rarity: "epico" })
  platform.profiles.createCard("otro", { name: "De otro canal", rarity: "epico" })
  platform.profiles.grantCard("canal", viewer.id, first.id, 3)
  platform.profiles.grantCard("canal", viewer.id, third.id, 1)
  const state = data.viewerState("111")
  assert.deepEqual(state.gacha.map(item => [item.name, item.number]), [["Dragon", 3], ["Zorro", 1]])
  assert.deepEqual(state.gachaStats, {
    owned: 2, total: 3,
    byRarity: { comun: { owned: 1, total: 2 }, raro: { owned: 0, total: 0 }, epico: { owned: 1, total: 1 }, legendario: { owned: 0, total: 0 } },
  })
})

test("viewerState es null para cuentas que Mimiku no conoce", () => {
  assert.equal(setup().data.viewerState("999"), null)
})

test("redeem descuenta el Mimic y lo deja en la cola del directo", () => {
  const { platform, data, viewer, mimic } = setup()
  assert.deepEqual(data.redeem("111", mimic.id, "k1"), { ok: true, name: "Confeti" })
  assert.equal(platform.mimics.inventory("canal", viewer.id)[0].quantity, 1)
  const state = data.viewerState("111")
  assert.equal(state.uses.length, 1)
  assert.equal(state.uses[0].status, "pending")
})

test("un canje hecho despues del arranque lo recoge la cola de Mimics (misma consulta que mimics.js)", () => {
  const { db, data, mimic } = setup()
  const queueStartedAt = new Date(Date.now() - 1000).toISOString() // como startUseQueue()
  data.redeem("111", mimic.id, "k1")
  const picked = db.prepare("SELECT * FROM mimic_uses_local WHERE status='pending' AND used_at>=?").all(queueStartedAt)
  assert.equal(picked.length, 1)
  assert.match(picked[0].used_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test("redeem con la misma clave no gasta dos veces", () => {
  const { platform, data, viewer, mimic } = setup()
  data.redeem("111", mimic.id, "same")
  data.redeem("111", mimic.id, "same")
  assert.equal(platform.mimics.inventory("canal", viewer.id)[0].quantity, 1)
})

test("redeem rechaza Mimics que no tiene, ajenos o inexistentes", () => {
  const { platform, data, mimic } = setup()
  const other = platform.identities.resolve({ platform: "twitch", platformUserId: "222", username: "otro" })
  assert.equal(data.redeem("222", mimic.id, "k1").reason, "unavailable")
  assert.equal(data.redeem("111", "no-existe", "k2").reason, "unavailable")
  assert.equal(data.redeem("999", mimic.id, "k3").reason, "unknown-viewer")
  data.redeem("111", mimic.id, "k4")
  data.redeem("111", mimic.id, "k5")
  assert.equal(data.redeem("111", mimic.id, "k6").reason, "unavailable")
  assert.ok(other)
})

test("redeem limita a 5 canjes por minuto por viewer", () => {
  const { platform, data, viewer, mimic, clock } = setup()
  platform.mimics.grant("canal", viewer.id, mimic.id, 20, "g2")
  for (let i = 0; i < 5; i++) assert.equal(data.redeem("111", mimic.id, `k${i}`).ok, true)
  assert.equal(data.redeem("111", mimic.id, "k5").reason, "rate-limit")
  clock.value += 61_000
  assert.equal(data.redeem("111", mimic.id, "k6").ok, true)
})

function withBox(platform, input = {}) {
  return platform.mimics.createBox("canal", { name: "Cofre dorado", price_points: 200, mimic_count: 3, odds: { comun: 3, raro: 1 }, ...input })
}

test("viewerState incluye la tienda: solo cajas con precio en puntos, con probabilidades", () => {
  const { platform, data } = setup()
  const box = withBox(platform)
  withBox(platform, { name: "Gratis", price_points: 0 })
  withBox(platform, { name: "Solo dinero", price_points: null, price_real: 5 })
  const { shop } = data.viewerState("111")
  assert.equal(shop.length, 1)
  assert.equal(shop[0].id, box.id)
  assert.equal(shop[0].price, 200)
  assert.equal(shop[0].mimicCount, 3)
  assert.deepEqual(shop[0].odds, [{ rarity: "comun", percent: 75 }, { rarity: "raro", percent: 25 }])
})

test("buyBox cobra los puntos y entrega el cofre sin abrir", () => {
  const { platform, data, viewer } = setup()
  const box = withBox(platform)
  assert.deepEqual(data.buyBox("111", box.id, "compra-1"), { ok: true, name: "Cofre dorado", price: 200, quantity: 1 })
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 300)
  assert.deepEqual(platform.mimics.boxInventory("canal", viewer.id).map(row => [row.box_id, row.quantity]), [[box.id, 1]])
  assert.deepEqual(data.viewerState("111").chests, [{ id: box.id, name: "Cofre dorado", icon: box.icon, quantity: 1 }])
})

test("buyBox con la misma clave no cobra ni entrega dos veces", () => {
  const { platform, data, viewer } = setup()
  const box = withBox(platform)
  data.buyBox("111", box.id, "misma")
  data.buyBox("111", box.id, "misma")
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 300)
  assert.equal(platform.mimics.boxInventory("canal", viewer.id)[0].quantity, 1)
})

test("buyBox sin saldo no cobra ni entrega nada", () => {
  const { platform, data, viewer } = setup()
  const box = withBox(platform, { price_points: 501 })
  assert.equal(data.buyBox("111", box.id, "k1").reason, "insufficient")
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 500)
  assert.deepEqual(platform.mimics.boxInventory("canal", viewer.id), [])
})

test("buyBox rechaza cajas sin precio, de otro canal, inexistentes y viewers desconocidos", () => {
  const { platform, data } = setup()
  const free = withBox(platform, { price_points: 0 })
  const foreign = platform.mimics.createBox("otro", { name: "Ajena", price_points: 10 })
  assert.equal(data.buyBox("111", free.id, "k1").reason, "not-for-sale")
  assert.equal(data.buyBox("111", foreign.id, "k2").reason, "not-for-sale")
  assert.equal(data.buyBox("111", "no-existe", "k3").reason, "not-for-sale")
  assert.equal(data.buyBox("999", withBox(platform).id, "k4").reason, "unknown-viewer")
})

test("buyBox limita a 5 compras por minuto por viewer", () => {
  const { platform, data, clock } = setup()
  const box = withBox(platform, { price_points: 10 })
  for (let i = 0; i < 5; i++) assert.equal(data.buyBox("111", box.id, `c${i}`).ok, true)
  assert.equal(data.buyBox("111", box.id, "c5").reason, "rate-limit")
  clock.value += 61_000
  assert.equal(data.buyBox("111", box.id, "c6").ok, true)
})

test("openBox abre 1 cofre del tipo pedido y entrega los Mimics", () => {
  const { platform, data, viewer, mimic } = setup()
  const box = withBox(platform, { mimic_count: 2 })
  const other = withBox(platform, { name: "Otro" })
  platform.mimics.grantBoxes("canal", viewer.id, box.id, 2, "gb1")
  platform.mimics.grantBoxes("canal", viewer.id, other.id, 1, "gb2")
  const result = data.openBox("111", box.id, "abrir-1")
  assert.deepEqual(result, { ok: true, name: "Cofre dorado", opened: 1, rewards: [{ name: "Confeti", icon: "*", rarity: "raro", quantity: 2 }] })
  const left = Object.fromEntries(platform.mimics.boxInventory("canal", viewer.id).map(row => [row.box_id, row.quantity]))
  assert.deepEqual(left, { [box.id]: 1, [other.id]: 1 })
  assert.equal(platform.mimics.inventory("canal", viewer.id).find(row => row.mimic_id === mimic.id).quantity, 4)
})

test("openBox con la misma clave no abre otro cofre", () => {
  const { platform, data, viewer } = setup()
  const box = withBox(platform)
  platform.mimics.grantBoxes("canal", viewer.id, box.id, 2, "gb1")
  const first = data.openBox("111", box.id, "misma")
  assert.deepEqual(data.openBox("111", box.id, "misma"), first)
  assert.equal(platform.mimics.boxInventory("canal", viewer.id)[0].quantity, 1)
})

test("openBox rechaza cofres que no tiene y viewers desconocidos", () => {
  const { platform, data } = setup()
  const box = withBox(platform)
  assert.equal(data.openBox("111", box.id, "k1").reason, "no-chest")
  assert.equal(data.openBox("111", "no-existe", "k2").reason, "no-chest")
  assert.equal(data.openBox("999", box.id, "k3").reason, "unknown-viewer")
})

test("buyBox compra varios cofres de una vez y cobra el total", () => {
  const { platform, data, viewer } = setup()
  const box = withBox(platform, { price_points: 50 })
  assert.deepEqual(data.buyBox("111", box.id, "cinco", 5), { ok: true, name: "Cofre dorado", price: 250, quantity: 5 })
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 250)
  assert.equal(platform.mimics.boxInventory("canal", viewer.id)[0].quantity, 5)
  data.buyBox("111", box.id, "cinco", 5) // reintento: no cobra otra vez
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 250)
})

test("buyBox de varios sin saldo para todos no compra ninguno", () => {
  const { platform, data, viewer } = setup()
  const box = withBox(platform, { price_points: 60 })
  assert.equal(data.buyBox("111", box.id, "diez", 10).reason, "insufficient")
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 500)
  assert.deepEqual(platform.mimics.boxInventory("canal", viewer.id), [])
})

test("buyBox y openBox rechazan cantidades no validas", () => {
  const { platform, data } = setup()
  const box = withBox(platform, { price_points: 1 })
  for (const bad of [0, -1, 1.5, 101, "5", "all", null]) {
    assert.equal(data.buyBox("111", box.id, `b${bad}`, bad).reason, "bad-quantity")
    assert.equal(data.openBox("111", box.id, `o${bad}`, bad).reason, "bad-quantity")
  }
})

test("openBox abre varios cofres a la vez (mas de 10) y no mas de los que tiene", () => {
  const { platform, data, viewer, mimic } = setup()
  const box = withBox(platform, { mimic_count: 1 })
  platform.mimics.grantBoxes("canal", viewer.id, box.id, 12, "gb1")
  const result = data.openBox("111", box.id, "todos", 12)
  assert.equal(result.opened, 12)
  assert.deepEqual(result.rewards, [{ name: "Confeti", icon: "*", rarity: "raro", quantity: 12 }])
  assert.deepEqual(platform.mimics.boxInventory("canal", viewer.id), [])
  assert.equal(platform.mimics.inventory("canal", viewer.id).find(row => row.mimic_id === mimic.id).quantity, 14)

  platform.mimics.grantBoxes("canal", viewer.id, box.id, 3, "gb2")
  assert.equal(data.openBox("111", box.id, "diez", 10).opened, 3)
})
