const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createRouletteService, pickSegment } = require("../src/services/roulette.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const { createCommandConfigService } = require("../src/services/command-config.js")

// Persistencia de configuracion en memoria, igual que moderation_config_local.
function memoryModeration(platform) {
  const store = new Map()
  platform.moderation.getConfig = (_channel, key) => store.get(key)
  platform.moderation.setConfig = (_channel, key, value) => { store.set(key, value); return value }
}

function setup({ startDate = new Date(2026, 8, 15, 12, 0, 0) } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  memoryModeration(platform)
  const clock = { current: startDate }
  const box = platform.mimics.createBox("canal", { name: "Cofre Dorado" })
  // `rolls.value` fija el numero aleatorio (en [0, 1)) que devolveria Math.random.
  const rolls = { value: 0 }
  const build = () => createRouletteService({
    platform, getChannel: () => "canal", random: () => rolls.value, now: () => clock.current, log: { error() {} },
  })
  return { db, platform, service: build(), box, clock, rolls, build }
}

function identity(overrides = {}) {
  return { platform: "tiktok", platformUserId: "777", username: "luna", displayName: "Luna", ...overrides }
}

function chestsOf(platform, viewerId) {
  return platform.mimics.boxInventory("canal", viewerId).reduce((sum, row) => sum + row.quantity, 0)
}

test("la migracion v5 es idempotente sobre una base existente", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  applyMigrations(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
  for (const name of ["viewer_boxes_local", "box_grant_history", "roulette_spins"]) assert.ok(tables.includes(name))
})

test("por defecto la ruleta esta desactivada", () => {
  const { service } = setup()
  assert.equal(service.spin(identity()).reason, "disabled")
})

test("modo dado: el dado usa 20 caras por defecto y entrega esa cantidad de cofres", () => {
  const { service, platform, box, rolls } = setup()
  assert.equal(service.getConfig().diceSides, 20)
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id })

  rolls.value = 0.999
  const result = service.spin(identity())
  assert.equal(result.ok, true)
  assert.equal(result.chests, 20)
  assert.equal(result.overlay.mode, "dice")
  assert.equal(result.overlay.roll, 20)
  const viewer = platform.identities.byUsername("luna", "tiktok")
  assert.equal(chestsOf(platform, viewer.id), 20)
})

test("modo dado: el minimo es 1 y N es configurable", () => {
  const { service, box, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id, diceSides: 6, cooldownSeconds: 0 })
  rolls.value = 0
  assert.equal(service.spin(identity()).chests, 1)
  rolls.value = 0.999
  assert.equal(service.spin(identity()).chests, 6)
})

test("modo segmentos: la probabilidad sigue el peso de cada segmento", () => {
  const segments = [{ weight: 90 }, { weight: 10 }]
  assert.equal(pickSegment(segments, () => 0), 0)
  assert.equal(pickSegment(segments, () => 0.899), 0)
  assert.equal(pickSegment(segments, () => 0.9), 1)
  assert.equal(pickSegment(segments, () => 0.999), 1)
})

test("modo segmentos: entrega los cofres del segmento elegido", () => {
  const { service, platform, box, rolls } = setup()
  service.setConfig({
    enabled: true, mode: "segments", boxId: box.id,
    segments: [{ label: "3 cofres", chests: 3, weight: 90 }, { label: "10 cofres", chests: 10, weight: 10 }],
  })
  rolls.value = 0.95
  const result = service.spin(identity())
  assert.equal(result.chests, 10)
  assert.equal(result.overlay.segmentIndex, 1)
  assert.equal(result.overlay.segments.length, 2)
  assert.equal(chestsOf(platform, platform.identities.byUsername("luna", "tiktok").id), 10)
})

test("el cooldown es por viewer y no afecta a otros", () => {
  const { service, box, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id, cooldownSeconds: 600 })
  rolls.value = 0.5
  assert.equal(service.spin(identity()).ok, true)
  const blocked = service.spin(identity())
  assert.equal(blocked.reason, "cooldown")
  assert.ok(blocked.remainingMs > 0 && blocked.remainingMs <= 600_000)
  assert.equal(service.spin(identity({ platformUserId: "888", username: "otra" })).ok, true)
})

test("la misma cuenta en otra plataforma tiene su propio cooldown", () => {
  const { service, box, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id, cooldownSeconds: 600 })
  rolls.value = 0.5
  service.spin(identity())
  assert.equal(service.spin(identity({ platform: "twitch" })).ok, true)
})

test("el cooldown termina con el tiempo y sobrevive a un servicio nuevo", () => {
  const { service, build, box, clock, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id, cooldownSeconds: 600 })
  rolls.value = 0.5
  service.spin(identity())

  const restarted = build()
  rolls.value = 0.5
  assert.equal(restarted.spin(identity()).reason, "cooldown")

  clock.current = new Date(clock.current.getTime() + 601_000)
  assert.equal(restarted.spin(identity()).ok, true)
})

test("si la entrega de cofres falla no queda giro ni cooldown", () => {
  const { service, platform, box, rolls, db } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id, cooldownSeconds: 600 })
  rolls.value = 0.5
  const original = platform.mimics.grantBoxes
  platform.mimics.grantBoxes = () => { throw new Error("disco lleno") }
  assert.throws(() => service.spin(identity()), /disco lleno/)
  platform.mimics.grantBoxes = original
  assert.equal(db.prepare("SELECT COUNT(*) n FROM roulette_spins").get().n, 0)
  assert.equal(service.spin(identity()).ok, true)
})

test("entregar cofres con la misma clave no duplica", () => {
  const { platform, box } = setup()
  const viewer = platform.identities.resolve({ platform: "tiktok", platformUserId: "1", username: "ana" })
  platform.mimics.grantBoxes("canal", viewer.id, box.id, 3, "clave-1")
  platform.mimics.grantBoxes("canal", viewer.id, box.id, 3, "clave-1")
  assert.equal(chestsOf(platform, viewer.id), 3)
  platform.mimics.grantBoxes("canal", viewer.id, box.id, 2, "clave-2")
  assert.equal(chestsOf(platform, viewer.id), 5)
  assert.throws(() => platform.mimics.grantBoxes("canal", viewer.id, "no-existe", 1, "clave-3"), /Caja no encontrada/)
})

test("valida la configuracion", () => {
  const { service, box } = setup()
  assert.throws(() => service.setConfig({ enabled: true, mode: "dice" }), /caja/)
  assert.throws(() => service.setConfig({ boxId: "no-existe" }), /no existe/)
  assert.throws(() => service.setConfig({ enabled: true, mode: "segments", boxId: box.id }), /segmento/)
  assert.throws(() => service.setConfig({ segments: [{ label: "x", chests: 0, weight: 1 }] }), /al menos 1 cofre/)
  assert.throws(() => service.setConfig({ segments: [{ label: "x", chests: 1, weight: 0 }] }), /peso/)
  assert.equal(service.setConfig({ diceSides: 100000 }).diceSides, 1000)
  assert.equal(service.setConfig({ diceSides: 1 }).diceSides, 2)
})

test("la vista previa no da cofres ni consume cooldown", () => {
  const { service, platform, box, db, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id })
  rolls.value = 0.5
  const payload = service.preview()
  assert.equal(payload.type, "chest_roulette")
  assert.equal(db.prepare("SELECT COUNT(*) n FROM roulette_spins").get().n, 0)
  assert.equal(platform.db.prepare("SELECT COUNT(*) n FROM viewer_boxes_local").get().n, 0)
})

// ── Integracion con el motor de comandos ────────────────────────────────────
function engineWith({ roulette, commandConfig, games = {} }) {
  const replies = []
  const overlays = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    overlay: payload => overlays.push(payload),
    roulette, commandConfig,
  })
  return { engine, replies, overlays }
}

function chat(text, overrides = {}) {
  return {
    platform: "tiktok", type: "chat_message", metadata: {},
    actor: { platformUserId: "777", username: "luna", displayName: "Luna", ...overrides },
    message: { text },
  }
}

test("!ruletacofres muestra la ruleta en el overlay y avisa del premio", () => {
  const { service, box, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id })
  rolls.value = 0.5
  const { engine, replies, overlays } = engineWith({ roulette: service })
  engine.handle(chat("!ruletacofres"))
  assert.equal(overlays.length, 1)
  assert.equal(overlays[0].type, "chest_roulette")
  assert.match(replies[0], /ganó 11 cofres/)
})

test("!ruletacofres responde con el cooldown restante", () => {
  const { service, box, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id, cooldownSeconds: 1800 })
  rolls.value = 0.5
  const { engine, replies } = engineWith({ roulette: service })
  engine.handle(chat("!ruletacofres"))
  engine.handle(chat("!ruletacofres"))
  assert.match(replies.at(-1), /espera \d+ min/)
})

test("!ruleta sigue siendo el casino y no toca la ruleta de cofres", () => {
  const spins = []
  const roulette = { spin: () => { throw new Error("no debe llamarse") } }
  const games = { rouletteSpin: (...args) => { spins.push(args); return { msg: "casino", number: 1, color: "rojo", win: false } } }
  const { engine, replies } = engineWith({ roulette, games })
  engine.handle(chat("!ruleta 100 rojo"))
  assert.equal(spins.length, 1)
  assert.equal(replies[0], "casino")
})

test("!ruletacofres respeta plataforma y rango: solo superfans de TikTok", () => {
  const { service, box, rolls } = setup()
  service.setConfig({ enabled: true, mode: "dice", boxId: box.id })
  rolls.value = 0.5

  let saved = null
  const platform = { moderation: { getConfig: () => saved, setConfig: (_c, _k, value) => { saved = value; return saved } } }
  const held = new Set()
  const commandConfig = createCommandConfigService(platform, () => "canal", {
    rankResolver: event => [...held].filter(rank => rank.startsWith(`${event.platform}:`)),
  })
  commandConfig.update("!ruletacofres", { platform: "tiktok", allowedRanks: ["tiktok:superfan"] })

  const { engine, replies, overlays } = engineWith({ roulette: service, commandConfig })
  engine.handle(chat("!ruletacofres"))
  assert.match(replies.at(-1), /solo para: Superfan de TikTok/)
  assert.equal(overlays.length, 0)

  held.add("twitch:vip")
  engine.handle({ ...chat("!ruletacofres"), platform: "twitch" })
  assert.equal(overlays.length, 0)

  held.add("tiktok:superfan")
  engine.handle(chat("!ruletacofres"))
  assert.equal(overlays.length, 1)
})
