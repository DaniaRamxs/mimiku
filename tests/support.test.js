const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createSupport, cleanTipUrl, toCents, DEFAULT_POINTS_PER_USD } = require("../src/services/support.js")
const { createCanjeSupport } = require("../src/services/canje-support.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const getChannel = () => "canal"
  const viewer = (username, platformName = "twitch", id = username) =>
    platform.identities.resolve({ platform: platformName, platformUserId: id, username, display: username[0].toUpperCase() + username.slice(1) })
  const give = (who, points, key) => platform.economy.applyMovement({ channelId: "canal", viewerId: who.id, balanceDelta: points, idempotencyKey: key, reason: "seed" })
  const balance = who => platform.economy.getBalance("canal", who.id).balance
  const support = createSupport({ platform, getChannel })
  return { db, platform, getChannel, viewer, give, balance, support }
}

test("por defecto 1M de puntos por cada 2 dolares y sin enlace", () => {
  const { support } = setup()
  assert.equal(DEFAULT_POINTS_PER_USD, 500_000)
  assert.deepEqual(support.getConfig(), { tipUrl: "", pointsPerUsd: 500_000 })
  assert.equal(support.pointsFor(toCents(2)), 1_000_000)
  assert.equal(support.pointsFor(toCents(5)), 2_500_000)
  assert.equal(support.pointsFor(toCents(0.5)), 250_000)
})

test("guarda el enlace y los puntos por dolar; rechaza valores invalidos", () => {
  const { support } = setup()
  const saved = support.setConfig({ tipUrl: " https://streamelements.com/hikkidx/tip ", pointsPerUsd: 100 })
  assert.deepEqual(saved, { tipUrl: "https://streamelements.com/hikkidx/tip", pointsPerUsd: 100 })
  assert.throws(() => support.setConfig({ tipUrl: "http://inseguro.com/tip" }), /https/)
  assert.throws(() => support.setConfig({ tipUrl: "javascript:alert(1)" }), /https/)
  assert.throws(() => support.setConfig({ tipUrl: "", pointsPerUsd: -1 }), /puntos por dólar/)
  assert.throws(() => support.setConfig({ tipUrl: "", pointsPerUsd: 1.5 }), /puntos por dólar/)
  assert.equal(cleanTipUrl(""), "")
})

test("apuntar un aporte da los puntos y queda en el libro de movimientos", () => {
  const { support, viewer, balance, platform } = setup()
  const luna = viewer("luna")
  const result = support.registerDonation({ username: "@Luna", amount: 2, note: "gracias" })
  assert.equal(result.ok, true)
  assert.equal(result.donation.points, 1_000_000)
  assert.equal(result.donation.viewer, "Luna")
  assert.equal(balance(luna), 1_000_000)
  const ledger = platform.economy.listLedger("canal", luna.id)
  assert.equal(ledger[0].source_type, "support")
  assert.match(ledger[0].reason, /2,00 USD/)
  assert.equal(support.listDonations()[0].note, "gracias")
})

test("rechaza importes raros, plataformas desconocidas y viewers que Mimiku no conoce", () => {
  const { support, viewer } = setup()
  viewer("luna")
  assert.equal(support.registerDonation({ username: "luna", amount: 0 }).reason, "bad-amount")
  assert.equal(support.registerDonation({ username: "luna", amount: -3 }).reason, "bad-amount")
  assert.equal(support.registerDonation({ username: "luna", amount: "abc" }).reason, "bad-amount")
  assert.equal(support.registerDonation({ username: "luna", amount: 20_000 }).reason, "bad-amount")
  assert.equal(support.registerDonation({ username: "luna", amount: 2, platform: "myspace" }).reason, "bad-platform")
  assert.equal(support.registerDonation({ username: "nadie", amount: 2 }).reason, "unknown-viewer")
  assert.equal(support.registerDonation({ username: "luna", amount: 2, platform: "tiktok" }).reason, "unknown-viewer")
  assert.equal(support.listDonations().length, 0)
})

test("top de donadores suma los aportes de cada viewer y excluye los deshechos", () => {
  const { support, viewer } = setup()
  viewer("luna"); viewer("sol"); viewer("mar", "tiktok", "tt-1")
  support.registerDonation({ username: "luna", amount: 2 })
  support.registerDonation({ username: "sol", amount: 5 })
  support.registerDonation({ username: "luna", amount: 4 })
  const mistake = support.registerDonation({ username: "mar", platform: "tiktok", amount: 100 })
  support.undoDonation(mistake.donation.id)
  const top = support.topDonors()
  assert.deepEqual(top.map(row => [row.rank, row.name, row.amountUsd]), [[1, "Luna", 6], [2, "Sol", 5]])
})

test("deshacer quita los puntos, no se puede hacer dos veces y falla si ya los gasto", () => {
  const { support, viewer, balance, platform } = setup()
  const luna = viewer("luna")
  const sol = viewer("sol")
  const first = support.registerDonation({ username: "luna", amount: 2 })
  assert.deepEqual(support.undoDonation(first.donation.id), { ok: true })
  assert.equal(balance(luna), 0)
  assert.equal(support.undoDonation(first.donation.id).reason, "gone")

  const second = support.registerDonation({ username: "sol", amount: 2 })
  platform.economy.applyMovement({ channelId: "canal", viewerId: sol.id, balanceDelta: -900_000, idempotencyKey: "gasto", reason: "compra" })
  assert.equal(support.undoDonation(second.donation.id).reason, "spent")
  assert.equal(balance(sol), 100_000)
  assert.equal(support.listDonations().length, 1)
})

test("top ricos ordena por cartera + banco y da el puesto de quien no sale", () => {
  const { support, viewer, give, platform } = setup()
  const names = ["ana", "beto", "caro", "dani"]
  const people = names.map(name => viewer(name))
  give(people[0], 100, "a"); give(people[1], 300, "b"); give(people[2], 200, "c"); give(people[3], 50, "d")
  platform.economy.applyMovement({ channelId: "canal", viewerId: people[3].id, balanceDelta: -50, bankDelta: 50, idempotencyKey: "banco", reason: "deposito" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: people[3].id, bankDelta: 400, idempotencyKey: "banco2", reason: "interes" })
  viewer("vacio") // sin puntos: no sale
  assert.deepEqual(support.richest().map(row => [row.rank, row.name, row.points]), [[1, "Dani", 450], [2, "Beto", 300], [3, "Caro", 200], [4, "Ana", 100]])
  assert.deepEqual(support.richest(2).map(row => row.name), ["Dani", "Beto"])
  assert.deepEqual(support.richRankOf(people[0].id), { rank: 4, points: 100 })
})

test("los bots de chat (Nightbot, Moobot, StreamlootsBot) no salen en el top de ricos ni cuentan para el puesto", () => {
  const { support, viewer, give } = setup()
  const ana = viewer("ana")
  give(ana, 100, "a")
  give(viewer("Nightbot"), 9000, "n"); give(viewer("moobot"), 8000, "m"); give(viewer("StreamlootsBot"), 7000, "s")
  assert.deepEqual(support.richest().map(row => row.name), ["Ana"])
  assert.deepEqual(support.richRankOf(ana.id), { rank: 1, points: 100 })
})

test("por la web: /api/top pide sesion y marca al viewer sin revelar ids", async t => {
  const { platform, getChannel, viewer, give, support } = setup()
  const luna = viewer("luna", "twitch", "111")
  const sol = viewer("sol", "twitch", "222")
  give(luna, 10, "l"); give(sol, 20, "s")
  support.setConfig({ tipUrl: "https://streamelements.com/hikkidx/tip" })
  support.registerDonation({ username: "sol", amount: 2 })
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, support: createCanjeSupport({ platform, getChannel }), sessions,
    validator: { validate: async () => null }, assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const call = async auth => {
    const response = await fetch(`http://127.0.0.1:${port}/api/top`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} })
    return { status: response.status, json: await response.json() }
  }

  assert.equal((await call(null)).status, 401)
  const { status, json } = await call(sessions.issue({ twitchId: "111", login: "luna" }).token)
  assert.equal(status, 200)
  assert.deepEqual(json.richest.map(row => [row.name, row.points, row.me]), [["Sol", 1_000_020, false], ["Luna", 10, true]])
  assert.deepEqual(json.donors.map(row => [row.name, row.amountUsd, row.me]), [["Sol", 2, false]])
  assert.deepEqual(json.me, { rank: 2, points: 10 })
  assert.deepEqual(json.support, { tipUrl: "https://streamelements.com/hikkidx/tip", pointsPerUsd: 500_000 })
  assert.equal(JSON.stringify(json).includes(luna.id), false)
  assert.equal(JSON.stringify(json).includes("viewerId"), false)
})

test("por la web: un viewer que Mimiku no conoce ve los tops sin puesto propio", async t => {
  const { platform, getChannel } = setup()
  const top = createCanjeSupport({ platform, getChannel }).top("999")
  assert.deepEqual(top.richest, [])
  assert.equal(top.me, null)
  t.diagnostic("ok")
})
