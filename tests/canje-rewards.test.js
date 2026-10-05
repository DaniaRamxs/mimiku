const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")
const { createLoyaltyService } = require("../src/services/loyalty.js")
const { createCanjeRewards } = require("../src/services/canje-rewards.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")

function setup({ live = true, sub = false } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const store = new Map()
  platform.moderation.getConfig = (_channel, key) => store.get(key)
  platform.moderation.setConfig = (_channel, key, value) => { store.set(key, value); return value }
  const getChannel = () => "canal"
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  const liveState = { value: live ? { live: true, streamId: "s1", startedAt: new Date().toISOString() } : null }
  const economy = createEconomyService(platform, getChannel)
  const loyalty = createLoyaltyService({ platform, getChannel, liveStatus: () => liveState.value })
  const broadcasts = []
  const rewards = createCanjeRewards({ platform, getChannel, economy, loyalty, broadcast: payload => broadcasts.push(payload), isSub: () => sub, now: (() => { let t = 0; return () => (t += 5000) })() })
  const balance = () => platform.economy.getBalance("canal", viewer.id).balance
  return { platform, economy, loyalty, rewards, broadcasts, balance, liveState, viewer }
}

test("daily web: 10.000 puntos, luego espera 24 h; lo reclamado en la web cuenta en el chat", () => {
  const { rewards, economy, balance } = setup()
  const before = rewards.state("111")
  assert.equal(before.daily.ready, true)
  assert.equal(before.daily.reward, 10000)
  const claimed = rewards.daily("111")
  assert.equal(claimed.ok, true)
  assert.equal(claimed.reward, 10000)
  assert.equal(balance(), 10000)
  assert.equal(claimed.daily.ready, false)
  assert.ok(claimed.daily.remainingSeconds > 86000)
  assert.equal(rewards.daily("111").reason, "daily-wait")
  assert.equal(economy.claimDaily("luna", "Luna", "twitch", "111").ok, false, "el !daily del chat ya no paga hoy")
})

test("daily de sub: 30.000 en la web y en el chat", () => {
  const web = setup({ sub: true })
  assert.equal(web.rewards.state("111").daily.reward, 30000)
  assert.equal(web.rewards.daily("111").reward, 30000)
  assert.equal(web.balance(), 30000)
  const chat = setup()
  const result = chat.economy.claimDaily("luna", "Luna", "twitch", "111", { sub: true })
  assert.equal(result.points, 30000)
  assert.equal(chat.balance(), 30000)
})

test("sello web: solo en directo, uno por directo, sale en el overlay y completa con 100.000", () => {
  const { rewards, loyalty, broadcasts, balance, liveState } = setup()
  loyalty.setConfig({ stamps: 2 })
  const first = rewards.claim("111")
  assert.equal(first.ok, true)
  assert.equal(first.loyalty.filled, 1)
  assert.equal(first.loyalty.claimedThisStream, true)
  assert.equal(broadcasts[0].type, "loyalty_card")
  assert.equal(rewards.claim("111").reason, "already")
  liveState.value = { live: true, streamId: "s2", startedAt: new Date().toISOString() }
  const second = rewards.claim("111")
  assert.equal(second.completed, true)
  assert.equal(second.rewardPoints, 100000)
  assert.equal(balance(), 100000)
  assert.equal(rewards.claim("111").reason, "completed")
})

test("sello web: fuera de directo no se puede", () => {
  const { rewards } = setup({ live: false })
  const card = rewards.state("111").loyalty
  assert.equal(card.live, false)
  assert.equal(rewards.claim("111").reason, "offline")
})

test("por la web: /api/rewards pide sesion y devuelve daily, tarjeta y puntos", async t => {
  const { platform, rewards } = setup()
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, rewards, sessions, validator: { validate: async () => null },
    assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
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
  assert.equal((await call("/api/rewards", null, false)).status, 401)
  const state = await call("/api/rewards")
  assert.equal(state.status, 200)
  assert.equal(state.json.daily.reward, 10000)
  assert.equal(state.json.loyalty.total, 10)
  assert.equal(state.json.loyalty.rewardPoints, 100000)
  const daily = await call("/api/rewards/daily", {})
  assert.equal(daily.status, 200)
  const again = await call("/api/rewards/daily", {})
  assert.equal(again.status, 409)
  assert.match(again.json.error, /diaria/)
  assert.equal(platform.economy.getBalance("canal", platform.identities.byUsername("luna", "twitch").id).balance, 10000)
})

test("la migracion v20 sube a 100.000 la tarjeta que seguia en 20.000 y respeta otras cantidades", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  db.prepare("DELETE FROM schema_migrations WHERE version=20").run()
  db.prepare("INSERT INTO moderation_config_local(channel_id, config_key, value_json, updated_at) VALUES('a', 'loyalty', ?, datetime('now'))").run(JSON.stringify({ stamps: 10, rewardPoints: 20000, title: "Constancia" }))
  db.prepare("INSERT INTO moderation_config_local(channel_id, config_key, value_json, updated_at) VALUES('b', 'loyalty', ?, datetime('now'))").run(JSON.stringify({ stamps: 8, rewardPoints: 50000 }))
  applyMigrations(db)
  const reward = channel => JSON.parse(db.prepare("SELECT value_json FROM moderation_config_local WHERE channel_id=? AND config_key='loyalty'").get(channel).value_json)
  assert.equal(reward("a").rewardPoints, 100000)
  assert.equal(reward("a").title, "Constancia")
  assert.equal(reward("b").rewardPoints, 50000)
})
