const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createGachaponService, rollPrize, normalizeRarity, DEFAULT_PRICE, STEAL_WINDOW_MS } = require("../src/services/gachapon.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")

const IDENTITY = { platform: "twitch", platformUserId: "42", username: "luna", displayName: "Luna" }

function setup({ balance = 1000, price = 100 } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const broadcasts = []
  const rolls = { value: 0 }
  const clock = { t: 1_000_000 }
  const service = createGachaponService({
    platform, getChannel: () => "canal", random: () => rolls.value, now: () => clock.t,
    getAvatar: async () => "https://cdn.example/luna.png",
    broadcast: payload => broadcasts.push(payload), log: { error() {} },
  })
  if (price !== undefined) service.setConfig({ price })
  const common = platform.profiles.createCard("canal", { name: "Gatito", rarity: "comun", imagePath: "http://127.0.0.1:7777/assets/gatito.png" })
  const legendary = platform.profiles.createCard("canal", { name: "Dragon", rarity: "legendario" })
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "42", username: "luna", display: "Luna" })
  if (balance) platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: balance, idempotencyKey: "seed", reason: "seed" })
  const wallet = () => platform.economy.getBalance("canal", viewer.id).balance
  const owned = () => platform.profiles.getCards("canal", viewer.id)
  return { platform, service, broadcasts, rolls, clock, common, legendary, wallet, owned }
}

test("normalizeRarity acepta espanol e ingles", () => {
  assert.equal(normalizeRarity("legendary"), "legendario")
  assert.equal(normalizeRarity("Epico"), "epico")
  assert.equal(normalizeRarity("rara-cosa"), "comun")
})

test("rollPrize respeta la rareza guardada en espanol (antes caia siempre al azar)", () => {
  const prizes = [{ name: "a", rarity: "comun" }, { name: "b", rarity: "legendario" }]
  // comun 60 + legendario 3 = 63. Tirada baja -> comun, tirada alta -> legendario.
  assert.equal(rollPrize(prizes, () => 0.1).name, "a")
  assert.equal(rollPrize(prizes, () => 0.97).name, "b")
})

test("el precio por defecto es 100 y se puede cambiar; rechaza precios invalidos", () => {
  const { service } = setup({ price: undefined })
  assert.equal(service.getConfig().price, DEFAULT_PRICE)
  assert.equal(service.setConfig({ price: 250 }).price, 250)
  assert.throws(() => service.setConfig({ price: -5 }), /Precio inválido/)
  assert.throws(() => service.setConfig({ price: 1.5 }), /Precio inválido/)
})

test("pull cobra el precio y guarda el personaje en la coleccion", () => {
  const { service, wallet, owned } = setup()
  const result = service.pull(IDENTITY, "k1")
  assert.equal(result.ok, true)
  assert.equal(result.price, 100)
  assert.equal(result.prize.name, "Gatito")
  assert.equal(result.prize.image, "http://127.0.0.1:7777/assets/gatito.png")
  assert.equal(wallet(), 900)
  assert.equal(owned().length, 1)
})

test("pull con la misma clave no cobra dos veces", () => {
  const { service, wallet } = setup()
  service.pull(IDENTITY, "same")
  service.pull(IDENTITY, "same")
  assert.equal(wallet(), 900)
})

test("sin saldo suficiente no cobra ni entrega", () => {
  const { service, wallet, owned } = setup({ balance: 50 })
  const result = service.pull(IDENTITY, "k1")
  assert.deepEqual([result.ok, result.reason, result.price, result.balance], [false, "funds", 100, 50])
  assert.equal(wallet(), 50)
  assert.equal(owned().length, 0)
})

test("con precio 0 es gratis", () => {
  const { service, wallet, owned } = setup({ balance: 0, price: 0 })
  assert.equal(service.pull(IDENTITY, "k1").ok, true)
  assert.equal(wallet(), 0)
  assert.equal(owned().length, 1)
})

test("sin personajes avisa el motivo", () => {
  const { platform, service, common, legendary } = setup()
  platform.profiles.removeCard(common.id)
  platform.profiles.removeCard(legendary.id)
  assert.equal(service.pull(IDENTITY).reason, "no-prizes")
})

test("show manda el resultado con la foto al Overlay 3", async () => {
  const { service, broadcasts } = setup()
  await service.show(IDENTITY, service.pull(IDENTITY, "k1"))
  assert.equal(broadcasts[0].type, "gachapon_result")
  assert.equal(broadcasts[0].viewer, "Luna")
  assert.equal(broadcasts[0].avatar, "https://cdn.example/luna.png")
  assert.equal(broadcasts[0].prize.image, "http://127.0.0.1:7777/assets/gatito.png")
})

test("!gachapon responde en el chat y avisa si no alcanza", async () => {
  const { service, broadcasts } = setup({ balance: 150 })
  const replies = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    overlay: () => {}, gachapon: service,
  })
  const chat = (text, id) => engine.handle({ id, platform: "twitch", type: "chat_message", metadata: {}, actor: IDENTITY, message: { text } })

  chat("!gachapon", "m1")
  assert.equal(replies[0], "@Luna giró el gachapon (-100 pts) y le salió: Gatito [Común]. VIP, mods y subs tienen 15 s para robarlo con !robarpj")
  chat("!gachapon", "m2")
  assert.equal(replies[1], "@Luna necesitas 100 puntos y tienes 50.")
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(broadcasts.length, 1)
})

// ── !robarpj ─────────────────────────────────────────────────────────────────
const THIEF = { platform: "twitch", platformUserId: "77", username: "zorro", displayName: "Zorro" }
const THIEF2 = { platform: "twitch", platformUserId: "88", username: "gato", displayName: "Gato" }

function cardsOf(platform, identity) {
  const viewer = platform.identities.resolve({ platform: identity.platform, platformUserId: identity.platformUserId, username: identity.username })
  return platform.profiles.getCards("canal", viewer.id).filter(card => card.quantity > 0).map(card => card.name)
}

test("robarpj dentro de los 15 s le quita el personaje al dueno y se lo da al ladron", async () => {
  const { platform, service, broadcasts, clock } = setup()
  const pulled = service.pull(IDENTITY, "k1")
  clock.t += STEAL_WINDOW_MS - 1
  const result = service.steal(THIEF)
  assert.equal(result.ok, true)
  assert.equal(result.owner, "Luna")
  assert.equal(result.prize.name, "Gatito")
  assert.deepEqual(cardsOf(platform, IDENTITY), [])
  assert.deepEqual(cardsOf(platform, THIEF), ["Gatito"])
  // El aviso al overlay espera la foto del ladron y llega despues.
  await new Promise(resolve => setImmediate(resolve))
  const stolen = broadcasts.at(-1)
  assert.equal(stolen.type, "gachapon_stolen")
  assert.equal(stolen.thief, "Zorro")
  assert.equal(stolen.thiefAvatar, "https://cdn.example/luna.png") // getAvatar falso del setup
  assert.equal(stolen.dropId, pulled.dropId)
})

test("robarpj despues de 15 s no hace nada", () => {
  const { platform, service, clock } = setup()
  service.pull(IDENTITY, "k1")
  clock.t += STEAL_WINDOW_MS
  assert.deepEqual(service.steal(THIEF), { ok: false, reason: "none" })
  assert.deepEqual(cardsOf(platform, IDENTITY), ["Gatito"])
})

test("solo el primero se lo lleva", () => {
  const { platform, service } = setup()
  service.pull(IDENTITY, "k1")
  assert.equal(service.steal(THIEF).ok, true)
  assert.deepEqual(service.steal(THIEF2), { ok: false, reason: "none" })
  assert.deepEqual(cardsOf(platform, THIEF), ["Gatito"])
  assert.deepEqual(cardsOf(platform, THIEF2), [])
})

test("nadie se puede robar su propia tirada", () => {
  const { platform, service } = setup()
  service.pull(IDENTITY, "k1")
  assert.deepEqual(service.steal(IDENTITY), { ok: false, reason: "own" })
  assert.deepEqual(cardsOf(platform, IDENTITY), ["Gatito"])
})

test("si el dueno ya tenia el personaje repetido, solo pierde una copia", () => {
  const { platform, service } = setup()
  service.pull(IDENTITY, "k1")
  service.pull(IDENTITY, "k2")
  service.steal(THIEF)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "42", username: "luna" })
  assert.equal(platform.profiles.getCards("canal", viewer.id)[0].quantity, 1)
})

test("con dos tiradas abiertas se roba la mas reciente", () => {
  const { platform, service, rolls } = setup()
  service.pull(IDENTITY, "k1")
  rolls.value = 0.99
  service.pull(IDENTITY, "k2")
  assert.equal(service.steal(THIEF).prize.name, "Dragon")
  assert.deepEqual(cardsOf(platform, IDENTITY), ["Gatito"])
})

test("robarpj esta limitado a VIP, mod y sub de Twitch por defecto", () => {
  const { COMMANDS } = require("../src/services/command-config.js")
  const command = COMMANDS.find(item => item.name === "!robarpj")
  assert.deepEqual(command.defaultAllowedRanks, ["twitch:vip", "twitch:mod", "twitch:sub"])
})

test("!robarpj responde en el chat", () => {
  const { platform, service } = setup()
  const replies = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    overlay: () => {}, gachapon: service,
  })
  const chat = (actor, text, id) => engine.handle({ id, platform: "twitch", type: "chat_message", metadata: {}, actor, message: { text } })
  chat(THIEF, "!robarpj", "r0")
  assert.equal(replies[0], "@Zorro no hay ningún personaje para robar ahora mismo.")
  service.pull(IDENTITY, "k1")
  chat(THIEF, "!robarpj", "r1")
  assert.equal(replies[1], "@Zorro le robó Gatito [Común] a @Luna.")
  assert.deepEqual(cardsOf(platform, THIEF), ["Gatito"])
})

// ── !regalarpj ───────────────────────────────────────────────────────────────
function knownViewer(platform, identity) {
  return platform.identities.resolve({ platform: identity.platform, platformUserId: identity.platformUserId, username: identity.username, display: identity.displayName })
}

test("regalarpj pasa una copia al otro viewer, sin importar tildes ni mayusculas", () => {
  const { platform, service, clock, broadcasts } = setup()
  knownViewer(platform, THIEF)
  platform.profiles.createCard("canal", { name: "Dragón Azul", rarity: "epico" })
  const card = platform.profiles.listCards("canal").find(item => item.name === "Dragón Azul")
  const luna = knownViewer(platform, IDENTITY)
  platform.profiles.grantCard("canal", luna.id, card.id, 1, "seed")
  const result = service.gift(IDENTITY, "@Zorro", "dragon azul")
  assert.equal(result.ok, true)
  assert.equal(result.to, "Zorro")
  assert.deepEqual(cardsOf(platform, IDENTITY), [])
  assert.deepEqual(cardsOf(platform, THIEF), ["Dragón Azul"])
  assert.equal(broadcasts.at(-1).type, "gachapon_gift")

})

test("regalarpj acepta un trozo del nombre si solo hay uno que coincide", () => {
  const { platform, service, clock } = setup()
  knownViewer(platform, THIEF)
  service.pull(IDENTITY, "k1")
  clock.t += STEAL_WINDOW_MS
  assert.equal(service.gift(IDENTITY, "zorro", "gat").ok, true)
  assert.deepEqual(cardsOf(platform, THIEF), ["Gatito"])
})

test("regalarpj no deja esquivar el robo: bloqueado mientras la ventana esta abierta", () => {
  const { platform, service, clock } = setup()
  knownViewer(platform, THIEF)
  service.pull(IDENTITY, "k1")
  clock.t += 5_000
  assert.deepEqual(service.gift(IDENTITY, "@zorro", "Gatito"), { ok: false, reason: "stealable", seconds: 10 })
  assert.deepEqual(cardsOf(platform, IDENTITY), ["Gatito"])
})

test("regalarpj rechaza casos invalidos", () => {
  const { platform, service, clock } = setup()
  knownViewer(platform, THIEF)
  assert.equal(service.gift(IDENTITY, "@zorro", "Gatito").reason, "empty")
  service.pull(IDENTITY, "k1")
  clock.t += STEAL_WINDOW_MS
  assert.deepEqual(service.gift(IDENTITY, "@zorro", ""), { ok: false, reason: "usage", owned: ["Gatito"] })
  assert.equal(service.gift(IDENTITY, "", "Gatito").reason, "usage")
  assert.deepEqual(service.gift(IDENTITY, "@nadie", "Gatito"), { ok: false, reason: "unknown", target: "nadie" })
  assert.equal(service.gift(IDENTITY, "@luna", "Gatito").reason, "self")
  assert.deepEqual(service.gift(IDENTITY, "@zorro", "Dragon"), { ok: false, reason: "not-owned", owned: ["Gatito"] })
  assert.deepEqual(cardsOf(platform, IDENTITY), ["Gatito"])
})

test("regalarpj con nombre ambiguo pide el nombre completo", () => {
  const { platform, service } = setup()
  knownViewer(platform, THIEF)
  const luna = knownViewer(platform, IDENTITY)
  for (const name of ["Gato Negro", "Gato Blanco"]) {
    const card = platform.profiles.createCard("canal", { name, rarity: "comun" })
    platform.profiles.grantCard("canal", luna.id, card.id, 1, `seed-${name}`)
  }
  const result = service.gift(IDENTITY, "@zorro", "gato")
  assert.equal(result.reason, "ambiguous")
  assert.equal(result.owned.length, 2)
})

test("regalarpj no cruza plataformas", () => {
  const { platform, service, clock } = setup()
  knownViewer(platform, { platform: "tiktok", platformUserId: "t1", username: "zorro", displayName: "Zorro" })
  service.pull(IDENTITY, "k1")
  clock.t += STEAL_WINDOW_MS
  assert.equal(service.gift(IDENTITY, "@zorro", "Gatito").reason, "unknown")
})

test("!regalarpj responde en el chat", () => {
  const { platform, service, clock } = setup()
  knownViewer(platform, THIEF)
  const replies = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    overlay: () => {}, gachapon: service,
  })
  const chat = (text, id) => engine.handle({ id, platform: "twitch", type: "chat_message", metadata: {}, actor: IDENTITY, message: { text } })
  service.pull(IDENTITY, "k1")
  clock.t += STEAL_WINDOW_MS
  chat("!regalarpj @zorro", "g1")
  assert.equal(replies[0], "Uso: !regalarpj @usuario <personaje>. Tienes: Gatito")
  chat("!regalarpj @zorro Gatito", "g2")
  assert.equal(replies[1], "@Luna le regaló Gatito [Común] a @Zorro.")
})

// ── Garantia, x10 y probabilidades ─────────────────────────────────────────────
const { oddsFor, PITY_LIMIT } = require("../src/services/gachapon.js")

test("la garantia da un legendario en la tirada PITY_LIMIT y vuelve a empezar", () => {
  const { service, rolls } = setup({ balance: 100 * PITY_LIMIT + 500 })
  rolls.value = 0 // sin la garantia siempre saldria comun
  for (let i = 1; i < PITY_LIMIT; i++) {
    const result = service.pull(IDENTITY, `pity-${i}`)
    assert.equal(result.prize.rarity, "comun")
    assert.equal(result.pity.count, i)
  }
  const lucky = service.pull(IDENTITY, "pity-final")
  assert.equal(lucky.prize.name, "Dragon")
  assert.equal(lucky.pity.guaranteed, true)
  assert.equal(lucky.pity.count, 0)
  assert.equal(lucky.pity.left, PITY_LIMIT)
})

test("un legendario por suerte tambien reinicia la garantia", () => {
  const { service, rolls } = setup()
  rolls.value = 0
  service.pull(IDENTITY, "a"); service.pull(IDENTITY, "b")
  rolls.value = 0.99
  const result = service.pull(IDENTITY, "c")
  assert.equal(result.prize.rarity, "legendario")
  assert.equal(result.pity.guaranteed, false)
  assert.equal(result.pity.count, 0)
})

test("x10 comprueba el saldo antes de empezar: sin puntos para las 10 no cobra ninguna", () => {
  const { service, wallet, owned } = setup({ balance: 500 })
  const result = service.pullMany(IDENTITY, 10, "multi")
  assert.equal(result.ok, false)
  assert.equal(result.reason, "funds")
  assert.equal(wallet(), 500)
  assert.equal(owned().length, 0)
})

test("x10 con saldo da 10 personajes, cobra 10 tiradas y suma 10 a la garantia", () => {
  const { service, wallet, rolls } = setup({ balance: 1000 })
  rolls.value = 0
  const result = service.pullMany(IDENTITY, 10, "multi")
  assert.equal(result.ok, true)
  assert.equal(result.results.length, 10)
  assert.equal(result.spent, 1000)
  assert.equal(wallet(), 0)
  assert.equal(result.pity.count, 10)
})

test("x10 cuenta las tiradas gratis del Pase Sub y rechaza cantidades raras", () => {
  const { service, platform, wallet } = setup({ balance: 800 })
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "42", username: "luna", display: "Luna" })
  platform.tickets.grant("canal", viewer.id, "gachapon", 2)
  const result = service.pullMany(IDENTITY, 10, "multi-free")
  assert.equal(result.ok, true)
  assert.equal(result.spent, 800)
  assert.equal(wallet(), 0)
  assert.equal(service.pullMany(IDENTITY, 11).reason, "bad-count")
  assert.equal(service.pullMany(IDENTITY, 0).reason, "bad-count")
})

test("las probabilidades solo cuentan las rarezas que tienen personajes", () => {
  const odds = oddsFor([{ rarity: "comun" }, { rarity: "comun" }, { rarity: "legendario" }])
  const byRarity = Object.fromEntries(odds.map(row => [row.rarity, row]))
  assert.equal(byRarity.comun.percent, 95.2)
  assert.equal(byRarity.legendario.percent, 4.8)
  assert.equal(byRarity.raro.percent, 0)
  assert.equal(byRarity.comun.count, 2)
})

test("machine devuelve precio, probabilidades, garantia y tiradas gratis", () => {
  const { service } = setup()
  service.pull(IDENTITY, "uno")
  const info = service.machine(IDENTITY)
  assert.equal(info.price, 100)
  assert.equal(info.pity.limit, PITY_LIMIT)
  assert.equal(info.pity.count, 1)
  assert.equal(info.freePulls, 0)
  assert.equal(info.odds.length, 4)
})

test("tiradas de la web: solo los legendarios se pueden robar", () => {
  const { platform, service, rolls } = setup()
  rolls.value = 0
  const common = service.pullMany(IDENTITY, 1, "web-comun", { stealOnlyLegendary: true })
  assert.equal(common.results[0].stealSeconds, 0)
  assert.deepEqual(service.steal(THIEF), { ok: false, reason: "none" })
  assert.deepEqual(cardsOf(platform, IDENTITY), ["Gatito"])
  rolls.value = 0.99
  const legendary = service.pullMany(IDENTITY, 1, "web-legend", { stealOnlyLegendary: true })
  assert.equal(legendary.results[0].stealSeconds, STEAL_WINDOW_MS / 1000)
  assert.equal(service.steal(THIEF).ok, true)
})

test("las tiradas del chat se siguen pudiendo robar aunque sean comunes", () => {
  const { service, rolls } = setup()
  rolls.value = 0
  service.pull(IDENTITY, "chat-comun")
  assert.equal(service.steal(THIEF).ok, true)
})
