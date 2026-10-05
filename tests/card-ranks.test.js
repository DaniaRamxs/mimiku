const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createCardRanks, DEFAULT_ASCEND_COSTS } = require("../src/services/card-ranks.js")
const { createCardSleeves } = require("../src/services/card-sleeves.js")
const { createGachaMarket } = require("../src/services/gacha-market.js")
const { createGachaTrades } = require("../src/services/gacha-trades.js")
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
  const krillin = platform.profiles.createCard("canal", { name: "Krillin", rarity: "comun" })
  const getChannel = () => "canal"
  const ranks = createCardRanks({ platform, getChannel })
  const give = (viewer, qty) => platform.profiles.grantCard("canal", viewer.id, krillin.id, qty, "g")
  const variants = viewer => platform.profiles.getCardVariants("canal", viewer.id).map(row => [row.rank, row.sleeve, row.quantity])
  const plain = viewer => platform.profiles.plainCopies("canal", viewer.id, krillin.id)
  return { platform, getChannel, luna, zorro, krillin, ranks, give, variants, plain }
}

test("costes por defecto: 10 raro, 15 epico, 20 legendario, 40 mitico (ademas de la carta que sube)", () => {
  assert.deepEqual(DEFAULT_ASCEND_COSTS, { raro: 10, epico: 15, legendario: 20, mitico: 40 })
})

test("una carta comun sube paso a paso hasta mitica gastando copias normales", () => {
  const { ranks, luna, krillin, give, variants, plain } = setup()
  give(luna, 1 + 10 + 15 + 20 + 40 + 2)
  const raro = ranks.ascend(luna.id, krillin.id)
  assert.equal(raro.ok, true)
  assert.equal(raro.rank, "raro")
  assert.equal(plain(luna), 88 - 11)
  assert.equal(ranks.ascend(luna.id, krillin.id, { rank: "raro" }).rank, "epico")
  assert.equal(ranks.ascend(luna.id, krillin.id, { rank: "epico" }).rank, "legendario")
  const mitico = ranks.ascend(luna.id, krillin.id, { rank: "legendario" })
  assert.equal(mitico.rank, "mitico")
  assert.equal(mitico.rankLabel, "Mítico")
  assert.equal(plain(luna), 2)
  assert.deepEqual(variants(luna).filter(row => row[2] > 0), [["mitico", "", 1]])
  assert.equal(ranks.ascend(luna.id, krillin.id, { rank: "mitico" }).reason, "max-rank")
})

test("sin copias suficientes no gasta nada", () => {
  const { ranks, luna, krillin, give, plain } = setup()
  give(luna, 10)
  assert.deepEqual(ranks.ascend(luna.id, krillin.id), { ok: false, reason: "ascend-short", cost: 10 })
  assert.equal(plain(luna), 10)
})

test("una carta epica de base empieza desde epico", () => {
  const { platform, ranks, luna } = setup()
  const hada = platform.profiles.createCard("canal", { name: "Hada", rarity: "epico" })
  platform.profiles.grantCard("canal", luna.id, hada.id, 21, "g")
  assert.equal(ranks.ascend(luna.id, hada.id).rank, "legendario")
})

test("la funda se queda al subir de rango, y se puede poner funda a una carta subida", () => {
  const { platform, getChannel, ranks, luna, krillin, give, variants } = setup()
  give(luna, 30)
  const sleeves = createCardSleeves({ platform, getChannel })
  sleeves.grant(luna.id, "prisma", 1)
  sleeves.apply(luna.id, krillin.id, "prisma")
  assert.equal(ranks.ascend(luna.id, krillin.id, { sleeve: "prisma" }).rank, "raro")
  assert.deepEqual(variants(luna).filter(row => row[2] > 0), [["raro", "prisma", 1]])
  ranks.ascend(luna.id, krillin.id)
  sleeves.grant(luna.id, "rara", 1)
  assert.equal(sleeves.apply(luna.id, krillin.id, "rara", "raro").ok, true)
  assert.deepEqual(variants(luna).filter(row => row[2] > 0).sort(), [["raro", "prisma", 1], ["raro", "rara", 1]])
})

test("la carta subida se vende y se tradea con su rango", () => {
  const { platform, getChannel, ranks, luna, zorro, krillin, give, variants } = setup()
  give(luna, 22)
  ranks.ascend(luna.id, krillin.id)
  ranks.ascend(luna.id, krillin.id)
  const market = createGachaMarket({ platform, getChannel })
  const listed = market.list(luna.id, krillin.id, 100, { rank: "raro" })
  assert.equal(listed.ok, true)
  assert.equal(market.openListings()[0].rank, "raro")
  assert.equal(market.buy(zorro.id, listed.listingId).ok, true)
  assert.deepEqual(variants(zorro), [["raro", "", 1]])
  const trades = createGachaTrades({ platform, getChannel })
  const offer = trades.create(luna.id, zorro.id, { cards: [{ id: krillin.id, rank: "raro" }] }, { points: 10 })
  assert.equal(offer.ok, true)
  assert.equal(trades.respond(zorro.id, offer.tradeId, true).ok, true)
  assert.deepEqual(variants(zorro), [["raro", "", 2]])
})

test("en la pagina cada variante sale como su propia carta, con el rango como rareza", () => {
  const { platform, ranks, luna, krillin, give } = setup()
  give(luna, 13)
  ranks.ascend(luna.id, krillin.id)
  const tiles = createCanjeData({ platform, getChannel: () => "canal" }).viewerState("111").gacha
  assert.deepEqual(tiles.map(tile => [tile.rarity, tile.rank, tile.quantity]), [["comun", null, 2], ["raro", "raro", 1]])
  assert.equal(new Set(tiles.map(tile => tile.key)).size, 2)
})

test("!regalarpj no regala copias con rango subido y lo explica", () => {
  const { platform, getChannel, ranks, luna, krillin, give, variants } = setup()
  give(luna, 11)
  ranks.ascend(luna.id, krillin.id)
  const { createGachaponService } = require("../src/services/gachapon.js")
  const gacha = createGachaponService({ platform, getChannel, log: { error() {} } })
  const result = gacha.gift({ platform: "twitch", platformUserId: "111", username: "luna", displayName: "luna" }, "@zorro", "Krillin")
  assert.equal(result.reason, "special-only")
  assert.deepEqual(variants(luna), [["raro", "", 1]])
})
