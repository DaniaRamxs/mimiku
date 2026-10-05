const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createTwitchSubs, VALID_MS } = require("../src/services/twitch-subs.js")
const { createSubPass, SUB_MAX_LEVEL } = require("../src/services/sub-pass.js")
const { createBattlePass, DEFAULT_XP_PER_LEVEL } = require("../src/services/battle-pass.js")
const { createEffectsShop } = require("../src/services/effects-shop.js")
const { createPlinko } = require("../src/services/plinko.js")
const { createGachaponService } = require("../src/services/gachapon.js")
const { createCardSleeves } = require("../src/services/card-sleeves.js")

const LUNA = { platform: "twitch", platformUserId: "111", username: "luna", displayName: "Luna" }

// Twitch simulado: el canal "hikkidx" es el id 999; `subs` = { userId: tier }.
function fakeTwitch(subs) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization })
    if (url.includes("/users?login=hikkidx")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "999" }] }) }
    const match = /subscriptions\/user\?broadcaster_id=999&user_id=(\d+)/.exec(url)
    if (match && subs === "no-scope") return { ok: false, status: 401, json: async () => ({}) }
    if (match && subs[match[1]]) return { ok: true, status: 200, json: async () => ({ data: [{ tier: subs[match[1]] }] }) }
    if (match) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: false, status: 500, json: async () => ({}) }
  }
  return { fetchImpl, calls }
}

function setup({ subs = { 111: "1000" }, points = 100000 } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.now() }
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: points, idempotencyKey: "seed", reason: "seed" })
  const getChannel = () => "canal"
  const twitch = fakeTwitch(subs)
  const subsService = createTwitchSubs({ platform, getChannel, getClientId: () => "cliente", getBroadcasterLogin: () => "hikkidx", fetchImpl: twitch.fetchImpl, now: () => clock.t, log: { error() {} } })
  const pass = createBattlePass({ platform, getChannel, now: () => clock.t, random: () => 0 })
  const subPass = createSubPass({ platform, getChannel, now: () => clock.t, random: () => 0 })
  const balance = () => platform.economy.getBalance("canal", viewer.id).balance
  return { db, platform, clock, viewer, getChannel, twitch, subsService, pass, subPass, balance }
}

test("verificar: sub con Twitch se guarda 7 dias; sin sub se borra; sin permiso no cambia nada", async () => {
  const { subsService, viewer, twitch, clock } = setup()
  assert.deepEqual(await subsService.verify("tok", { twitchId: "111" }), { checked: true, sub: true, tier: "1000" })
  assert.equal(twitch.calls[0].auth, "Bearer tok")
  assert.equal(subsService.status(viewer.id).sub, true)
  clock.t += VALID_MS
  assert.equal(subsService.status(viewer.id).sub, false, "caduca y hay que volver a verificar")

  const notSub = setup({ subs: {} })
  assert.deepEqual(await notSub.subsService.verify("tok", { twitchId: "111" }), { checked: true, sub: false })
  assert.equal(notSub.subsService.status(notSub.viewer.id).sub, false)

  const noScope = setup({ subs: "no-scope" })
  assert.equal((await noScope.subsService.verify("tok", { twitchId: "111" })).reason, "no-scope")
})

test("el streamer cuenta como sub de su canal", async () => {
  const { platform, subsService } = setup({ subs: {} })
  const streamer = platform.identities.resolve({ platform: "twitch", platformUserId: "999", username: "hikkidx", display: "hikkidx" })
  assert.equal((await subsService.verify("tok", { twitchId: "999" })).tier, "streamer")
  assert.equal(subsService.status(streamer.id).sub, true)
})

test("siendo sub: +25% de experiencia y premio en cada nivel (bolas, tiradas, cofres, a elegir, Corona)", async () => {
  const { subsService, pass, subPass, viewer, platform, getChannel } = setup()
  const box = platform.mimics.createBox("canal", { name: "Cofre dorado", price_points: 200, mimic_count: 3, odds: { comun: 1 } })
  pass.startSeason({ name: "T1" })
  await subsService.verify("tok", { twitchId: "111" })
  pass.addXp(viewer.id, DEFAULT_XP_PER_LEVEL * 8)
  assert.equal(pass.state(viewer.id).xp, DEFAULT_XP_PER_LEVEL * 10, "+25%")
  const sub = subPass.state(viewer.id)
  assert.equal(sub.level, 10)
  assert.ok(sub.levels.every(entry => entry.reward), "hay premio en cada nivel")
  assert.deepEqual(platform.tickets.get("canal", viewer.id), { gachapon: 30 + 35, plinko: 30 + 35 })
  assert.equal(platform.mimics.boxInventory("canal", viewer.id).find(row => row.box_id === box.id).quantity, 30 + 35)
  assert.equal(createCardSleeves({ platform, getChannel }).tokens(viewer.id).corona, 1)
  assert.deepEqual(sub.choices.map(item => [item.kind, item.rarity]), [["pick", "raro"], ["pick", "epico"], ["pick", "raro"]])
})

test("sin ser sub el pase Sub no avanza y no hay +25%", () => {
  const { pass, subPass, viewer } = setup({ subs: {} })
  pass.startSeason({ name: "T1" })
  pass.addXp(viewer.id, DEFAULT_XP_PER_LEVEL * 2)
  assert.equal(pass.state(viewer.id).xp, DEFAULT_XP_PER_LEVEL * 2)
  assert.equal(subPass.state(viewer.id).level, 0)
  assert.equal(subPass.state(viewer.id).status.sub, false)
})

test("elegir personaje: cualquiera de esa rareza (tambien del set Sub), una sola vez", async () => {
  const { platform, subsService, pass, subPass, viewer } = setup()
  const normal = platform.profiles.createCard("canal", { name: "Gato", rarity: "raro" })
  const exclusive = platform.profiles.createCard("canal", { name: "Hikki Sub", rarity: "raro", exclusive: "sub" })
  platform.profiles.createCard("canal", { name: "Dragon", rarity: "legendario" })
  pass.startSeason({ name: "T1" })
  await subsService.verify("tok", { twitchId: "111" })
  pass.addXp(viewer.id, DEFAULT_XP_PER_LEVEL * 3)
  const choice = subPass.pendingChoices(viewer.id)[0]
  assert.deepEqual(subPass.pickOptions(choice.rarity).map(card => card.name).sort(), ["Gato", "Hikki Sub"])
  assert.equal(subPass.choose(viewer.id, choice.id, "otra").reason, "bad-card")
  const chosen = subPass.choose(viewer.id, choice.id, exclusive.id)
  assert.equal(chosen.ok, true)
  assert.equal(platform.profiles.plainCopies("canal", viewer.id, exclusive.id), 1)
  assert.equal(subPass.choose(viewer.id, choice.id, normal.id).reason, "no-choice")
  assert.deepEqual(platform.profiles.droppableCards("canal").map(card => card.name).sort(), ["Dragon", "Gato"], "el set Sub no sale en el gachapon")
})

test("nivel 20: convierte la carta que quieras en Mitica sin gastar copias, y conserva la funda", async () => {
  const { platform, subsService, pass, subPass, viewer, getChannel } = setup()
  const gato = platform.profiles.createCard("canal", { name: "Gato", rarity: "comun" })
  platform.profiles.grantCard("canal", viewer.id, gato.id, 2, "g")
  const sleeves = createCardSleeves({ platform, getChannel })
  sleeves.grant(viewer.id, "rara", 1)
  sleeves.apply(viewer.id, gato.id, "rara")
  pass.startSeason({ name: "T1" })
  await subsService.verify("tok", { twitchId: "111" })
  pass.addXp(viewer.id, DEFAULT_XP_PER_LEVEL * SUB_MAX_LEVEL)
  const mythic = subPass.pendingChoices(viewer.id).find(item => item.kind === "mythic")
  assert.ok(mythic)
  const done = subPass.makeMythic(viewer.id, mythic.id, { cardId: gato.id, sleeve: "rara" })
  assert.equal(done.ok, true)
  assert.deepEqual(platform.profiles.getCardVariants("canal", viewer.id).map(row => [row.rank, row.sleeve, row.quantity]).filter(row => row[2] > 0), [["mitico", "rara", 1]])
  assert.equal(platform.profiles.plainCopies("canal", viewer.id, gato.id), 1, "no gasta copias")
  assert.equal(subPass.makeMythic(viewer.id, mythic.id, { cardId: gato.id }).reason, "no-choice")
})

test("nivel extra: con el 20 completado se paga y quedan 50 cofres de Streamloots pendientes en el panel", async () => {
  const { subsService, pass, subPass, viewer, balance } = setup({ points: 3_000_000 })
  const { DEFAULT_BONUS_PRICE } = require("../src/services/sub-pass.js")
  pass.startSeason({ name: "T1" })
  await subsService.verify("tok", { twitchId: "111" })
  assert.equal(subPass.buyBonus(viewer.id, "b0").reason, "bonus-locked")
  pass.addXp(viewer.id, DEFAULT_XP_PER_LEVEL * SUB_MAX_LEVEL)
  assert.equal(subPass.state(viewer.id).bonus.available, true)
  const before = balance()
  assert.equal(subPass.buyBonus(viewer.id, "b1").ok, true)
  assert.equal(balance(), before - DEFAULT_BONUS_PRICE)
  assert.equal(subPass.buyBonus(viewer.id, "b2").reason, "bonus-owned")
  const pending = pass.pendingDeliveries().filter(item => item.track === "sub")
  assert.equal(pending.length, 1)
  assert.match(pending[0].items[0], /50 cofres de Streamloots/)
  assert.equal(pass.markDelivered(pending[0]).ok, true)
  assert.equal(subPass.state(viewer.id).bonus.delivered, true)
  assert.equal(pass.pendingDeliveries().filter(item => item.track === "sub").length, 0)
})

test("tiradas y bolas gratis se gastan antes que los puntos", () => {
  const { platform, viewer, getChannel, balance } = setup()
  platform.profiles.createCard("canal", { name: "Gato", rarity: "comun" })
  platform.tickets.grant("canal", viewer.id, "plinko", 1)
  platform.tickets.grant("canal", viewer.id, "gachapon", 1)
  const plinko = createPlinko({ platform, getChannel, random: () => 0 })
  const first = plinko.play(viewer.id, "b1")
  assert.equal(first.free, true)
  assert.equal(balance(), 100000)
  assert.equal(plinko.play(viewer.id, "b2").free, false)
  const gacha = createGachaponService({ platform, getChannel, log: { error() {} } })
  const pull = gacha.pull(LUNA, "g1")
  assert.equal(pull.free, true)
  assert.equal(pull.price, 0)
  assert.deepEqual(platform.tickets.get("canal", viewer.id), { gachapon: 0, plinko: 0 })
})

test("los subs tienen un 10% de descuento en la tienda", async () => {
  const { platform, getChannel, subsService, viewer, balance, clock } = setup()
  const shop = createEffectsShop({ platform, getChannel, now: () => clock.t })
  assert.equal(shop.catalog(viewer.id)[0].price, 50000)
  await subsService.verify("tok", { twitchId: "111" })
  const item = shop.catalog(viewer.id)[0]
  assert.deepEqual([item.price, item.fullPrice], [45000, 50000])
  shop.buy(viewer.id, "anti-robo", "k1")
  assert.equal(balance(), 100000 - 45000)
})

test("al entrar en la pagina se comprueba la suscripcion y el pase Sub lo muestra", async t => {
  const { platform, getChannel, subsService } = setup()
  const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")
  const { createCanjePass } = require("../src/services/canje-pass.js")
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, pass: createCanjePass({ platform, getChannel }), subs: subsService, sessions,
    validator: { validate: async token => (token === "twitch-token" ? { twitchId: "111", login: "luna" } : null) },
    assetDir: ".", getConfig: () => ({ clientId: "cliente", channelDisplay: "hikkidx" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const login = await fetch(`http://127.0.0.1:${port}/api/session`, { method: "POST", headers: { Authorization: "Bearer twitch-token" } })
  const body = await login.json()
  assert.deepEqual(body.sub, { checked: true, sub: true, tier: "1000" })
  const sub = await fetch(`http://127.0.0.1:${port}/api/pass/sub`, { headers: { Authorization: `Bearer ${body.session}` } })
  const state = await sub.json()
  assert.equal(state.status.sub, true)
  assert.equal(state.status.tierLabel, "Tier 1")
  assert.equal(state.perks.discountPercent, 10)
})
