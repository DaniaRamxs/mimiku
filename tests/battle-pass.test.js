const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createBattlePass, MAX_LEVEL, DEFAULT_XP_PER_LEVEL, DEFAULT_PREMIUM_PRICE, PREMIUM_POINTS_PER_LEVEL } = require("../src/services/battle-pass.js")
const { createCardSleeves } = require("../src/services/card-sleeves.js")
const { createEffectsShop } = require("../src/services/effects-shop.js")
const { createCanjePass } = require("../src/services/canje-pass.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")

const DAY = 86_400_000

function setup({ points = 2_000_000, withPrizes = true } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-10-01T12:00:00Z") }
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "vlady", display: "Vlady" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: points, idempotencyKey: "seed", reason: "seed" })
  if (withPrizes) {
    platform.profiles.createCard("canal", { name: "Gato", rarity: "raro" })
    platform.profiles.createCard("canal", { name: "Hada", rarity: "epico" })
    platform.mimics.create("canal", { name: "Lluvia", icon: "~", rarity: "raro" })
    platform.mimics.create("canal", { name: "Fuegos", icon: "!", rarity: "epico" })
  }
  const getChannel = () => "canal"
  const pass = createBattlePass({ platform, getChannel, now: () => clock.t, random: () => 0 })
  const balance = () => platform.economy.getBalance("canal", viewer.id).balance
  const cards = () => platform.profiles.getCards("canal", viewer.id).reduce((sum, row) => sum + row.quantity, 0)
  return { db, platform, clock, viewer, pass, balance, cards, getChannel }
}

const levels = n => n * DEFAULT_XP_PER_LEVEL

test("sin temporada activa la experiencia no cuenta", () => {
  const { pass, viewer } = setup()
  assert.deepEqual(pass.addXp(viewer.id, 5000), { ok: false, reason: "no-season" })
  assert.equal(pass.state(viewer.id).active, false)
})

test("empezar temporada: nombre y semanas validos; solo una activa; termina sola", () => {
  const { pass, clock } = setup()
  assert.equal(pass.startSeason({ name: "", weeks: 5 }).reason, "bad-name")
  assert.equal(pass.startSeason({ name: "T1", weeks: 0 }).reason, "bad-weeks")
  assert.equal(pass.startSeason({ name: "Temporada 1", weeks: 5 }).ok, true)
  assert.equal(pass.startSeason({ name: "Temporada 2" }).reason, "season-active")
  clock.t += 5 * 7 * DAY
  assert.equal(pass.activeSeason(), null)
  assert.equal(pass.startSeason({ name: "Temporada 2" }).ok, true)
})

test("subir de nivel entrega los premios gratis una sola vez", () => {
  const { pass, viewer, balance, cards } = setup()
  pass.startSeason({ name: "T1" })
  const up = pass.addXp(viewer.id, levels(5))
  assert.equal(up.level, 5)
  assert.deepEqual(up.granted.map(item => item.level), [3, 5])
  assert.equal(balance(), 2_000_000 + 5000)
  assert.equal(cards(), 1, "nivel 5 gratis: personaje raro")
  assert.deepEqual(pass.addXp(viewer.id, 10).granted, [], "no repite premios")
})

test("premium a mitad de temporada entrega lo ya alcanzado; luego sigue entregando ambas pistas", () => {
  const { pass, viewer, balance, platform } = setup()
  pass.startSeason({ name: "T1" })
  pass.addXp(viewer.id, levels(4))
  const before = balance()
  const bought = pass.buyPremium(viewer.id, "premium-1")
  assert.equal(bought.ok, true)
  assert.deepEqual(bought.granted.map(item => item.level), [1, 2, 3, 4])
  assert.equal(balance(), before - DEFAULT_PREMIUM_PRICE + 4 * PREMIUM_POINTS_PER_LEVEL)
  assert.equal(pass.buyPremium(viewer.id, "premium-2").reason, "already-premium")
  const up = pass.addXp(viewer.id, levels(1))
  assert.deepEqual(up.granted.map(item => `${item.level}:${item.track}`), ["5:free", "5:premium"])
  assert.ok(createEffectsShop({ platform, getChannel: () => "canal", now: () => Date.parse("2026-10-01T12:00:00Z") }).isActive(viewer.id, "anti-robo"), "nivel 5 premium: inmunidad 1 h")
})

test("sin puntos no se compra el premium", () => {
  const { pass, viewer } = setup({ points: 1000 })
  pass.startSeason({ name: "T1" })
  assert.deepEqual(pass.buyPremium(viewer.id, "k"), { ok: false, reason: "insufficient" })
})

test("nivel 30 premium: funda prisma y 30 cofres de Streamloots pendientes hasta marcarlos", () => {
  const { pass, viewer, platform, getChannel } = setup()
  pass.startSeason({ name: "T1" })
  pass.buyPremium(viewer.id, "k")
  const up = pass.addXp(viewer.id, levels(MAX_LEVEL + 3))
  assert.equal(up.level, MAX_LEVEL)
  assert.equal(createCardSleeves({ platform, getChannel }).tokens(viewer.id).prisma, 1)
  const pending = pass.pendingDeliveries()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].viewer, "Vlady")
  assert.match(pending[0].items[0], /30 cofres de Streamloots/)
  const last = pass.state(viewer.id).levels[MAX_LEVEL - 1].premium
  assert.equal(last.pending, true)
  assert.equal(pass.markDelivered(pending[0]).ok, true)
  assert.equal(pass.pendingDeliveries().length, 0)
  assert.equal(pass.state(viewer.id).levels[MAX_LEVEL - 1].premium.pending, false)
  assert.equal(pass.markDelivered(pending[0]).reason, "gone")
})

test("si no hay personajes de la rareza del premio, da puntos a cambio", () => {
  const { pass, viewer, balance } = setup({ withPrizes: false })
  pass.startSeason({ name: "T1" })
  pass.addXp(viewer.id, levels(5))
  assert.equal(balance(), 2_000_000 + 5000 + 10000)
  const five = pass.state(viewer.id).levels[4].free
  assert.equal(five.items[0].type, "points")
})

test("temporada nueva: la experiencia vuelve a 0", () => {
  const { pass, viewer, clock } = setup()
  pass.startSeason({ name: "T1", weeks: 1 })
  pass.addXp(viewer.id, levels(10))
  clock.t += 7 * DAY
  pass.startSeason({ name: "T2" })
  assert.equal(pass.state(viewer.id).level, 0)
  assert.equal(pass.state(viewer.id).premium, false)
})

test("por la web: ver el pase, comprar premium sin cobrar dos veces y poner funda", async t => {
  const { platform, pass, viewer, balance, getChannel, clock } = setup()
  pass.startSeason({ name: "Temporada 1" })
  const card = platform.profiles.listCards("canal")[0]
  platform.profiles.grantCard("canal", viewer.id, card.id, 1, "g")
  createCardSleeves({ platform, getChannel }).grant(viewer.id, "rara", 1)
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, pass: createCanjePass({ platform, getChannel, now: () => clock.t }), sessions,
    validator: { validate: async () => null }, assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const token = sessions.issue({ twitchId: "111", login: "vlady" }).token
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, json: await response.json() }
  }
  const state = await call("/api/pass")
  assert.equal(state.json.season.name, "Temporada 1")
  assert.equal(state.json.levels.length, MAX_LEVEL)
  assert.equal(state.json.premiumPrice, DEFAULT_PREMIUM_PRICE)
  assert.equal(state.json.missions.list.length, 3)
  assert.equal((await call("/api/pass/mission", { missionId: state.json.missions.list[0].id })).json.error, "Todavía no has completado esa misión.")
  const bought = await call("/api/pass/premium", { key: "premium-web-1" })
  assert.equal(bought.status, 200)
  const retry = await call("/api/pass/premium", { key: "premium-web-1" })
  assert.deepEqual(retry.json, bought.json)
  assert.equal(balance(), 2_000_000 - DEFAULT_PREMIUM_PRICE)
  assert.equal((await call("/api/pass/premium", { key: "premium-web-2" })).json.error, "Ya tienes el pase premium de esta temporada.")
  const applied = await call("/api/sleeve/apply", { cardId: card.id, sleeve: "rara" })
  assert.equal(applied.status, 200)
  assert.equal(applied.json.sleeveName, "Funda rara")
  assert.equal((await call("/api/sleeve/apply", { cardId: card.id, sleeve: "rara" })).json.error, "Esa carta no tiene copias sin funda.")
})

// ── Misiones semanales ───────────────────────────────────────────────────────
const { missionsFor, weekStart, MISSIONS_PER_WEEK, DEFAULT_MISSION_XP } = require("../src/services/battle-pass.js")
const { createPlinko } = require("../src/services/plinko.js")

function missionSetup() {
  const base = setup()
  // Las acciones se anotan con la hora real: el pase tambien usa la hora real aqui.
  const pass = createBattlePass({ platform: base.platform, getChannel: base.getChannel, random: () => 0 })
  pass.startSeason({ name: "T1" })
  return { ...base, pass }
}

test("cada semana salen 3 misiones distintas, las mismas para todos", () => {
  const picked = missionsFor("temporada", "2026-09-28")
  assert.equal(picked.length, MISSIONS_PER_WEEK)
  assert.equal(new Set(picked.map(item => item.id)).size, MISSIONS_PER_WEEK)
  assert.deepEqual(missionsFor("temporada", "2026-09-28"), picked)
  const monday = new Date(weekStart(Date.parse("2026-10-01T12:00:00")))
  assert.equal(monday.getDay(), 1)
  assert.equal(monday.getHours(), 0)
})

test("la mision se completa con la actividad de la semana y se reclama una vez", () => {
  const { pass, viewer, platform } = missionSetup()
  const [first, second] = pass.missions(viewer.id).list
  assert.equal(first.progress, 0)
  assert.equal(pass.claimMission(viewer.id, first.id).reason, "mission-pending")
  const action = require("../src/services/battle-pass.js").MISSION_POOL.find(item => item.id === first.id).action
  platform.activity.record("canal", viewer.id, action, first.target + 5)
  const done = pass.missions(viewer.id).list[0]
  assert.equal(done.progress, first.target, "el progreso no pasa del objetivo")
  assert.equal(done.done, true)
  const xpBefore = pass.state(viewer.id).xp
  const claimed = pass.claimMission(viewer.id, first.id)
  assert.equal(claimed.ok, true)
  assert.equal(claimed.xp, DEFAULT_MISSION_XP)
  assert.equal(pass.state(viewer.id).xp, xpBefore + DEFAULT_MISSION_XP)
  assert.equal(pass.claimMission(viewer.id, first.id).reason, "mission-claimed")
  assert.equal(pass.missions(viewer.id).list[0].claimed, true)
  assert.equal(pass.claimMission(viewer.id, "no-existe").reason, "no-mission")
  assert.equal(pass.missions(viewer.id).list[1].progress, second.progress)
})

test("lo hecho antes de empezar la temporada no cuenta", () => {
  const { pass, viewer, platform } = missionSetup()
  const first = pass.missions(viewer.id).list[0]
  const action = require("../src/services/battle-pass.js").MISSION_POOL.find(item => item.id === first.id).action
  platform.activity.record("canal", viewer.id, action, 999, new Date(Date.now() - 60_000).toISOString())
  assert.equal(pass.missions(viewer.id).list[0].progress, 0)
})

test("los mensajes del chat, el tiempo viendo y el Plinko se anotan para las misiones", () => {
  const { pass, viewer, platform, getChannel } = missionSetup()
  const from = new Date(Date.now() - 1000).toISOString()
  const to = new Date(Date.now() + 60_000).toISOString()
  pass.addXp(viewer.id, 5, "mensaje")
  pass.addXp(viewer.id, 5, "mensaje")
  pass.addXp(viewer.id, 10, "tiempo")
  pass.addXp(viewer.id, 500, "mision")
  createPlinko({ platform, getChannel, random: () => 0 }).play(viewer.id, "bola-1")
  assert.equal(platform.activity.total("canal", viewer.id, "chat", from, to), 2)
  assert.equal(platform.activity.total("canal", viewer.id, "watch", from, to), 5)
  assert.equal(platform.activity.total("canal", viewer.id, "plinko", from, to), 1)
})

test("renovar misiones: solo con las 3 reclamadas, cobra, trae otras nuevas desde cero y tiene tope semanal", () => {
  const { pass, viewer, platform, balance } = missionSetup()
  const { MISSION_POOL, DEFAULT_REROLL_PRICE, MAX_REROLLS_PER_WEEK } = require("../src/services/battle-pass.js")
  const actionOf = id => MISSION_POOL.find(item => item.id === id).action
  const completeAll = () => {
    for (const mission of pass.missions(viewer.id).list) {
      platform.activity.record("canal", viewer.id, actionOf(mission.id), mission.target)
      assert.equal(pass.claimMission(viewer.id, mission.id).ok, true)
    }
  }
  assert.equal(pass.rerollMissions(viewer.id, "r0").reason, "missions-open")
  completeAll()
  assert.equal(pass.missions(viewer.id).reroll.available, true)
  const before = balance()
  const renewed = pass.rerollMissions(viewer.id, "r1")
  assert.equal(renewed.ok, true)
  assert.equal(balance(), before - DEFAULT_REROLL_PRICE)
  assert.ok(renewed.missions.list.every(item => !item.claimed && item.progress === 0), "las nuevas empiezan en 0")
  for (let i = 1; i < MAX_REROLLS_PER_WEEK; i++) { completeAll(); assert.equal(pass.rerollMissions(viewer.id, `r${i + 1}`).ok, true) }
  completeAll()
  assert.equal(pass.rerollMissions(viewer.id, "r-extra").reason, "no-rerolls")
})
