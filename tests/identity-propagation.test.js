// Fase 1.45 — Identity Propagation Cleanup.
// La Fase 1.4 ya separó identidades por plataforma; esta fase corrige que
// games.js/events.js dejaran de propagar el platformUserId REAL en llamadas
// internas a economy, fragmentando a un mismo viewer en dos filas dentro de
// la MISMA plataforma (una por id real, otra "legacy:<username>").
const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const economy = createEconomyService(platform, () => "canal")
  return { db, platform, economy }
}

function seedAndSpendable(economy, username, platformUserId, platformName, amount = 1000) {
  // asegura saldo suficiente resolviendo la identidad exactamente como lo
  // haría un comando real: con platformUserId desde el primer contacto.
  economy.addPoints(username, amount, "seed", { platform: platformName, platformUserId })
}

function identityRows(db, username) {
  return db.prepare("SELECT platform, platform_user_id FROM viewer_identities WHERE username=?").all(username)
}

// games.js requiere src/services/economy.js DIRECTAMENTE (no acepta una
// instancia inyectada) y ese economy.js exporta funciones ligadas al
// singleton real, respaldado por db.js/Electron. Para probar games.js con
// SQLite en memoria de verdad (no un fake), se stubea el module cache de
// economy.js con las funciones YA LIGADAS a la instancia de economy de este
// test, y se recarga games.js en limpio. Se restaura todo después.
function loadGamesWithEconomy(economy) {
  const economyPath = require.resolve("../src/services/economy.js")
  const gamesPath = require.resolve("../src/services/games.js")

  const savedEconomy = require.cache[economyPath]
  require.cache[economyPath] = {
    id: economyPath, filename: economyPath, loaded: true,
    exports: { getViewer: economy.getViewer, addPoints: economy.addPoints },
  }
  delete require.cache[gamesPath]

  const games = require("../src/services/games.js")

  if (savedEconomy) require.cache[economyPath] = savedEconomy; else delete require.cache[economyPath]
  delete require.cache[gamesPath] // forzar recarga limpia para el siguiente test

  return games
}

// ── RULETA ──────────────────────────────────────────────────────────────────
test("Ruleta (YouTube, platformUserId real): no aparece una fila legacy:luna", () => {
  const { db, economy } = setup()
  const games = loadGamesWithEconomy(economy)
  seedAndSpendable(economy, "luna", "yt-99", "youtube")

  games.rouletteSpin("luna", "rojo", 100, "youtube", "yt-99")

  const rows = identityRows(db, "luna")
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { platform: "youtube", platform_user_id: "yt-99" })
})

// ── SLOTS ───────────────────────────────────────────────────────────────────
test("Slots (YouTube, platformUserId real): no aparece una fila legacy:luna", () => {
  const { db, economy } = setup()
  const games = loadGamesWithEconomy(economy)
  seedAndSpendable(economy, "luna", "yt-99", "youtube")

  games.playSlots("luna", 100, "youtube", "yt-99")

  const rows = identityRows(db, "luna")
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { platform: "youtube", platform_user_id: "yt-99" })
})

// ── BLACKJACK ───────────────────────────────────────────────────────────────
test("Blackjack: Twitch:luna(tw-1) y YouTube:luna(yt-1) tienen partidas independientes", () => {
  const { economy } = setup()
  const games = loadGamesWithEconomy(economy)
  seedAndSpendable(economy, "luna", "tw-1", "twitch")
  seedAndSpendable(economy, "luna", "yt-1", "youtube")
  games.bjOpen()

  const twJoin = games.bjJoin("luna", 50, "twitch", "tw-1")
  const ytJoin = games.bjJoin("luna", 50, "youtube", "yt-1")
  assert.equal(twJoin.error, undefined)
  assert.equal(ytJoin.error, undefined)

  // hit/stand en Twitch no debe tocar la partida de YouTube
  games.bjHit("luna", "twitch", "tw-1")
  const ytStillActive = games.bjStand("luna", "youtube", "yt-1")
  assert.notEqual(ytStillActive.error, "No tenés partida activa.")

  games.bjClose()
})

test("Blackjack: sin platformUserId, dos 'luna' de la misma plataforma SÍ comparten partida (fallback legacy)", () => {
  const { economy } = setup()
  const games = loadGamesWithEconomy(economy)
  seedAndSpendable(economy, "luna", "", "twitch")
  games.bjOpen()

  const first = games.bjJoin("luna", 50, "twitch") // sin platformUserId → legacy:luna
  assert.equal(first.error, undefined)
  const second = games.bjJoin("luna", 50, "twitch") // mismo fallback: "ya tenés partida"
  assert.equal(second.error, "Ya tenés una partida en curso. Usá !hit o !stand.")

  games.bjClose()
})

// ── BOSS / LOTTERY / COIN FLIP ───────────────────────────────────────────────
// events.js importa src/services/db.js de forma eager (solo puede
// inicializarse dentro de Electron real), así que se stubean db.js y
// economy.js en el module cache ANTES de requerir events.js, y se restaura
// el cache después — la única forma de probar events.js fuera de Electron.
function loadEventsWithEconomyStub(economyStub) {
  const dbPath = require.resolve("../src/services/db.js")
  const economyPath = require.resolve("../src/services/economy.js")
  const eventsPath = require.resolve("../src/services/events.js")

  const savedDb = require.cache[dbPath]
  const savedEconomy = require.cache[economyPath]

  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: () => { throw new Error("db.js no debería tocarse en este test") } } }
  require.cache[economyPath] = { id: economyPath, filename: economyPath, loaded: true, exports: economyStub }
  delete require.cache[eventsPath]

  const events = require("../src/services/events.js")

  if (savedDb) require.cache[dbPath] = savedDb; else delete require.cache[dbPath]
  if (savedEconomy) require.cache[economyPath] = savedEconomy; else delete require.cache[economyPath]
  delete require.cache[eventsPath] // forzar recarga limpia para el siguiente test

  return events
}

function fakeEconomy() {
  const calls = []
  return {
    calls,
    addPoints: (username, delta, reason, options = {}) => { calls.push({ username, delta, reason, ...options }); return {} },
    getRanking: () => [],
    getViewer: () => ({ points: 999999 }),
  }
}

test("Boss: la contribución/recompensa conserva platformUserId hasta Economy", () => {
  const economy = fakeEconomy()
  const events = loadEventsWithEconomyStub(economy)

  events.spawnBoss(100)
  const result = events.attackBoss("luna", "Luna", 100, "youtube", "yt-99") // daño = HP → derrota inmediata

  assert.equal(result.defeated, true)
  const ataque = economy.calls.find(c => c.reason === "boss-ataque")
  const recompensa = economy.calls.find(c => c.reason === "boss-recompensa")
  assert.equal(ataque.platform, "youtube")
  assert.equal(ataque.platformUserId, "yt-99")
  assert.equal(recompensa.platform, "youtube")
  assert.equal(recompensa.platformUserId, "yt-99")
})

test("Lottery: la compra y el premio conservan platformUserId, sin identidad legacy secundaria", () => {
  const economy = fakeEconomy()
  const events = loadEventsWithEconomyStub(economy)

  events.startLottery(50)
  events.buyLotteryTicket("luna", "Luna", "youtube", "yt-99")
  const draw = events.drawLottery()

  const compra = economy.calls.find(c => c.reason === "boleto-lotería")
  const premio = economy.calls.find(c => c.reason === "lotería-ganador")
  assert.equal(compra.platformUserId, "yt-99")
  assert.equal(premio.platformUserId, "yt-99")
  assert.equal(draw.winner, "luna")
})

test("Coin flip: conserva platformUserId real en la operación económica final", () => {
  const economy = fakeEconomy()
  const events = loadEventsWithEconomyStub(economy)

  events.setCoinActive(true, 500)
  events.flipCoin("luna", "Luna", 100, "youtube", "yt-99")

  const movimiento = economy.calls.find(c => c.reason === "coin-cara" || c.reason === "coin-cruz")
  assert.ok(movimiento)
  assert.equal(movimiento.platform, "youtube")
  assert.equal(movimiento.platformUserId, "yt-99")
})

// ── FALLBACK LEGACY (sigue vivo) ─────────────────────────────────────────────
test("Fallback: sin platformUserId, se sigue usando platform + legacy:<username>", () => {
  const { db, economy } = setup()
  economy.addPoints("bob", 10, "seed", { platform: "youtube" }) // sin platformUserId
  const row = db.prepare("SELECT platform, platform_user_id FROM viewer_identities WHERE username='bob'").get()
  assert.equal(row.platform, "youtube")
  assert.equal(row.platform_user_id, "legacy:bob")
})

// ── INVARIANTE (sección 14) ──────────────────────────────────────────────────
test("invariante: con platformUserId no vacío, ninguna operación de ruleta/slots/blackjack crea una identidad legacy", () => {
  const { db, economy } = setup()
  const games = loadGamesWithEconomy(economy)
  games.bjOpen()

  seedAndSpendable(economy, "ana", "yt-1", "youtube")
  games.rouletteSpin("ana", "rojo", 50, "youtube", "yt-1")
  games.playSlots("ana", 50, "youtube", "yt-1")
  games.bjJoin("ana", 50, "youtube", "yt-1")
  games.bjStand("ana", "youtube", "yt-1")

  const rows = db.prepare("SELECT platform, platform_user_id FROM viewer_identities WHERE username='ana'").all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].platform_user_id, "yt-1")
  assert.ok(!rows.some(r => r.platform_user_id.startsWith("legacy:")))

  games.bjClose()
})

// ── COMPATIBILIDAD ───────────────────────────────────────────────────────────
test("compatibilidad: Twitch existente, separación por plataforma y arranque sin SSN/Supabase siguen intactos", () => {
  const { db, economy } = setup()
  // Twitch "veterano" creado como antes de la Fase 1.4 (sin platform explícito
  // más allá del default) sigue resolviendo su saldo con el código actual.
  const legacyViewer = require("../src/services/local-platform.js").createLocalPlatform(db).identities.resolve({ platform: "twitch", platformUserId: "tw_old", username: "veterano" })
  db.prepare("UPDATE wallets SET balance=500 WHERE viewer_id=? AND channel_id='canal'").run(legacyViewer.id)
  db.prepare("INSERT OR IGNORE INTO wallets(channel_id,viewer_id,balance) VALUES('canal',?,500)").run(legacyViewer.id)
  assert.equal(economy.getViewer("veterano", "twitch").id, legacyViewer.id)

  // Twitch y YouTube con el mismo username permanecen separados.
  economy.addPoints("luna", 5, "seed", { platform: "twitch", platformUserId: "tw-9" })
  economy.addPoints("luna", 7, "seed", { platform: "youtube", platformUserId: "yt-9" })
  assert.notEqual(economy.getViewer("luna", "twitch").id, economy.getViewer("luna", "youtube").id)

  // Esta prueba (y toda la suite) corre sin ningún SSN ni Supabase configurado.
  assert.equal(process.env.MIMIKU_SUPABASE_URL, undefined)
})
