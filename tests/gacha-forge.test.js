const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createGachaForge, FORGE_COSTS } = require("../src/services/gacha-forge.js")

function setup({ rarities = ["comun", "raro", "epico", "legendario"], random = () => 0 } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "1", username: "luna", display: "Luna" })
  const cards = {}
  for (const rarity of rarities) {
    cards[rarity] = [1, 2].map(n => platform.profiles.createCard("canal", { name: `${rarity}${n}`, rarity }))
  }
  const forge = createGachaForge({ platform, getChannel: () => "canal", random })
  const qty = card => (platform.profiles.getCards("canal", viewer.id).find(row => row.card_id === card.id) || { quantity: 0 }).quantity
  const give = (card, n) => platform.profiles.grantCard("canal", viewer.id, card.id, n, "seed")
  return { forge, viewer, cards, qty, give }
}

test("costes de forja: 10 comunes, 7 raros, 5 epicos, legendarios no", () => {
  assert.deepEqual(FORGE_COSTS, { comun: 10, raro: 7, epico: 5 })
})

for (const [from, to] of [["comun", "raro"], ["raro", "epico"], ["epico", "legendario"]]) {
  test(`forjar ${FORGE_COSTS[from]} ${from} da 1 ${to} y gasta solo esas copias`, () => {
    const { forge, viewer, cards, qty, give } = setup({ random: () => 0.99 })
    const source = cards[from][0]
    give(source, FORGE_COSTS[from] + 2)
    const result = forge.forge(viewer.id, source.id)
    assert.equal(result.ok, true)
    assert.equal(result.card.id, cards[to][1].id)
    assert.deepEqual(result.used, { id: source.id, name: source.name, rarity: from, qty: FORGE_COSTS[from] })
    assert.equal(qty(source), 2)
    assert.equal(qty(cards[to][1]), 1)
  })
}

test("sin copias suficientes no se quita nada", () => {
  const { forge, viewer, cards, qty, give } = setup()
  give(cards.raro[0], 6)
  assert.deepEqual(forge.forge(viewer.id, cards.raro[0].id), { ok: false, reason: "forge-short" })
  assert.equal(qty(cards.raro[0]), 6)
  assert.equal(qty(cards.epico[0]), 0)
})

test("los legendarios no se forjan", () => {
  const { forge, viewer, cards, qty, give } = setup()
  give(cards.legendario[0], 20)
  assert.deepEqual(forge.forge(viewer.id, cards.legendario[0].id), { ok: false, reason: "max-rarity" })
  assert.equal(qty(cards.legendario[0]), 20)
})

test("si falta la rareza siguiente salta a la proxima que tenga personajes", () => {
  const { forge, viewer, cards, give } = setup({ rarities: ["comun", "epico"] })
  give(cards.comun[0], 10)
  const result = forge.forge(viewer.id, cards.comun[0].id)
  assert.equal(result.ok, true)
  assert.equal(result.card.rarity, "epico")
})

test("sin personajes de rango superior no se forja", () => {
  const { forge, viewer, cards, qty, give } = setup({ rarities: ["comun"] })
  give(cards.comun[0], 10)
  assert.deepEqual(forge.forge(viewer.id, cards.comun[0].id), { ok: false, reason: "no-higher" })
  assert.equal(qty(cards.comun[0]), 10)
})

test("personaje inexistente", () => {
  const { forge, viewer } = setup()
  assert.deepEqual(forge.forge(viewer.id, "nada"), { ok: false, reason: "gone" })
})
