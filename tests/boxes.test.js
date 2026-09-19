const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createBoxService, parseOdds, rollMimic, MAX_OPEN_PER_COMMAND } = require("../src/services/boxes.js")
const { createRouletteService } = require("../src/services/roulette.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")

function setup({ odds = { comun: 70, raro: 20, epico: 8, legendario: 2 }, mimicCount = 3 } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const rolls = { value: 0 }
  const service = createBoxService({ platform, getChannel: () => "canal", random: () => rolls.value, log: { error() {} } })

  const box = platform.mimics.createBox("canal", { name: "Cofre Dorado", mimic_count: mimicCount, odds })
  const common = platform.mimics.create("canal", { name: "Confeti", rarity: "comun" })
  const rare = platform.mimics.create("canal", { name: "Fuegos", rarity: "raro" })
  const legendary = platform.mimics.create("canal", { name: "Dragon", rarity: "legendario" })
  const viewer = platform.identities.resolve({ platform: "tiktok", platformUserId: "777", username: "luna", display: "Luna" })
  const identity = { platform: "tiktok", platformUserId: "777", username: "luna", displayName: "Luna" }
  const giveBoxes = (quantity, key = `k-${Math.random()}`) => platform.mimics.grantBoxes("canal", viewer.id, box.id, quantity, key)
  const owned = () => platform.mimics.boxInventory("canal", viewer.id).reduce((sum, row) => sum + row.quantity, 0)
  const mimicCount_ = () => platform.mimics.inventory("canal", viewer.id).reduce((sum, row) => sum + row.quantity, 0)
  return { db, platform, service, rolls, box, common, rare, legendary, viewer, identity, giveBoxes, owned, mimicCount: mimicCount_ }
}

test("parseOdds ignora valores invalidos y json roto", () => {
  assert.deepEqual(parseOdds('{"comun":70,"raro":"x","epico":-1,"legendario":2}'), { comun: 70, legendario: 2 })
  assert.deepEqual(parseOdds("no es json"), {})
  assert.deepEqual(parseOdds(undefined), {})
})

test("rollMimic reparte por peso y solo entre rarezas que existen", () => {
  const a = { id: "a", rarity: "comun" }
  const b = { id: "b", rarity: "legendario" }
  const byRarity = new Map([["comun", [a]], ["legendario", [b]]])
  const all = [a, b]
  assert.equal(rollMimic(byRarity, all, { comun: 90, legendario: 10 }, () => 0.5).id, "a")
  assert.equal(rollMimic(byRarity, all, { comun: 90, legendario: 10 }, () => 0.95).id, "b")
  // "raro" tiene peso pero ningun Mimic: se renormaliza sin perder la tirada.
  assert.equal(rollMimic(byRarity, all, { raro: 50, comun: 50 }, () => 0.99).id, "a")
  // Sin rarezas utilizables se reparte parejo.
  assert.equal(rollMimic(byRarity, all, {}, () => 0.9).id, "b")
})

test("abrir un cofre consume 1 y entrega mimic_count Mimics al inventario", () => {
  const { service, identity, giveBoxes, owned, mimicCount } = setup({ mimicCount: 3 })
  giveBoxes(2)
  const result = service.open(identity)
  assert.equal(result.ok, true)
  assert.equal(result.opened, 1)
  assert.equal(result.remaining, 1)
  assert.equal(owned(), 1)
  assert.equal(mimicCount(), 3)
  assert.equal(result.rewards.reduce((sum, reward) => sum + reward.quantity, 0), 3)
})

test("las probabilidades por rareza de la caja mandan", () => {
  const { service, identity, giveBoxes, rolls } = setup({ odds: { comun: 50, raro: 50 }, mimicCount: 1 })
  giveBoxes(2)
  rolls.value = 0.1
  assert.equal(service.open(identity).rewards[0].name, "Confeti")
  rolls.value = 0.9
  assert.equal(service.open(identity).rewards[0].name, "Fuegos")
})

test("sin cofres no pasa nada", () => {
  const { service, identity, mimicCount } = setup()
  assert.equal(service.open(identity).reason, "empty")
  assert.equal(mimicCount(), 0)
})

test("sin Mimics creados no se gasta el cofre", () => {
  const { service, platform, identity, giveBoxes, owned } = setup()
  giveBoxes(1)
  for (const mimic of platform.mimics.list("canal")) platform.mimics.remove(mimic.id)
  assert.equal(service.open(identity).reason, "no-mimics")
  assert.equal(owned(), 1)
})

test("abrir varios respeta lo que tiene y el tope por comando", () => {
  const { service, identity, giveBoxes, owned } = setup({ mimicCount: 1 })
  giveBoxes(3)
  assert.equal(service.open(identity, 99).opened, 3)
  assert.equal(owned(), 0)
  giveBoxes(MAX_OPEN_PER_COMMAND + 5)
  assert.equal(service.open(identity, 999).opened, MAX_OPEN_PER_COMMAND)
})

test("la apertura es atomica: si falla la entrega, el cofre no se gasta", () => {
  const { service, platform, identity, giveBoxes, owned, mimicCount } = setup({ mimicCount: 3 })
  giveBoxes(2)
  const original = platform.mimics.grant
  let calls = 0
  platform.mimics.grant = (...args) => { if (++calls === 2) throw new Error("disco lleno"); return original.apply(platform.mimics, args) }
  assert.throws(() => service.open(identity), /disco lleno/)
  platform.mimics.grant = original
  assert.equal(owned(), 2)
  assert.equal(mimicCount(), 0)
})

test("listAll muestra los cofres de todos los viewers para el panel", () => {
  const { service, platform, box, giveBoxes } = setup()
  giveBoxes(4)
  const other = platform.identities.resolve({ platform: "twitch", platformUserId: "t1", username: "kira", display: "Kira" })
  platform.mimics.grantBoxes("canal", other.id, box.id, 1, "otra")
  const rows = service.listAll()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].display, "Luna")
  assert.equal(rows[0].quantity, 4)
  assert.equal(rows[1].platform, "twitch")
})

// ── Integracion: ruleta -> cofres -> comandos ────────────────────────────────
function engineWith(services) {
  const replies = []
  const overlays = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    overlay: payload => overlays.push(payload),
    ...services,
  })
  const chat = text => engine.handle({
    platform: "tiktok", type: "chat_message", metadata: {},
    actor: { platformUserId: "777", username: "luna", displayName: "Luna" },
    message: { text },
  })
  return { chat, replies, overlays }
}

test("!cofres y !abrircofre: del inventario a los Mimics", () => {
  const { service, giveBoxes } = setup({ mimicCount: 2 })
  giveBoxes(2)
  const { chat, replies, overlays } = engineWith({ boxes: service })

  chat("!cofres")
  assert.match(replies.at(-1), /tienes 2 cofres sin abrir \(2 Cofre Dorado\)/)

  chat("!abrircofre")
  assert.match(replies.at(-1), /abrio 1 cofre y obtuvo: .+ Le quedan 1\./)
  assert.equal(overlays.at(-1).type, "mimic_message")

  chat("!abrir 5")
  assert.match(replies.at(-1), /abrio 1 cofre/)
  chat("!abrircofre")
  assert.match(replies.at(-1), /no tienes cofres sin abrir/)
  chat("!cofres")
  assert.match(replies.at(-1), /no tienes cofres sin abrir/)
})

test("!abrircofre valida la cantidad", () => {
  const { service } = setup()
  const { chat, replies } = engineWith({ boxes: service })
  chat("!abrircofre 0")
  assert.match(replies.at(-1), /Uso: !abrircofre/)
  chat("!abrircofre abc")
  assert.match(replies.at(-1), /Uso: !abrircofre/)
})

test("flujo completo: gira la ruleta, recibe cofres y los abre", () => {
  const { platform, service, box, rolls, mimicCount } = setup({ mimicCount: 1 })
  const roulette = createRouletteService({ platform, getChannel: () => "canal", random: () => rolls.value, log: { error() {} } })
  const store = new Map()
  platform.moderation.getConfig = (_c, key) => store.get(key)
  platform.moderation.setConfig = (_c, key, value) => { store.set(key, value); return value }
  roulette.setConfig({ enabled: true, mode: "dice", diceSides: 6, boxId: box.id, cooldownSeconds: 0 })

  const { chat, replies } = engineWith({ roulette, boxes: service })
  rolls.value = 0.99
  chat("!ruletacofres")
  assert.match(replies.at(-1), /ganó 6 cofres/)
  chat("!cofres")
  assert.match(replies.at(-1), /tienes 6 cofres/)
  chat("!abrircofre 6")
  assert.match(replies.at(-1), /abrio 6 cofres/)
  assert.equal(mimicCount(), 6)
})
