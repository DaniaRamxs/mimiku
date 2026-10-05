const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createGachaMarket, MAX_OPEN_PER_SELLER } = require("../src/services/gacha-market.js")
const { createGachaTrades, normalizeSide, TRADE_TTL_MS } = require("../src/services/gacha-trades.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-09-30T12:00:00Z") }
  const deps = { platform, getChannel: () => "Canal", now: () => clock.t }
  const market = createGachaMarket(deps)
  const trades = createGachaTrades(deps)
  const viewer = (id, name, points = 1000) => {
    const row = platform.identities.resolve({ platform: "twitch", platformUserId: id, username: name, display: name })
    if (points) platform.economy.applyMovement({ channelId: "canal", viewerId: row.id, balanceDelta: points, idempotencyKey: `seed-${id}`, reason: "seed" })
    return row
  }
  const luna = viewer("1", "Luna")
  const zorro = viewer("2", "Zorro")
  const dragon = platform.profiles.createCard("canal", { name: "Dragon", rarity: "legendario" })
  const gato = platform.profiles.createCard("canal", { name: "Gato", rarity: "comun" })
  const give = (who, card, qty = 1) => platform.profiles.grantCard("canal", who.id, card.id, qty, "seed")
  const qty = (who, card) => (platform.profiles.getCards("canal", who.id).find(row => row.card_id === card.id) || { quantity: 0 }).quantity
  const points = who => platform.economy.getBalance("canal", who.id).balance
  return { db, platform, clock, market, trades, luna, zorro, dragon, gato, give, qty, points }
}

// ── Mercado ──────────────────────────────────────────────────────────────────
test("vender retiene la carta y comprar la entrega cobrando la comision del 5%", () => {
  const { market, luna, zorro, dragon, give, qty, points } = setup()
  give(luna, dragon)
  const listed = market.list(luna.id, dragon.id, 500)
  assert.equal(listed.ok, true)
  assert.equal(qty(luna, dragon), 0, "retenida en la venta")
  assert.equal(market.openListings().length, 1)
  const bought = market.buy(zorro.id, listed.listingId)
  assert.deepEqual(bought, { ok: true, name: "Dragon", price: 500, fee: 25 })
  assert.equal(qty(zorro, dragon), 1)
  assert.equal(points(zorro), 500)
  assert.equal(points(luna), 1475)
  assert.equal(market.openListings().length, 0)
  assert.equal(market.recentSales()[0].buyer_display, "Zorro")
})

test("la comision se puede cambiar y 0% paga el precio completo", () => {
  const { market, luna, zorro, dragon, give, points } = setup()
  assert.equal(market.setConfig({ feePercent: 0 }).feePercent, 0)
  assert.throws(() => market.setConfig({ feePercent: 60 }), /0 a 50/)
  give(luna, dragon)
  market.buy(zorro.id, market.list(luna.id, dragon.id, 300).listingId)
  assert.equal(points(luna), 1300)
})

test("sin saldo no se compra y nada cambia", () => {
  const { market, luna, zorro, dragon, give, qty, points } = setup()
  give(luna, dragon)
  const { listingId } = market.list(luna.id, dragon.id, 5000)
  assert.deepEqual(market.buy(zorro.id, listingId), { ok: false, reason: "insufficient" })
  assert.equal(points(zorro), 1000)
  assert.equal(qty(zorro, dragon), 0)
  assert.equal(market.openListings().length, 1)
})

test("solo se vende una vez, no se compra lo propio y retirar devuelve la carta", () => {
  const { platform, market, luna, zorro, dragon, give, qty } = setup()
  const tercero = platform.identities.resolve({ platform: "twitch", platformUserId: "3", username: "mia", display: "Mia" })
  give(luna, dragon, 2)
  const a = market.list(luna.id, dragon.id, 100)
  assert.deepEqual(market.buy(luna.id, a.listingId), { ok: false, reason: "own" })
  assert.equal(market.buy(zorro.id, a.listingId).ok, true)
  assert.deepEqual(market.buy(tercero.id, a.listingId), { ok: false, reason: "gone" })
  const b = market.list(luna.id, dragon.id, 100)
  assert.deepEqual(market.cancel(zorro.id, b.listingId), { ok: false, reason: "not-yours" })
  assert.deepEqual(market.cancel(luna.id, b.listingId), { ok: true })
  assert.equal(qty(luna, dragon), 1)
  assert.deepEqual(market.cancel(luna.id, b.listingId), { ok: false, reason: "gone" })
})

test("no se puede vender lo que no se tiene ni con precio invalido; hay limite de ventas abiertas", () => {
  const { market, luna, dragon, gato, give } = setup()
  assert.deepEqual(market.list(luna.id, dragon.id, 100), { ok: false, reason: "not-owned" })
  give(luna, gato, MAX_OPEN_PER_SELLER + 1)
  for (const bad of [0, -5, 1.5, "abc", 2e9]) assert.deepEqual(market.list(luna.id, gato.id, bad), { ok: false, reason: "bad-price" })
  for (let i = 0; i < MAX_OPEN_PER_SELLER; i++) assert.equal(market.list(luna.id, gato.id, 10).ok, true)
  assert.deepEqual(market.list(luna.id, gato.id, 10), { ok: false, reason: "too-many" })
})

// ── Tradeos ──────────────────────────────────────────────────────────────────
test("normalizeSide valida y junta repetidos", () => {
  assert.deepEqual(normalizeSide({ cards: [{ id: "a" }, { id: "a", qty: 2 }], points: 5 }), { cards: [{ id: "a", qty: 3 }], points: 5 })
  assert.equal(normalizeSide({ cards: [{ id: "a", qty: 0 }] }), null)
  assert.equal(normalizeSide({ points: -1 }), null)
  assert.equal(normalizeSide({ cards: "x" }), null)
  assert.equal(normalizeSide(null), null)
})

test("aceptar un tradeo mueve cartas y puntos de los dos lados", () => {
  const { trades, luna, zorro, dragon, gato, give, qty, points } = setup()
  give(luna, dragon)
  give(zorro, gato, 3)
  const offer = trades.create(luna.id, zorro.id, { cards: [{ id: dragon.id }], points: 100 }, { cards: [{ id: gato.id, qty: 2 }] })
  assert.equal(offer.ok, true)
  assert.equal(trades.listFor(zorro.id).incoming.length, 1)
  assert.equal(trades.listFor(luna.id).outgoing.length, 1)
  assert.deepEqual(trades.respond(zorro.id, offer.tradeId, true), { ok: true })
  assert.equal(qty(zorro, dragon), 1)
  assert.equal(qty(luna, dragon), 0)
  assert.equal(qty(luna, gato), 2)
  assert.equal(qty(zorro, gato), 1)
  assert.equal(points(luna), 900)
  assert.equal(points(zorro), 1100)
  assert.equal(trades.listFor(luna.id).history[0].status, "accepted")
})

test("si al que ofrecio le falta algo al aceptar, no se mueve nada y la oferta falla", () => {
  const { trades, market, luna, zorro, dragon, gato, give, qty } = setup()
  give(luna, dragon)
  give(zorro, gato)
  const offer = trades.create(luna.id, zorro.id, { cards: [{ id: dragon.id }] }, { cards: [{ id: gato.id }] })
  market.list(luna.id, dragon.id, 50) // Luna lo pone a la venta despues de ofrecerlo
  assert.deepEqual(trades.respond(zorro.id, offer.tradeId, true), { ok: false, reason: "from-lacks" })
  assert.equal(qty(zorro, gato), 1)
  assert.equal(trades.listFor(zorro.id).history[0].status, "failed")
})

test("si a quien recibe le falta algo, la oferta sigue pendiente", () => {
  const { trades, luna, zorro, dragon, gato, give, qty } = setup()
  give(luna, dragon)
  const offer = trades.create(luna.id, zorro.id, { cards: [{ id: dragon.id }] }, { cards: [{ id: gato.id }] })
  assert.deepEqual(trades.respond(zorro.id, offer.tradeId, true), { ok: false, reason: "you-lack" })
  assert.equal(qty(luna, dragon), 1)
  assert.equal(trades.listFor(zorro.id).incoming.length, 1)
  give(zorro, gato)
  assert.deepEqual(trades.respond(zorro.id, offer.tradeId, true), { ok: true })
})

test("puntos que no alcanzan hacen fallar el tradeo sin mover cartas", () => {
  const { trades, platform, luna, zorro, dragon, gato, give, qty } = setup()
  give(luna, dragon)
  give(zorro, gato)
  const offer = trades.create(luna.id, zorro.id, { cards: [{ id: dragon.id }] }, { cards: [{ id: gato.id }], points: 900 })
  platform.economy.applyMovement({ channelId: "canal", viewerId: zorro.id, balanceDelta: -500, idempotencyKey: "gasto", reason: "x" })
  assert.deepEqual(trades.respond(zorro.id, offer.tradeId, true), { ok: false, reason: "you-lack" })
  assert.equal(qty(luna, dragon), 1)
  assert.equal(qty(zorro, gato), 1)
})

test("rechazar, cancelar, permisos y caducidad a las 24 h", () => {
  const { trades, clock, luna, zorro, dragon, gato, give } = setup()
  give(luna, dragon, 3)
  const side = { cards: [{ id: dragon.id }] }
  const want = { cards: [{ id: gato.id }] }
  const a = trades.create(luna.id, zorro.id, side, want)
  assert.deepEqual(trades.respond(luna.id, a.tradeId, true), { ok: false, reason: "not-yours" })
  assert.deepEqual(trades.respond(zorro.id, a.tradeId, false), { ok: true })
  assert.deepEqual(trades.respond(zorro.id, a.tradeId, true), { ok: false, reason: "gone" })
  const b = trades.create(luna.id, zorro.id, side, want)
  assert.deepEqual(trades.cancel(zorro.id, b.tradeId), { ok: false, reason: "not-yours" })
  assert.deepEqual(trades.cancel(luna.id, b.tradeId), { ok: true })
  const c = trades.create(luna.id, zorro.id, side, want)
  clock.t += TRADE_TTL_MS
  assert.deepEqual(trades.respond(zorro.id, c.tradeId, true), { ok: false, reason: "gone" })
  assert.equal(trades.listFor(luna.id).history[0].status, "expired")
})

test("crear valida lados vacios, a uno mismo y lo que se ofrece", () => {
  const { trades, luna, zorro, dragon, gato, give } = setup()
  give(luna, dragon)
  assert.equal(trades.create(luna.id, zorro.id, { cards: [{ id: dragon.id }] }, {}).reason, "empty-side")
  assert.equal(trades.create(luna.id, luna.id, { cards: [{ id: dragon.id }] }, { points: 5 }).reason, "self")
  assert.equal(trades.create(luna.id, zorro.id, { cards: [{ id: gato.id }] }, { points: 5 }).reason, "you-lack")
  assert.equal(trades.create(luna.id, zorro.id, { points: 5000 }, { cards: [{ id: gato.id }] }).reason, "you-lack")
  assert.equal(trades.create(luna.id, zorro.id, { cards: [{ id: "no-existe" }] }, { points: 5 }).reason, "bad-offer")
})
