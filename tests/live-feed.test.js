const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createLiveFeed, MAX_EVENTS } = require("../src/services/live-feed.js")
const { createCanjeGames } = require("../src/services/canje-games.js")
const { createCanjeLive } = require("../src/services/canje-live.js")
const { createGachaponService } = require("../src/services/gachapon.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")

function setup({ random = () => 0.5 } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: 100000, idempotencyKey: "seed", reason: "seed" })
  for (const [name, rarity] of [["Gato", "comun"], ["Buho", "comun"], ["Robot", "raro"], ["Hada", "epico"], ["Dragon", "legendario"]]) {
    platform.profiles.createCard("canal", { name, rarity })
  }
  const getChannel = () => "canal"
  const feed = createLiveFeed()
  const games = createCanjeGames({ platform, getChannel, feed, random })
  return { db, platform, viewer, feed, games, getChannel }
}

test("el tablon guarda los ultimos eventos, da solo lo nuevo y marca los propios", () => {
  const feed = createLiveFeed({ now: () => 1000 })
  feed.record("canal", { game: "wheel", viewerId: "a", who: "Ana", label: "x2", net: 2000, outcome: "win" })
  feed.record("canal", { game: "slots", viewerId: "b", who: "Beto", label: "Sin premio", net: -300, outcome: "lose" })
  feed.record("canal", { game: "inventado", who: "X" })
  const all = feed.list("canal", { viewerId: "a" })
  assert.equal(all.last, 2)
  assert.deepEqual(all.events.map(event => [event.who, event.mine, event.net]), [["Ana", true, 2000], ["Beto", false, -300]])
  assert.equal(all.events[0].viewerId, undefined, "el id interno del viewer no sale")
  assert.deepEqual(feed.list("canal", { since: 1 }).events.map(event => event.who), ["Beto"])
  assert.deepEqual(feed.list("otro").events, [])
  for (let i = 0; i < MAX_EVENTS + 5; i++) feed.record("canal", { game: "wheel", who: "N" + i })
  assert.equal(feed.list("canal").events.length <= 40, true)
})

test("cada jugada de los minijuegos se apunta con lo ganado o perdido", () => {
  const { games, feed, viewer } = setup()
  const before = feed.list("canal").last
  const scratch = games.scratch("111", "rasca-0001")
  assert.equal(scratch.ok, true)
  const wheel = games.wheel("111", "ruleta-0001")
  assert.equal(wheel.ok, true)
  const events = feed.list("canal", { since: before, viewerId: viewer.id }).events
  assert.deepEqual(events.map(event => event.game), ["scratch", "wheel"])
  assert.equal(events[0].who, "Luna")
  assert.equal(events[0].mine, true)
  assert.ok(events.every(event => ["win", "lose", "even"].includes(event.outcome)))
  // El reintento de la misma jugada (misma clave) no se apunta dos veces.
  games.scratch("111", "rasca-0001")
  assert.equal(feed.list("canal", { since: before }).events.length, 2)
})

test("alta o baja: solo se apunta el final (perder o cobrar), no el reparto", () => {
  const { games, feed } = setup()
  const start = games.hiloStart("111", "hilo-00001", 1000)
  assert.equal(start.ok, true)
  assert.equal(feed.list("canal").events.length, 0)
  const cash = games.hiloCashout("111", start.game.id)
  assert.equal(cash.ok, true)
  const [event] = feed.list("canal").events
  assert.equal(event.game, "hilo")
  assert.equal(event.label, "Cobró x1.00")
  assert.equal(event.net, 0)
  assert.equal(event.outcome, "even")
})

test("gachapon: cada tirada se apunta y un x10 una sola vez con su mejor carta", () => {
  const { platform, feed, getChannel } = setup()
  const gacha = createGachaponService({ platform, getChannel, feed, random: () => 0.99, log: { error() {} } })
  gacha.setConfig({ price: 10 })
  const identity = { platform: "twitch", platformUserId: "111", username: "luna", displayName: "Luna" }
  gacha.pull(identity, "uno")
  gacha.pullMany(identity, 10, "diez")
  const events = feed.list("canal").events
  assert.equal(events.length, 2)
  assert.deepEqual(events.map(event => [event.game, event.label, event.rarity, event.count, event.big]), [
    ["gacha", "Dragon", "legendario", 1, true],
    ["gacha", "Dragon", "legendario", 10, true],
  ])
})

test("por la web: /api/live pide sesion y devuelve lo nuevo con la hora del servidor", async t => {
  const { platform, getChannel, feed, games } = setup()
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, games, live: createCanjeLive({ platform, getChannel, feed }), sessions,
    validator: { validate: async () => null }, assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const token = sessions.issue({ twitchId: "111", login: "luna" }).token
  const get = (route, auth = true) => fetch(`http://127.0.0.1:${port}${route}`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} })
  assert.equal((await get("/api/live", false)).status, 401)
  feed.record("canal", { game: "wheel", viewerId: "otro", who: "Zorro", label: "x3", net: 3000, outcome: "win" })
  games.scratch("111", "rasca-web")
  const first = await (await get("/api/live")).json()
  assert.equal(typeof first.now, "number")
  assert.deepEqual(first.events.map(event => [event.who, event.mine]), [["Zorro", false], ["Luna", true]])
  const none = await (await get(`/api/live?since=${first.last}`)).json()
  assert.deepEqual(none.events, [])
})

// ── Robar desde el aviso en vivo ───────────────────────────────────────────────
const { createStealPermission } = require("../src/services/canje-live.js")
const { createSeenBadges } = require("../src/services/seen-badges.js")
const { createEffectsShop } = require("../src/services/effects-shop.js")

async function setupSteal(t, { canSteal } = {}) {
  const base = setup()
  const { platform, getChannel, feed } = base
  const zorro = platform.identities.resolve({ platform: "twitch", platformUserId: "222", username: "zorro", display: "Zorro" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: zorro.id, balanceDelta: 200000, idempotencyKey: "seed-z", reason: "seed" })
  const gacha = createGachaponService({ platform, getChannel, feed, random: () => 0.99, log: { error() {} } })
  gacha.setConfig({ price: 10 })
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, live: createCanjeLive({ platform, getChannel, feed, gachapon: gacha, canSteal }), sessions,
    validator: { validate: async () => null }, assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const token = sessions.issue({ twitchId: "111", login: "luna" }).token
  const steal = async eventId => {
    const response = await fetch(`http://127.0.0.1:${port}/api/live/steal`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ eventId }),
    })
    return { status: response.status, json: await response.json() }
  }
  const zorroIdentity = { platform: "twitch", platformUserId: "222", username: "zorro", displayName: "Zorro" }
  const cards = viewer => platform.profiles.getCards("canal", viewer.id).filter(row => row.quantity > 0).map(row => row.name)
  return { ...base, zorro, gacha, steal, zorroIdentity, cards }
}

test("robar desde la web: se lleva la carta y el tablon anuncia el robo a todos", async t => {
  const { gacha, steal, zorroIdentity, feed, zorro, viewer, cards } = await setupSteal(t)
  gacha.pull(zorroIdentity, "zorro-tira")
  const [pull] = feed.list("canal").events
  assert.ok(pull.stealUntil > Date.now(), "la tirada trae su ventana de robo")
  assert.equal(pull.shielded, false)
  const robbed = await steal(pull.id)
  assert.equal(robbed.status, 200)
  assert.equal(robbed.json.prize.name, "Dragon")
  assert.deepEqual(cards(zorro), [])
  assert.deepEqual(cards(viewer), ["Dragon"])
  const forZorro = feed.list("canal", { since: pull.id, viewerId: zorro.id }).events
  assert.deepEqual(forZorro.map(event => [event.kind, event.ref, event.who, event.owner, event.ownerMine]), [["steal", pull.id, "Luna", "Zorro", true]])
  // Un segundo intento inmediato lo frena el limite; pasado ese rato, ya no queda nada que robar.
  assert.equal((await steal(pull.id)).status, 429)
  const luna = { platform: "twitch", platformUserId: "111", username: "luna", displayName: "Luna" }
  assert.equal(gacha.steal(luna, { feedId: pull.id }).reason, "gone")
})

test("con inmunidad no se puede robar y el aviso lo indica", async t => {
  const { gacha, steal, zorroIdentity, feed, platform, getChannel, zorro } = await setupSteal(t)
  assert.equal(createEffectsShop({ platform, getChannel }).buy(zorro.id, "anti-robo", "escudo-1").ok, true)
  gacha.pull(zorroIdentity, "zorro-escudo")
  const [pull] = feed.list("canal").events
  assert.equal(pull.shielded, true)
  assert.equal(pull.stealUntil, 0)
  const tried = await steal(pull.id)
  assert.equal(tried.status, 409)
})

test("un robo hecho con !robarpj en el chat tambien sale en el tablon", async t => {
  const { gacha, zorroIdentity, feed } = await setupSteal(t)
  gacha.pull(zorroIdentity, "zorro-chat")
  const thief = { platform: "twitch", platformUserId: "111", username: "luna", displayName: "Luna" }
  assert.equal(gacha.steal(thief).ok, true)
  const events = feed.list("canal").events
  assert.equal(events[1].kind, "steal")
  assert.equal(events[1].ref, events[0].id)
})

test("sin permiso (rango) la web no deja robar, con el mismo mensaje que !robarpj", async t => {
  const { gacha, steal, zorroIdentity, feed } = await setupSteal(t, { canSteal: () => ({ ok: false, reason: "rank" }) })
  gacha.pull(zorroIdentity, "zorro-rango")
  const [pull] = feed.list("canal").events
  const tried = await steal(pull.id)
  assert.equal(tried.status, 409)
  assert.match(tried.json.error, /VIP/)
})

test("el permiso usa las insignias vistas en el chat y el sub verificado", () => {
  const badges = createSeenBadges()
  const seenEvents = []
  const evaluate = (command, event) => {
    seenEvents.push(event)
    const ok = event.actor.isVip || event.actor.isModerator || event.actor.isSubscriber
    return ok ? { allowed: true } : { allowed: false, rankDenied: true }
  }
  const viewer = { id: "v1", platform_user_id: "333", username: "neo", display: "Neo" }
  let sub = false
  const canSteal = createStealPermission({ evaluate, badges, isSub: () => sub })
  assert.deepEqual(canSteal(viewer), { ok: false, reason: "rank" })
  badges.remember({ platform: "twitch", actor: { platformUserId: "333", isVip: true } })
  assert.deepEqual(canSteal(viewer), { ok: true })
  assert.equal(seenEvents.at(-1).actor.isVip, true)
  const other = { ...viewer, platform_user_id: "444" }
  sub = true
  assert.deepEqual(canSteal(other), { ok: true }, "sub verificado con el Pase Sub")
  assert.equal(seenEvents[0].platform, "twitch")
})

// ── Plinko: personajes legendarios robables solo desde la web ──────────────────
function setupPlinkoSteal() {
  const base = setup({ random: () => 0.999 })
  const { platform, getChannel, feed } = base
  const zorro = platform.identities.resolve({ platform: "twitch", platformUserId: "222", username: "zorro", display: "Zorro" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: zorro.id, balanceDelta: 200000, idempotencyKey: "seed-z", reason: "seed" })
  const gacha = createGachaponService({ platform, getChannel, feed, log: { error() {} } })
  const games = createCanjeGames({ platform, getChannel, feed, gachapon: gacha, random: () => 0.999 })
  const luna = { platform: "twitch", platformUserId: "111", username: "luna", displayName: "Luna" }
  const has = (viewer, name) => platform.profiles.getCards("canal", viewer.id).some(row => row.name === name && row.quantity > 0)
  return { ...base, zorro, gacha, games, luna, has }
}

test("plinko: el personaje legendario se puede robar desde la web pero no con !robarpj", () => {
  const { games, gacha, feed, luna, zorro, viewer, has } = setupPlinkoSteal()
  assert.equal(games.playPlinko("222", "plinko-zorro-1", 1).ok, true)
  const event = feed.list("canal").events.at(-1)
  assert.equal(event.game, "plinko")
  assert.equal(event.item, "Dragon")
  assert.ok(event.stealUntil > Date.now())
  assert.equal(gacha.steal(luna).reason, "none", "!robarpj no ve los premios de Plinko")
  assert.equal(has(zorro, "Dragon"), true)
  const robbed = gacha.steal(luna, { feedId: event.id })
  assert.equal(robbed.ok, true)
  assert.equal(has(zorro, "Dragon"), false)
  assert.equal(has(viewer, "Dragon"), true)
  assert.equal(feed.list("canal", { since: event.id }).events[0].kind, "steal")
})

test("plinko: con inmunidad el personaje legendario no se puede robar", () => {
  const { games, feed, platform, getChannel, zorro } = setupPlinkoSteal()
  assert.equal(createEffectsShop({ platform, getChannel }).buy(zorro.id, "anti-robo", "escudo-plinko").ok, true)
  assert.equal(games.playPlinko("222", "plinko-zorro-2", 1).ok, true)
  const event = feed.list("canal").events.at(-1)
  assert.equal(event.shielded, true)
  assert.equal(event.stealUntil, 0)
})
