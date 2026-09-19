const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")

function fakeEconomy(overrides = {}) {
  return {
    getViewer: () => ({ points: 100 }),
    addPoints: () => ({ points: 110 }),
    getRanking: () => [],
    claimDaily: () => ({ ok: true, msg: "daily" }),
    claimWork: () => ({ ok: true, msg: "work" }),
    depositar: () => ({ ok: true, msg: "deposito" }),
    retirar: () => ({ ok: true, msg: "retiro" }),
    verBanco: () => ({ ok: true, msg: "banco" }),
    robar: () => ({ ok: true, msg: "robo" }),
    ...overrides,
  }
}

function noopEngine() {
  return createCommandEngine({
    economy: fakeEconomy(),
    games: {},
    events: {},
    shop: { checkCooldown: () => 0, setCooldown: () => {} },
    vipService: { getCommandNames: () => ["!bruh", "!hola"] },
  })
}

function chatEvent(text, overrides = {}) {
  return {
    platform: "twitch",
    type: "chat_message",
    actor: { platformUserId: "u1", username: "luna", displayName: "Luna", isModerator: false },
    message: { text },
    metadata: {},
    reply: () => {},
    ...overrides,
  }
}

test("un comando (!puntos) responde usando datos del evento normalizado", () => {
  const replies = []
  const engine = noopEngine()
  engine.handle(chatEvent("!puntos", { reply: msg => replies.push(msg) }))
  assert.equal(replies.length, 1)
  assert.match(replies[0], /tenés 100 puntos/)
})

test("un mensaje que no es comando no dispara ninguna respuesta", () => {
  const replies = []
  const engine = noopEngine()
  engine.handle(chatEvent("hola a todos", { reply: msg => replies.push(msg) }))
  assert.equal(replies.length, 0)
})

test("!info muestra los comandos configurados para VIP", () => {
  const replies = []
  const engine = noopEngine()
  engine.handle(chatEvent("!info", { reply: msg => replies.push(msg) }))

  assert.deepEqual(replies, ["💎 Comandos VIP (solo VIP): !bruh !hola"])
})

test("!info informa cuando no hay comandos VIP activos", () => {
  const replies = []
  const engine = createCommandEngine({
    economy: fakeEconomy(),
    games: {},
    events: {},
    shop: { checkCooldown: () => 0, setCooldown: () => {} },
    vipService: { getCommandNames: () => [] },
  })
  engine.handle(chatEvent("!info", { reply: msg => replies.push(msg) }))

  assert.deepEqual(replies, ["No hay comandos VIP activos."])
})

test("comandos de moderador respetan el permiso actual (actor.isModerator)", () => {
  const engine = noopEngine()
  const asViewer = []
  const asMod = []
  engine.handle(chatEvent("!dar bob 10", { reply: m => asViewer.push(m), actor: { username: "luna", displayName: "Luna", isModerator: false } }))
  engine.handle(chatEvent("!dar bob 10", { reply: m => asMod.push(m), actor: { username: "luna", displayName: "Luna", isModerator: true } }))

  assert.match(asViewer[0], /solo los mods/)
  assert.match(asMod[0], /recibió 10 pts/)
})

test("!puntos y !dar resuelven identidad real (platform + platformUserId) sobre SQLite en memoria", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const economy = createEconomyService(platform, () => "canal-test")
  const engine = createCommandEngine({
    economy, games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
  })

  // primer mensaje: se crea la identidad + wallet en 0
  const first = []
  engine.handle(chatEvent("!puntos", { reply: m => first.push(m), actor: { platformUserId: "abc123", username: "luna", displayName: "Luna" } }))
  assert.match(first[0], /tenés 0 puntos/)

  // un mod le da puntos por username; deben reflejarse para la MISMA identidad
  const gift = []
  engine.handle(chatEvent("!dar luna 50", {
    reply: m => gift.push(m),
    actor: { platformUserId: "mod-1", username: "streamer", displayName: "Streamer", isModerator: true },
  }))
  assert.match(gift[0], /recibió 50 pts/)

  const after = []
  engine.handle(chatEvent("!puntos", { reply: m => after.push(m), actor: { platformUserId: "abc123", username: "luna", displayName: "Luna" } }))
  assert.match(after[0], /tenés 50 puntos/)

  db.close()
})
