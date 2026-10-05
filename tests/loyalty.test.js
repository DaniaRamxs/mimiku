const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createLoyaltyService, weekKey, normalizeConfig } = require("../src/services/loyalty.js")
const { createTwitchLiveStatus } = require("../src/services/twitch-live-status.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const { createCommandConfigService } = require("../src/services/command-config.js")

const HOUR = 3_600_000

function memoryModeration(platform) {
  const store = new Map()
  platform.moderation.getConfig = (_channel, key) => store.get(key)
  platform.moderation.setConfig = (_channel, key, value) => { store.set(key, value); return value }
}

// Miercoles 16 sep 2026, 12:00 hora local.
function setup({ startDate = new Date(2026, 8, 16, 12, 0, 0) } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  memoryModeration(platform)
  const clock = { current: startDate }
  const live = { value: null }
  const service = createLoyaltyService({
    platform, getChannel: () => "canal", now: () => clock.current, liveStatus: () => live.value,
  })
  const advance = ms => { clock.current = new Date(clock.current.getTime() + ms) }
  return { db, platform, service, clock, live, advance }
}

function luna(overrides = {}) {
  return { platform: "twitch", platformUserId: "42", username: "luna", displayName: "Luna", ...overrides }
}

function pointsOf(platform, identity) {
  const viewer = platform.identities.resolve({ platform: identity.platform, platformUserId: identity.platformUserId, username: identity.username })
  return platform.economy.getBalance("canal", viewer.id).balance
}

test("la migracion v6 crea las tablas de la tarjeta y es idempotente", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  applyMigrations(db)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name)
  for (const name of ["loyalty_streams", "loyalty_claims", "loyalty_completions"]) assert.ok(tables.includes(name))
})

test("la semana empieza el lunes en hora local", () => {
  assert.equal(weekKey(new Date(2026, 8, 16, 12)), "2026-09-14")
  assert.equal(weekKey(new Date(2026, 8, 14, 0, 0, 1)), "2026-09-14")
  assert.equal(weekKey(new Date(2026, 8, 20, 23, 59)), "2026-09-14")
  assert.equal(weekKey(new Date(2026, 8, 21, 0, 0, 1)), "2026-09-21")
})

test("la configuracion por defecto da 20.000 puntos y limita valores fuera de rango", () => {
  const config = normalizeConfig({})
  assert.equal(config.rewardPoints, 100000)
  assert.equal(config.enabled, true)
  assert.equal(normalizeConfig({ stamps: 99 }).stamps, 14)
  assert.equal(normalizeConfig({ stamps: 0 }).stamps, 2)
  assert.equal(normalizeConfig({ position: "javascript:" }).position, "bottom-right")
  assert.equal(normalizeConfig({ theme: "otro" }).theme, "noche")
})

test("el primer !claim sella 1 y prepara la tarjeta para el overlay", () => {
  const { service } = setup()
  const result = service.claim(luna({ avatarUrl: "https://example.com/a.png" }))
  assert.equal(result.ok, true)
  assert.equal(result.filled, 1)
  assert.equal(result.total, 10)
  assert.equal(result.completed, false)
  assert.equal(result.overlay.type, "loyalty_card")
  assert.equal(result.overlay.user, "Luna")
  assert.equal(result.overlay.justStamped, 1)
  assert.equal(result.overlay.week, "2026-09-14")
})

test("solo un sello por directo", () => {
  const { service, advance } = setup()
  assert.equal(service.claim(luna()).ok, true)
  advance(30 * 60_000)
  const again = service.claim(luna())
  assert.deepEqual({ ok: again.ok, reason: again.reason, filled: again.filled }, { ok: false, reason: "already", filled: 1 })
})

test("otro viewer en el mismo directo tiene su propia tarjeta", () => {
  const { service } = setup()
  service.claim(luna())
  const other = service.claim(luna({ platformUserId: "43", username: "sol", displayName: "Sol" }))
  assert.equal(other.ok, true)
  assert.equal(other.filled, 1)
})

test("sin Twitch, tras el hueco sin chat empieza un directo nuevo", () => {
  const { service, advance } = setup()
  service.claim(luna())
  advance(4 * HOUR)
  const second = service.claim(luna())
  assert.equal(second.ok, true)
  assert.equal(second.filled, 2)
})

test("la actividad del chat mantiene abierto el directo actual", () => {
  const { service, advance } = setup()
  service.claim(luna())
  advance(2 * HOUR)
  service.noteActivity()
  advance(2 * HOUR)
  assert.equal(service.claim(luna()).reason, "already")
})

test("con Twitch en vivo, cada stream de Twitch es un directo distinto aunque sea el mismo dia", () => {
  const { service, live, advance } = setup()
  live.value = { live: true, streamId: "A", startedAt: new Date(2026, 8, 16, 11).toISOString() }
  assert.equal(service.claim(luna()).filled, 1)
  advance(10 * 60_000)
  assert.equal(service.claim(luna()).reason, "already")
  // Segundo directo del dia, solo 1 hora despues: el hueco no bastaria, el id si.
  advance(HOUR)
  live.value = { live: true, streamId: "B", startedAt: new Date(2026, 8, 16, 13, 10).toISOString() }
  assert.equal(service.claim(luna()).filled, 2)
  assert.equal(service.status().stream.source, "twitch")
})

test("empezar un directo a mano permite volver a sellar", () => {
  const { service, advance } = setup()
  service.claim(luna())
  advance(60_000)
  service.startNewStream()
  advance(60_000)
  assert.equal(service.claim(luna()).filled, 2)
})

test("un directo iniciado a mano gana sobre el stream de Twitch que ya estaba en curso", () => {
  const { service, live, advance } = setup()
  live.value = { live: true, streamId: "A", startedAt: new Date(2026, 8, 16, 11).toISOString() }
  service.claim(luna())
  advance(60_000)
  service.startNewStream()
  advance(60_000)
  assert.equal(service.claim(luna()).filled, 2)
})

test("al completar la tarjeta entrega los puntos una sola vez", () => {
  const { service, platform, advance } = setup()
  service.setConfig({ stamps: 2 })
  service.claim(luna())
  advance(4 * HOUR)
  const done = service.claim(luna())
  assert.equal(done.completed, true)
  assert.equal(done.rewardPoints, 100000)
  assert.equal(done.overlay.completed, true)
  assert.equal(pointsOf(platform, luna()), 100000)

  advance(4 * HOUR)
  const after = service.claim(luna())
  assert.equal(after.reason, "completed")
  assert.equal(pointsOf(platform, luna()), 100000)
  assert.equal(service.status().completions.length, 1)
  assert.equal(service.status().completions[0].displayName, "Luna")
})

test("el lunes empieza una tarjeta nueva", () => {
  const { service, clock } = setup()
  service.claim(luna())
  clock.current = new Date(2026, 8, 21, 10, 0, 0)
  const monday = service.claim(luna())
  assert.equal(monday.filled, 1)
  assert.equal(monday.overlay.week, "2026-09-21")
})

test("con la tarjeta desactivada no se sella nada", () => {
  const { service, db } = setup()
  service.setConfig({ enabled: false })
  assert.equal(service.claim(luna()).reason, "disabled")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM loyalty_claims").get().n, 0)
})

test("el streamer marca que ya entrego el premio extra", () => {
  const { service, advance } = setup()
  service.setConfig({ stamps: 2 })
  service.claim(luna())
  advance(4 * HOUR)
  service.claim(luna())
  const [row] = service.status().completions
  assert.equal(row.deliveredAt, null)
  assert.ok(service.setDelivered(row.id, true).completions[0].deliveredAt)
  assert.equal(service.setDelivered(row.id, false).completions[0].deliveredAt, null)
  assert.throws(() => service.setDelivered("no-existe", true), /no encontrada/)
})

test("la vista previa no guarda sellos", () => {
  const { service, db } = setup()
  const preview = service.preview({ completed: true })
  assert.equal(preview.completed, true)
  assert.equal(preview.filled, preview.total)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM loyalty_claims").get().n, 0)
})

test("si falla el dato de Twitch se usa el modo por actividad", () => {
  const { db, platform, clock } = setup()
  const service = createLoyaltyService({
    platform, getChannel: () => "canal", now: () => clock.current, liveStatus: () => { throw new Error("red") },
  })
  assert.equal(service.claim(luna()).ok, true)
  assert.equal(db.prepare("SELECT source FROM loyalty_streams").get().source, "auto")
})

// ── Estado en vivo de Twitch ─────────────────────────────────────────────────
function fakeFetch(routes) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers })
    const route = routes.find(item => url.startsWith(item.prefix))
    if (!route) throw new Error("sin ruta")
    return { ok: route.status === undefined || route.status < 400, status: route.status || 200, json: async () => route.body }
  }
  return { calls, fetchImpl }
}

test("twitch-live-status lee el id del stream en vivo con el token del chat", async () => {
  const { calls, fetchImpl } = fakeFetch([
    { prefix: "https://id.twitch.tv/oauth2/validate", body: { client_id: "cid" } },
    { prefix: "https://api.twitch.tv/helix/streams", body: { data: [{ id: "123", started_at: "2026-09-16T10:00:00Z" }] } },
  ])
  const status = createTwitchLiveStatus({ getToken: () => "oauth:abc", getChannel: () => "MiCanal", fetchImpl, now: () => 1000 })
  const state = await status.check()
  assert.deepEqual({ live: state.live, streamId: state.streamId }, { live: true, streamId: "123" })
  assert.equal(calls[0].headers.Authorization, "OAuth abc")
  assert.match(calls[1].url, /user_login=micanal$/)
  assert.equal(calls[1].headers["Client-Id"], "cid")
  assert.equal(status.get().streamId, "123")
})

test("twitch-live-status: canal offline, sin token o con error", async () => {
  const offline = fakeFetch([
    { prefix: "https://id.twitch.tv", body: { client_id: "cid" } },
    { prefix: "https://api.twitch.tv", body: { data: [] } },
  ])
  const status = createTwitchLiveStatus({ getToken: () => "abc", getChannel: () => "canal", fetchImpl: offline.fetchImpl })
  assert.equal((await status.check()).live, false)

  const noToken = createTwitchLiveStatus({ getToken: () => "", getChannel: () => "canal", fetchImpl: offline.fetchImpl })
  assert.equal(await noToken.check(), null)

  const warnings = []
  const failing = fakeFetch([{ prefix: "https://id.twitch.tv", status: 401, body: {} }])
  const broken = createTwitchLiveStatus({
    getToken: () => "abc", getChannel: () => "canal", fetchImpl: failing.fetchImpl, log: { warn: (...args) => warnings.push(args) },
  })
  assert.equal(await broken.check(), null)
  await broken.check()
  assert.equal(warnings.length, 1)
})

test("twitch-live-status descarta un dato viejo", async () => {
  const { fetchImpl } = fakeFetch([
    { prefix: "https://id.twitch.tv", body: { client_id: "cid" } },
    { prefix: "https://api.twitch.tv", body: { data: [{ id: "1", started_at: "2026-09-16T10:00:00Z" }] } },
  ])
  let current = 0
  const status = createTwitchLiveStatus({ getToken: () => "abc", getChannel: () => "canal", fetchImpl, now: () => current })
  await status.check()
  current = 10 * 60_000
  assert.equal(status.get(), null)
})

// ── Integracion con el motor de comandos ────────────────────────────────────
function engineWith({ loyalty, commandConfig }) {
  const replies = []
  const overlays = []
  const notices = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    overlay: payload => overlays.push(payload),
    notify: (channel, payload) => notices.push({ channel, payload }),
    loyalty, commandConfig,
  })
  return { engine, replies, overlays, notices }
}

function chat(text, overrides = {}) {
  return {
    platform: "twitch", type: "chat_message", metadata: { channel: "canal" },
    actor: { platformUserId: "42", username: "luna", displayName: "Luna", ...overrides },
    message: { text },
  }
}

test("!claim muestra la tarjeta, responde el progreso y avisa al panel", () => {
  const { service } = setup()
  const { engine, replies, overlays, notices } = engineWith({ loyalty: service })
  engine.handle(chat("!claim"))
  assert.equal(overlays[0].type, "loyalty_card")
  assert.match(replies[0], /1\/10/)
  assert.equal(notices.at(-1).channel, "loyalty:update")

  engine.handle(chat("!claim"))
  assert.equal(overlays.length, 1)
  assert.match(replies[1], /ya sellaste tu tarjeta en este directo/)
})

test("!claim al completar anuncia los puntos y despues indica que se renueva el lunes", () => {
  const { service, advance } = setup()
  service.setConfig({ stamps: 2 })
  const { engine, replies } = engineWith({ loyalty: service })
  engine.handle(chat("!claim"))
  advance(4 * HOUR)
  engine.handle(chat("!claim"))
  assert.match(replies[1], /completó su tarjeta de fidelidad semanal y ganó 100[.,]000 puntos/)
  advance(4 * HOUR)
  engine.handle(chat("!claim"))
  assert.match(replies[2], /se renueva el lunes/i)
})

test("!claim es de Twitch por defecto: en TikTok no hace nada", () => {
  const { service } = setup()
  let saved = null
  const moderation = { moderation: { getConfig: () => saved, setConfig: (_c, _k, value) => { saved = value; return saved } } }
  const commandConfig = createCommandConfigService(moderation, () => "canal")
  const { engine, overlays } = engineWith({ loyalty: service, commandConfig })
  engine.handle({ ...chat("!claim"), platform: "tiktok" })
  assert.equal(overlays.length, 0)
  engine.handle(chat("!claim"))
  assert.equal(overlays.length, 1)
})
