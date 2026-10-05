const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createCardSleeves } = require("../src/services/card-sleeves.js")
const { createGachaMarket } = require("../src/services/gacha-market.js")
const { createGachaTrades } = require("../src/services/gacha-trades.js")
const { createGachaForge } = require("../src/services/gacha-forge.js")
const { createCanjeData } = require("../src/services/canje-data.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const person = (id, login) => {
    const row = platform.identities.resolve({ platform: "twitch", platformUserId: id, username: login, display: login })
    platform.economy.applyMovement({ channelId: "canal", viewerId: row.id, balanceDelta: 10000, idempotencyKey: `seed-${id}`, reason: "seed" })
    return row
  }
  const luna = person("111", "luna")
  const zorro = person("222", "zorro")
  const gato = platform.profiles.createCard("canal", { name: "Gato", rarity: "comun" })
  const dragon = platform.profiles.createCard("canal", { name: "Dragon", rarity: "raro" })
  const getChannel = () => "canal"
  const sleeves = createCardSleeves({ platform, getChannel })
  const copies = (viewer, card) => {
    const row = platform.profiles.getCards("canal", viewer.id).find(item => item.card_id === card.id)
    const sleeved = Object.fromEntries(platform.profiles.getCardVariants("canal", viewer.id).filter(item => item.card_id === card.id && !item.rank).map(item => [item.sleeve, item.quantity]))
    return { total: row ? row.quantity : 0, ...sleeved }
  }
  return { platform, getChannel, luna, zorro, gato, dragon, sleeves, copies }
}

test("poner una funda: gasta la funda y marca una copia; solo en copias sin funda", () => {
  const { platform, sleeves, luna, gato, copies } = setup()
  platform.profiles.grantCard("canal", luna.id, gato.id, 1, "g")
  assert.deepEqual(sleeves.apply(luna.id, gato.id, "epica"), { ok: false, reason: "no-sleeve" })
  sleeves.grant(luna.id, "epica", 2)
  assert.equal(sleeves.apply(luna.id, gato.id, "epica").ok, true)
  assert.deepEqual(copies(luna, gato), { total: 1, epica: 1 })
  assert.deepEqual(sleeves.apply(luna.id, gato.id, "epica"), { ok: false, reason: "no-plain-copy" })
  assert.equal(sleeves.tokens(luna.id).epica, 1, "si no se pudo poner, la funda no se gasta")
})

test("robar, regalar y forjar no tocan las copias con funda", () => {
  const { platform, getChannel, sleeves, luna, gato, copies } = setup()
  platform.profiles.grantCard("canal", luna.id, gato.id, 10, "g")
  sleeves.grant(luna.id, "rara", 1)
  sleeves.apply(luna.id, gato.id, "rara")
  assert.equal(platform.profiles.takeCard("canal", luna.id, gato.id, 10), false, "solo hay 9 sin funda")
  const forge = createGachaForge({ platform, getChannel, random: () => 0 })
  assert.equal(forge.forge(luna.id, gato.id).reason, "forge-short")
  assert.deepEqual(copies(luna, gato), { total: 10, rara: 1 })
  assert.equal(platform.profiles.takeCard("canal", luna.id, gato.id, 9), true)
  assert.deepEqual(copies(luna, gato), { total: 1, rara: 1 })
})

test("vender la copia con funda: el comprador la recibe con la funda; retirarla la devuelve igual", () => {
  const { platform, getChannel, sleeves, luna, zorro, dragon, copies } = setup()
  platform.profiles.grantCard("canal", luna.id, dragon.id, 2, "g")
  sleeves.grant(luna.id, "prisma", 1)
  sleeves.apply(luna.id, dragon.id, "prisma")
  const market = createGachaMarket({ platform, getChannel })
  const listed = market.list(luna.id, dragon.id, 500, { sleeve: "prisma" })
  assert.equal(listed.ok, true)
  assert.deepEqual(copies(luna, dragon), { total: 1 })
  assert.equal(market.openListings()[0].sleeve, "prisma")
  assert.equal(market.cancel(luna.id, listed.listingId).ok, true)
  assert.deepEqual(copies(luna, dragon), { total: 2, prisma: 1 })
  const again = market.list(luna.id, dragon.id, 500, { sleeve: "prisma" })
  assert.equal(market.buy(zorro.id, again.listingId).ok, true)
  assert.deepEqual(copies(zorro, dragon), { total: 1, prisma: 1 })
  assert.deepEqual(market.list(luna.id, dragon.id, 500, { sleeve: "prisma" }), { ok: false, reason: "not-owned" })
})

test("tradear la copia con funda la pasa con la funda", () => {
  const { platform, getChannel, sleeves, luna, zorro, gato, dragon, copies } = setup()
  platform.profiles.grantCard("canal", luna.id, dragon.id, 1, "g")
  platform.profiles.grantCard("canal", zorro.id, gato.id, 1, "g")
  sleeves.grant(luna.id, "epica", 1)
  sleeves.apply(luna.id, dragon.id, "epica")
  const trades = createGachaTrades({ platform, getChannel })
  assert.equal(trades.create(luna.id, zorro.id, { cards: [{ id: dragon.id }] }, { cards: [{ id: gato.id }] }).reason, "you-lack", "sin funda no la tiene")
  const offer = trades.create(luna.id, zorro.id, { cards: [{ id: dragon.id, sleeve: "epica" }] }, { cards: [{ id: gato.id }] })
  assert.equal(offer.ok, true)
  assert.equal(trades.respond(zorro.id, offer.tradeId, true).ok, true)
  assert.deepEqual(copies(zorro, dragon), { total: 1, epica: 1 })
  assert.deepEqual(copies(luna, gato), { total: 1 })
})

test("la pagina recibe las fundas de cada carta, las fundas sin poner y las cartas que faltan", () => {
  const { platform, sleeves, luna, gato, dragon } = setup()
  platform.profiles.grantCard("canal", luna.id, gato.id, 2, "g")
  sleeves.grant(luna.id, "rara", 2)
  sleeves.apply(luna.id, gato.id, "rara")
  const state = createCanjeData({ platform, getChannel: () => "canal" }).viewerState("111")
  assert.deepEqual(state.gacha.map(tile => [tile.key === gato.id ? "normal" : tile.sleeve, tile.quantity]), [["normal", 1], ["rara", 1]])
  assert.deepEqual(state.sleeveTokens, { rara: 1, epica: 0, prisma: 0, corona: 0 })
  assert.deepEqual(state.gachaMissing, [{ id: dragon.id, name: "Dragon", rarity: "raro", image: null, number: 2 }])
})
