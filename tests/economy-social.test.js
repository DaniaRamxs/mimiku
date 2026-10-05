const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")
const { createLiveFeed } = require("../src/services/live-feed.js")
const { createCanjeRewards } = require("../src/services/canje-rewards.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")

function setup({ shielded = () => false } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const feed = createLiveFeed()
  const economy = createEconomyService(platform, () => "canal", { feed, isShielded: shielded })
  const person = (id, username, points) => {
    const row = platform.identities.resolve({ platform: "twitch", platformUserId: id, username, display: username[0].toUpperCase() + username.slice(1) })
    if (points) platform.economy.applyMovement({ channelId: "canal", viewerId: row.id, balanceDelta: points, idempotencyKey: `seed-${id}`, reason: "seed" })
    return row
  }
  const luna = person("111", "luna", 200000)
  const zorro = person("222", "zorro", 100000)
  const balance = viewer => platform.economy.getBalance("canal", viewer.id).balance
  const age = (viewer, action, seconds) => db.prepare("UPDATE cooldowns_local SET last_used=datetime('now', ?) WHERE viewer_id=? AND action=?").run(`-${seconds} seconds`, viewer.id, action)
  return { db, platform, feed, economy, luna, zorro, balance, age }
}

test("work: paga entre 500 y 2.000 y luego hay que esperar 15 min", () => {
  const { economy, luna, balance } = setup()
  assert.equal(economy.workStatus("luna").ready, true)
  const result = economy.claimWork("luna", "Luna", "twitch", "111")
  assert.equal(result.ok, true)
  assert.ok(result.points >= 500 && result.points <= 2000)
  assert.equal(balance(luna), 200000 + result.points)
  assert.equal(economy.claimWork("luna", "Luna", "twitch", "111").ok, false)
  const status = economy.workStatus("luna")
  assert.equal(status.ready, false)
  assert.ok(status.remainingSeconds > 800)
})

test("robar con exito: 30 % (tope 20.000), protege a la victima 30 min y avisa en el tablon", () => {
  const { economy, luna, zorro, balance, feed } = setup()
  const result = economy.robar("luna", "Luna", "zorro", "twitch", "111", { random: () => 0 })
  assert.equal(result.result, "success")
  assert.equal(result.stolen, 20000, "30 % de 100.000 = 30.000, con tope de 20.000")
  assert.equal(balance(zorro), 80000)
  assert.equal(balance(luna), 220000)
  const [event] = feed.list("canal", { viewerId: zorro.id }).events
  assert.deepEqual([event.kind, event.ownerMine, event.net, event.who], ["rob", true, 20000, "Luna"])
})

test("robar: espera de 10 min para el ladron y la victima protegida tras un robo", () => {
  const { economy, platform, luna, age } = setup()
  platform.identities.resolve({ platform: "twitch", platformUserId: "333", username: "neo", display: "Neo" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: platform.identities.byUsername("neo", "twitch").id, balanceDelta: 5000, idempotencyKey: "seed-neo", reason: "seed" })
  assert.equal(economy.robar("luna", "Luna", "zorro", "twitch", "111", { random: () => 0 }).result, "success")
  assert.equal(economy.robar("luna", "Luna", "neo", "twitch", "111").reason, "cooldown")
  age(luna, "robar", 601)
  const zorroAgain = economy.robar("luna", "Luna", "zorro", "twitch", "111")
  assert.equal(zorroAgain.reason, "protected")
  assert.match(zorroAgain.error, /protegido/)
  assert.equal(economy.robar("luna", "Luna", "neo", "twitch", "111", { random: () => 0.99 }).result, "fail")
})

test("robar: la inmunidad de la tienda protege los puntos y un fallo cuesta la mitad", () => {
  const shielded = setup({ shielded: () => true })
  assert.equal(shielded.economy.robar("luna", "Luna", "zorro", "twitch", "111").reason, "shielded")
  const { economy, luna, balance } = setup()
  const fail = economy.robar("luna", "Luna", "zorro", "twitch", "111", { random: () => 0.99 })
  assert.equal(fail.result, "fail")
  assert.equal(fail.penalty, 10000)
  assert.equal(balance(luna), 190000)
})

test("regalar: comision del 5 %, limites por regalo y tope de 100.000 en 24 h", () => {
  const { economy, luna, zorro, balance, feed } = setup()
  const gift = economy.regalar("luna", "Luna", "zorro", 10000, "twitch", "111")
  assert.deepEqual([gift.sent, gift.received, gift.fee], [10000, 9500, 500])
  assert.equal(balance(luna), 190000)
  assert.equal(balance(zorro), 109500)
  assert.equal(feed.list("canal", { viewerId: zorro.id }).events.at(-1).ownerMine, true)
  assert.equal(economy.regalar("luna", "Luna", "zorro", 50, "twitch", "111").reason, "bad-amount")
  assert.equal(economy.regalar("luna", "Luna", "zorro", 60000, "twitch", "111").reason, "bad-amount")
  assert.equal(economy.regalar("luna", "Luna", "luna", 1000, "twitch", "111").reason, "self")
  assert.equal(economy.regalar("luna", "Luna", "zorro", 50000, "twitch", "111").ok, true)
  assert.equal(economy.regalar("luna", "Luna", "zorro", 50000, "twitch", "111").reason, "cap")
  assert.equal(economy.giftStatus("luna").left, 40000)
  assert.equal(economy.regalar("zorro", "Zorro", "luna", 50000, "twitch", "222").ok, true)
})

test("por la web: trabajar, regalar y robar (con permiso del panel)", async t => {
  const { platform, economy } = setup()
  const loyalty = { viewerStatus: () => ({ enabled: false, live: false }), claim: () => ({ ok: false }) }
  const rewards = createCanjeRewards({ platform, getChannel: () => "canal", economy, loyalty, canRob: viewer => (viewer.username === "luna" ? { ok: true } : { ok: false, reason: "rank" }), now: (() => { let t = 0; return () => (t += 5000) })() })
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, rewards, sessions, validator: { validate: async () => null },
    assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const tokens = { luna: sessions.issue({ twitchId: "111", login: "luna" }).token, zorro: sessions.issue({ twitchId: "222", login: "zorro" }).token }
  const post = async (who, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return { status: response.status, json: await response.json() }
  }
  const work = await post("luna", "/api/rewards/work")
  assert.equal(work.status, 200)
  assert.ok(work.json.reward >= 500)
  const gift = await post("luna", "/api/rewards/gift", { login: "zorro", amount: 2000 })
  assert.equal(gift.status, 200)
  assert.equal(gift.json.received, 1900)
  const denied = await post("zorro", "/api/rewards/rob", { login: "luna" })
  assert.equal(denied.status, 409)
  assert.match(denied.json.error, /permiso/)
  const rob = await post("luna", "/api/rewards/rob", { login: "zorro" })
  assert.equal(rob.status, 200)
  assert.ok(["success", "fail"].includes(rob.json.result))
  const again = await post("luna", "/api/rewards/rob", { login: "zorro" })
  assert.equal(again.status, 409)
  assert.match(again.json.error, /min/)
})
