const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEffectsShop, ITEMS } = require("../src/services/effects-shop.js")
const { createCanjeEffects } = require("../src/services/canje-effects.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")
const { createGachaponService, STEAL_WINDOW_MS } = require("../src/services/gachapon.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const { createCommandConfigService } = require("../src/services/command-config.js")
const { createPlinko } = require("../src/services/plinko.js")

const MINUTE = 60_000
const LUNA = { platform: "twitch", platformUserId: "111", username: "luna", displayName: "Luna" }
const ZORRO = { platform: "twitch", platformUserId: "222", username: "zorro", displayName: "Zorro" }

function setup({ points = 200_000 } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-09-30T12:00:00Z") }
  const person = identity => {
    const row = platform.identities.resolve({ platform: identity.platform, platformUserId: identity.platformUserId, username: identity.username, display: identity.displayName })
    platform.economy.applyMovement({ channelId: "canal", viewerId: row.id, balanceDelta: points, idempotencyKey: `seed-${row.id}`, reason: "seed" })
    return row
  }
  const luna = person(LUNA)
  const zorro = person(ZORRO)
  const shop = createEffectsShop({ platform, getChannel: () => "canal", now: () => clock.t })
  const balance = viewer => platform.economy.getBalance("canal", viewer.id).balance
  return { platform, clock, luna, zorro, shop, balance }
}

test("catalogo: inmunidad a robos (50000, 15 min) y fundas rara y epica", () => {
  const { shop, luna } = setup()
  const catalog = shop.catalog(luna.id)
  assert.deepEqual(catalog[0], {
    id: "anti-robo", kind: "effect", name: ITEMS["anti-robo"].name, description: ITEMS["anti-robo"].description,
    price: 50000, fullPrice: 50000, minutes: 15, remainingMs: 0,
  })
  assert.deepEqual(catalog.slice(1).map(item => [item.id, item.kind, item.sleeve, item.price, item.owned]), [
    ["funda-rara", "sleeve", "rara", 20000, 0], ["funda-epica", "sleeve", "epica", 75000, 0],
  ])
})

test("comprar una funda la guarda sin poner", () => {
  const { shop, luna, balance } = setup()
  const bought = shop.buy(luna.id, "funda-epica", "k1")
  assert.equal(bought.ok, true)
  assert.equal(bought.owned, 1)
  assert.equal(balance(luna), 200_000 - 75000)
  assert.equal(shop.catalog(luna.id).find(item => item.id === "funda-epica").owned, 1)
})

test("comprar cobra, activa 15 minutos y caduca", () => {
  const { shop, luna, clock, balance } = setup()
  const bought = shop.buy(luna.id, "anti-robo", "k1")
  assert.equal(bought.ok, true)
  assert.equal(balance(luna), 150_000)
  assert.equal(shop.remainingMs(luna.id, "anti-robo"), 15 * MINUTE)
  clock.t += 15 * MINUTE - 1
  assert.equal(shop.isActive(luna.id, "anti-robo"), true)
  clock.t += 1
  assert.equal(shop.isActive(luna.id, "anti-robo"), false)
})

test("comprar con el efecto activo suma el tiempo", () => {
  const { shop, luna, clock } = setup()
  shop.buy(luna.id, "anti-robo", "k1")
  clock.t += 5 * MINUTE
  shop.buy(luna.id, "anti-robo", "k2")
  assert.equal(shop.remainingMs(luna.id, "anti-robo"), 25 * MINUTE)
})

test("sin puntos no cobra ni activa; efecto desconocido o desactivado no se vende", () => {
  const { shop, luna, balance } = setup({ points: 100 })
  assert.deepEqual(shop.buy(luna.id, "anti-robo", "k1"), { ok: false, reason: "insufficient" })
  assert.equal(balance(luna), 100)
  assert.equal(shop.isActive(luna.id, "anti-robo"), false)
  assert.deepEqual(shop.buy(luna.id, "volar", "k2"), { ok: false, reason: "not-for-sale" })
  shop.setConfig({ "anti-robo": { enabled: false } })
  assert.equal(shop.catalog(luna.id).some(item => item.id === "anti-robo"), false)
  assert.deepEqual(shop.buy(luna.id, "anti-robo", "k3"), { ok: false, reason: "not-for-sale" })
})

test("precio y duracion editables; valores invalidos se rechazan", () => {
  const { shop } = setup()
  assert.deepEqual(shop.setConfig({ "anti-robo": { price: 80000, minutes: 30 } })["anti-robo"], { price: 80000, enabled: true, minutes: 30 })
  assert.throws(() => shop.setConfig({ "anti-robo": { price: 0 } }))
  assert.throws(() => shop.setConfig({ "anti-robo": { minutes: 2000 } }))
})

// ── Inmunidad en el gachapon ─────────────────────────────────────────────────
function gachaSetup() {
  const base = setup()
  base.platform.profiles.createCard("canal", { name: "Gatito", rarity: "comun" })
  const gacha = createGachaponService({ platform: base.platform, getChannel: () => "canal", now: () => base.clock.t, random: () => 0, log: { error() {} } })
  const cards = viewer => base.platform.profiles.getCards("canal", viewer.id).reduce((sum, row) => sum + row.quantity, 0)
  return { ...base, gacha, cards }
}

test("con inmunidad, la tirada no se puede robar", () => {
  const { shop, gacha, luna, zorro, cards } = gachaSetup()
  shop.buy(luna.id, "anti-robo", "k1")
  const pulled = gacha.pull(LUNA, "p1")
  assert.equal(pulled.shielded, true)
  assert.equal(pulled.stealSeconds, 0)
  assert.equal(gacha.steal(ZORRO).reason, "none")
  assert.equal(cards(luna), 1)
  assert.equal(cards(zorro), 0)
})

test("comprar la inmunidad justo despues de tirar tambien protege esa tirada", () => {
  const { shop, gacha, luna, zorro, cards, clock } = gachaSetup()
  gacha.pull(LUNA, "p1")
  shop.buy(luna.id, "anti-robo", "k1")
  clock.t += STEAL_WINDOW_MS / 2
  assert.deepEqual(gacha.steal(ZORRO), { ok: false, reason: "shielded", owner: "Luna" })
  assert.equal(cards(luna), 1)
  assert.equal(cards(zorro), 0)
})

test("sin inmunidad se sigue pudiendo robar", () => {
  const { gacha, luna, zorro, cards } = gachaSetup()
  gacha.pull(LUNA, "p1")
  assert.equal(gacha.steal(ZORRO).ok, true)
  assert.equal(cards(luna), 0)
  assert.equal(cards(zorro), 1)
})

// ── Pagina de canje ──────────────────────────────────────────────────────────
test("por la web: ver el catalogo, comprar y reintento sin cobrar dos veces", async t => {
  const { platform, luna, balance } = setup()
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, effects: createCanjeEffects({ platform, getChannel: () => "canal" }), sessions,
    validator: { validate: async () => null }, assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const token = sessions.issue({ twitchId: "111", login: "luna" }).token
  const call = async (route, body, auth = true) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET",
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, json: await response.json() }
  }
  assert.equal((await call("/api/effects", null, false)).status, 401)
  assert.equal((await call("/api/effects")).json.items[0].id, "anti-robo")
  const bought = await call("/api/effects/buy", { itemId: "anti-robo", key: "compra-efecto-1" })
  assert.equal(bought.status, 200)
  assert.equal(bought.json.remainingMs, 15 * MINUTE)
  const retry = await call("/api/effects/buy", { itemId: "anti-robo", key: "compra-efecto-1" })
  assert.deepEqual(retry.json, bought.json)
  assert.equal(balance(luna), 150_000)
  assert.ok((await call("/api/effects")).json.items[0].remainingMs > 0)
})

// ── !plinko en el chat ───────────────────────────────────────────────────────
test("!plinko: solo VIP, mods y subs, con 4 s de espera, y responde el resultado", () => {
  const { platform, clock } = setup()
  platform.mimics.create("canal", { name: "Confeti", icon: "*", rarity: "raro" })
  const ranks = { luna: ["twitch:sub"], zorro: [] }
  const commandConfig = createCommandConfigService(platform, () => "canal", {
    now: () => clock.t, rankResolver: event => ranks[event.actor.username] || [],
  })
  const replies = []
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    overlay: () => {}, commandConfig, now: () => clock.t,
    plinko: createPlinko({ platform, getChannel: () => "canal", random: () => 0 }),
  })
  const chat = (actor, id) => engine.handle({ id, platform: "twitch", type: "chat_message", metadata: {}, actor, message: { text: "!plinko" } })

  chat(LUNA, "m1")
  assert.equal(replies[0], "@Luna soltó la bola en el Plinko (-150 pts): cayó en Nada y no ganó nada.")
  chat(LUNA, "m2")
  assert.equal(replies[1], "@Luna espera 4s para volver a usar !plinko.")
  clock.t += 4000
  chat(LUNA, "m3")
  assert.match(replies[2], /^@Luna soltó la bola en el Plinko/)
  chat(ZORRO, "m4")
  assert.match(replies[3], /^@Zorro !plinko es solo para: /)
  assert.equal(replies.length, 4)
})
