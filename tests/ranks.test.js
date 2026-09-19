const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")
const { createGiftService } = require("../src/services/gifts.js")
const { createRankService, isValidRankId, rankLabel } = require("../src/services/ranks.js")
const { createCommandConfigService } = require("../src/services/command-config.js")

function setup(startDate = new Date(2026, 8, 15, 12, 0, 0)) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { current: startDate }
  const now = () => clock.current
  const emitted = []
  const ranks = createRankService({
    platform, getChannel: () => "canal", now, emit: event => emitted.push(event),
    isVipEvent: event => event.actor?.username === "vipuser", log: { error() {} },
  })
  const economy = createEconomyService(platform, () => "canal")
  const gifts = createGiftService({
    platform, addPointsFor: economy.addPointsFor, getChannel: () => "canal", now, log: { error() {} },
    onDonation: viewerId => ranks.refreshViewer(viewerId),
  })
  return { db, platform, ranks, gifts, emitted, clock }
}

let comboCounter = 0
function gift(service, { coins, username = "luna", userId = "777", platform = "tiktok" }) {
  return service.handleGift({
    platform, type: "gift",
    actor: { platformUserId: userId, username, displayName: username, avatarUrl: "" },
    payload: { comboId: `combo-${++comboCounter}`, coins, count: 1, giftId: "1", giftName: "Rosa" },
  })
}

function tiktokEvent(overrides = {}) {
  return { platform: "tiktok", actor: { platformUserId: "777", username: "luna", ...overrides } }
}

test("los ids de rango exigen plataforma y rango validos", () => {
  assert.equal(isValidRankId("tiktok:superfan"), true)
  assert.equal(isValidRankId("superfan"), false)
  assert.equal(isValidRankId("tiktok:rey"), false)
  assert.equal(rankLabel("tiktok:superfan"), "Superfan de TikTok")
})

test("al alcanzar el umbral del mes se otorga el rango solo y se emite un unico evento", () => {
  const { ranks, gifts, emitted } = setup()
  ranks.setSuperfanThreshold("tiktok", 1000)
  gift(gifts, { coins: 600 })
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), [])
  assert.equal(emitted.length, 0)

  gift(gifts, { coins: 400 })
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), ["tiktok:superfan"])
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].type, "rank_change")
  assert.equal(emitted[0].payload.change, "enter")
  assert.equal(emitted[0].payload.rankId, "tiktok:superfan")

  gift(gifts, { coins: 500 })
  assert.equal(emitted.length, 1)
})

test("un umbral de 0 desactiva el rango automatico", () => {
  const { ranks, gifts, emitted } = setup()
  gift(gifts, { coins: 5_000_000 })
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), [])
  assert.equal(emitted.length, 0)
})

test("el rango caduca al cambiar de mes y emite la salida", () => {
  const { ranks, gifts, emitted, clock } = setup(new Date(2026, 8, 20, 12, 0, 0))
  ranks.setSuperfanThreshold("tiktok", 500)
  gift(gifts, { coins: 500 })
  assert.equal(emitted.at(-1).payload.change, "enter")

  clock.current = new Date(2026, 9, 1, 0, 5, 0)
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), [])
  ranks.sweep()
  assert.equal(emitted.at(-1).payload.change, "leave")
  assert.equal(emitted.length, 2)
})

test("solo cuentan las monedas del mes calendario en curso", () => {
  const { ranks, gifts, clock } = setup(new Date(2026, 7, 28, 12, 0, 0))
  ranks.setSuperfanThreshold("tiktok", 1000)
  gift(gifts, { coins: 900 })
  clock.current = new Date(2026, 8, 2, 12, 0, 0)
  gift(gifts, { coins: 200 })
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), [])
})

test("un override concede el rango aunque no llegue al umbral", () => {
  const { ranks, gifts, emitted } = setup()
  ranks.setSuperfanThreshold("tiktok", 10_000)
  gift(gifts, { coins: 10 })
  ranks.addOverride({ platform: "tiktok", username: "luna", grantedBy: "streamer", reason: "colaboradora" })
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), ["tiktok:superfan"])
  assert.equal(emitted.at(-1).payload.cause, "override")
})

test("un override deny pisa el calculo automatico", () => {
  const { ranks, gifts } = setup()
  ranks.setSuperfanThreshold("tiktok", 100)
  gift(gifts, { coins: 500 })
  assert.equal(ranks.getEventRanks(tiktokEvent()).length, 1)
  ranks.addOverride({ platform: "tiktok", username: "luna", effect: "deny", reason: "abuso" })
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), [])
})

test("un override caducado deja de pisar y el barrido emite la salida", () => {
  const { ranks, emitted, clock } = setup()
  ranks.addOverride({ platform: "tiktok", username: "luna", expiresAt: "2026-09-20" })
  assert.equal(ranks.getEventRanks(tiktokEvent()).length, 1)

  clock.current = new Date(2026, 8, 21, 9, 0, 0)
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), [])
  ranks.sweep()
  assert.equal(emitted.at(-1).payload.change, "leave")
})

test("el override guarda quien lo otorgo, cuando y el motivo", () => {
  const { ranks } = setup()
  const [row] = ranks.addOverride({ platform: "tiktok", username: "@Luna", grantedBy: "Dania", reason: "sorteo" })
  assert.equal(row.granted_by, "Dania")
  assert.equal(row.reason, "sorteo")
  assert.ok(row.granted_at)
  assert.equal(row.username, "luna")
})

test("un override para un usuario aun no visto se enlaza al llegar con su id real", () => {
  const { ranks, gifts } = setup()
  ranks.addOverride({ platform: "tiktok", username: "nueva" })
  gift(gifts, { coins: 1, username: "nueva", userId: "999" })
  assert.deepEqual(ranks.getEventRanks(tiktokEvent({ platformUserId: "999", username: "nueva" })), ["tiktok:superfan"])
})

test("quitar un override recalcula y emite la salida", () => {
  const { ranks, emitted } = setup()
  const [row] = ranks.addOverride({ platform: "tiktok", username: "luna" })
  ranks.removeOverride(row.id)
  assert.equal(emitted.at(-1).payload.change, "leave")
  assert.deepEqual(ranks.getEventRanks(tiktokEvent()), [])
})

test("los rangos no se mezclan entre plataformas", () => {
  const { ranks, gifts } = setup()
  ranks.setSuperfanThreshold("tiktok", 100)
  gift(gifts, { coins: 500 })
  const twitchSameName = { platform: "twitch", actor: { platformUserId: "777", username: "luna" } }
  assert.deepEqual(ranks.getEventRanks(twitchSameName), [])
  assert.deepEqual(ranks.getEventRanks({ platform: "twitch", actor: { username: "vipuser" } }), ["twitch:vip"])
})

test("valida overrides invalidos", () => {
  const { ranks } = setup()
  assert.throws(() => ranks.addOverride({ platform: "tiktok", username: "x", rank: "rey" }), /Rango/)
  assert.throws(() => ranks.addOverride({ platform: "nope", username: "x" }), /Plataforma/)
  assert.throws(() => ranks.addOverride({ platform: "tiktok", username: "x", expiresAt: "2020-01-01" }), /ya pas/)
  assert.throws(() => ranks.addOverride({ platform: "tiktok", username: " " }), /usuario/)
  assert.throws(() => ranks.setSuperfanThreshold("tiktok", -5), /Umbral/)
})

// ── Permisos de comandos ────────────────────────────────────────────────────
function commandConfig(rankResolver) {
  let saved = null
  const platform = { moderation: { getConfig: () => saved, setConfig: (_c, _k, value) => { saved = value; return saved } } }
  return createCommandConfigService(platform, () => "canal", { rankResolver })
}

test("un comando de superfan de TikTok no lo ejecuta un VIP de Twitch", () => {
  const { ranks } = setup()
  const service = commandConfig(event => ranks.getEventRanks(event))
  service.update("!puntos", { platform: "all", allowedRanks: ["tiktok:superfan"] })
  const twitchVip = { platform: "twitch", actor: { platformUserId: "1", username: "vipuser", isVip: true } }
  const decision = service.evaluate("!puntos", twitchVip)
  assert.equal(decision.allowed, false)
  assert.equal(decision.rankDenied, true)
})

test("habilitar explicitamente el VIP de Twitch le da acceso", () => {
  const { ranks } = setup()
  const service = commandConfig(event => ranks.getEventRanks(event))
  service.update("!puntos", { allowedRanks: ["tiktok:superfan", "twitch:vip"] })
  const twitchVip = { platform: "twitch", actor: { platformUserId: "1", username: "vipuser", isVip: true } }
  assert.equal(service.evaluate("!puntos", twitchVip).allowed, true)
})

test("un superfan de TikTok accede y un viewer normal no", () => {
  const { ranks, gifts } = setup()
  ranks.setSuperfanThreshold("tiktok", 100)
  gift(gifts, { coins: 100 })
  const service = commandConfig(event => ranks.getEventRanks(event))
  service.update("!daily", { platform: "tiktok", allowedRanks: ["tiktok:superfan"] })
  assert.equal(service.evaluate("!daily", tiktokEvent()).allowed, true)
  assert.equal(service.evaluate("!daily", tiktokEvent({ platformUserId: "1", username: "otro" })).rankDenied, true)
})

test("quien no tiene el rango no consume el cooldown", () => {
  const { ranks } = setup()
  const service = commandConfig(event => ranks.getEventRanks(event))
  service.update("!daily", { allowedRanks: ["tiktok:superfan"], cooldownSeconds: 60 })
  const outsider = tiktokEvent({ platformUserId: "1", username: "otro" })
  service.record("!daily", outsider)
  assert.equal(service.evaluate("!daily", outsider).rankDenied, true)
})

test("los rangos invalidos se descartan y sin rangos no hay filtro", () => {
  const service = commandConfig(() => [])
  const updated = service.update("!puntos", { allowedRanks: ["tiktok:superfan", "superfan", "x:y", 5] })
  assert.deepEqual(updated.allowedRanks, ["tiktok:superfan"])
  service.update("!puntos", { allowedRanks: [] })
  assert.equal(service.evaluate("!puntos", tiktokEvent()).allowed, true)
})

test("actualizar otros campos conserva los rangos permitidos", () => {
  const service = commandConfig(() => [])
  service.update("!puntos", { allowedRanks: ["tiktok:superfan"] })
  const updated = service.update("!puntos", { cooldownSeconds: 10 })
  assert.deepEqual(updated.allowedRanks, ["tiktok:superfan"])
})

test("el motor de comandos rechaza sin rango con un mensaje y acepta con rango", () => {
  const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
  const { ranks, gifts } = setup()
  ranks.setSuperfanThreshold("tiktok", 100)
  const config = commandConfig(event => ranks.getEventRanks(event))
  config.update("!puntos", { platform: "tiktok", allowedRanks: ["tiktok:superfan"] })

  const replies = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 7 }), getViewerFor: () => ({ points: 7 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    commandConfig: config,
  })
  const chat = (username, userId) => ({
    platform: "tiktok", type: "chat_message", metadata: {},
    actor: { platformUserId: userId, username, displayName: username },
    message: { text: "!puntos" },
  })

  engine.handle(chat("otro", "1"))
  assert.match(replies.at(-1), /solo para: Superfan de TikTok/)

  gift(gifts, { coins: 100, username: "luna", userId: "777" })
  engine.handle(chat("luna", "777"))
  assert.match(replies.at(-1), /7 puntos/)
})
