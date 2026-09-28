// Fase 5: los widgets y juegos (blackjack, ruleta y slots del casino, avatar de
// chat, niveles, actividad) funcionan con el chat de TikTok SIN logica propia
// de plataforma. La cadena es real de punta a punta: adaptador de TikTok ->
// Event Engine -> Command Engine / consumidores, con games.js real y economia
// sobre SQLite en memoria.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")
const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const { createActivityTracker, registerActivityConsumer } = require("../src/core/interactions/activity-consumer.js")
const {
  createXpConsumer, createLevelsConsumer, createWidgetsConsumer, createChatFeedConsumer,
} = require("../src/core/interactions/chat-activity-consumers.js")
const { createTikTokAdapter } = require("../src/integrations/tiktok/tiktok-adapter.js")
const currentChannel = require("../src/services/currentChannel.js")

const ROOT = path.resolve(__dirname, "..")

// games.js desestructura economy.js al cargarse; se instala una economia
// enlazada a la base en memoria antes de requerirlo y luego se restaura.
function loadRealGames(economy) {
  const economyPath = require.resolve("../src/services/economy.js")
  const gamesPath = require.resolve("../src/services/games.js")
  const savedEconomy = require.cache[economyPath]
  const savedGames = require.cache[gamesPath]
  require.cache[economyPath] = {
    id: economyPath, filename: economyPath, loaded: true,
    exports: { getViewer: economy.getViewer, addPoints: economy.addPoints },
  }
  delete require.cache[gamesPath]
  const games = require(gamesPath)
  if (savedEconomy) require.cache[economyPath] = savedEconomy; else delete require.cache[economyPath]
  if (savedGames) require.cache[gamesPath] = savedGames; else delete require.cache[gamesPath]
  return games
}

async function setupPipeline() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const economy = createEconomyService(platform, () => "canal")
  const games = loadRealGames(economy)
  currentChannel.set("canal")

  const engine = createEventEngine()
  const local = []       // respuestas entregadas al panel local (TikTok no puede responder)
  const overlays = []    // mensajes enviados al overlay
  const widgetCalls = []
  const levelCalls = []
  const feed = []

  const levels = {
    onMessage: (...args) => levelCalls.push(args),
    getViewerLevel: async () => ({ xp: 120, level: 2, into: 20, needed: 200 }),
    titleForLevel: () => ({ icon: "", title: "Habitual" }),
  }
  registerCommandEngine(engine, {
    economy, games, events: {}, levels,
    shop: { checkCooldown: () => 0, setCooldown: () => {} },
    afk: { getIdleCommandReply: () => null },
    vipService: { getCommandNames: () => [] },
    commandConfig: { evaluate: () => ({ allowed: true }), record: () => {} },
    notify: (channel, payload) => { if (channel === "chat:response") local.push(payload) },
    overlay: payload => overlays.push(payload),
  })

  const activity = createActivityTracker()
  registerActivityConsumer(engine, activity)
  engine.subscribe("chat_message", createXpConsumer({ economy, events: { isEconomyFrozen: () => false, getMultiplier: () => 1 } }).handle)
  engine.subscribe("chat_message", createLevelsConsumer({ levels }).handle)
  engine.subscribe("chat_message", createWidgetsConsumer({
    widgets: { onChatMessage: (...args) => { widgetCalls.push(args); return Promise.resolve() } },
  }).handle)
  engine.subscribe("chat_message", createChatFeedConsumer({ notify: (channel, payload) => feed.push(payload) }).handle)

  // Conexion falsa: se le inyectan los eventos como los mandaria la libreria.
  const emitter = new EventEmitter()
  const adapter = createTikTokAdapter({
    eventEngine: engine,
    log: { warn() {}, error() {} },
    connectionFactory: async () => ({ on: (name, fn) => emitter.on(name, fn), connect: async () => {}, disconnect: async () => {} }),
  })
  await adapter.connect("streamer")

  let messageCounter = 0
  function chat(text, { userId = "777", uniqueId = "LunaTok", nickname = "Luna" } = {}) {
    emitter.emit("chat", {
      // Forma real de tiktok-live-connector 2.x (protobuf v3), no la legacy plana.
      user: { id: userId, idStr: userId, displayId: uniqueId, nickname },
      content: text,
      common: { msgId: `m-${++messageCounter}` },
    })
  }

  return { db, platform, economy, games, engine, emitter, adapter, chat, local, overlays, widgetCalls, levelCalls, feed, activity }
}

function tiktokWallet(economy, username = "lunatok") {
  return economy.getViewer(username, "tiktok")
}

test("el chat de TikTok llega a widgets, niveles, actividad y feed con platform=tiktok", async () => {
  const { chat, widgetCalls, levelCalls, feed, activity, adapter } = await setupPipeline()
  chat("hola a todos")

  assert.equal(widgetCalls.length, 1)
  assert.equal(widgetCalls[0][0], "lunatok")
  assert.equal(widgetCalls[0][3], "tiktok")
  assert.equal(widgetCalls[0][4], "777")

  assert.deepEqual(levelCalls[0], ["lunatok", "777", "tiktok"])
  assert.equal(feed[0].platform, "tiktok")
  assert.equal(activity.getActiveViewerIdentities()[0].platform, "tiktok")
  adapter.disconnect()
})

test("un comando de TikTok responde por el panel local, ya que TikTok no puede recibir chat", async () => {
  const { chat, local, overlays, adapter } = await setupPipeline()
  chat("hola")
  chat("!puntos")
  assert.equal(local.length, 1)
  assert.equal(local[0].platform, "tiktok")
  assert.match(local[0].text, /puntos/)
  // Y tambien en el overlay (cartel de respuestas, no la alerta de arriba).
  const alerts = overlays.filter(item => item.type === "reply_toast")
  assert.equal(alerts.length, 1)
  assert.match(alerts[0].text, /puntos/)
  adapter.disconnect()
})

test("la economia de TikTok usa la identidad de TikTok y no la mezcla con Twitch", async () => {
  const { chat, economy, adapter } = await setupPipeline()
  chat("hola")
  assert.ok(tiktokWallet(economy))
  assert.equal(economy.getViewer("lunatok", "twitch"), undefined)
  adapter.disconnect()
})

test("ruleta y slots del casino funcionan con TikTok y mueven solo su cartera", async () => {
  const { chat, economy, overlays, local, adapter } = await setupPipeline()
  chat("hola")
  economy.addPointsFor({ platform: "tiktok", platformUserId: "777", username: "lunatok" }, 1000, "prueba")
  const before = tiktokWallet(economy).points

  chat("!ruleta 100 rojo")
  chat("!slots 50")
  assert.ok(overlays.some(payload => payload.type === "game_roulette"))
  assert.ok(overlays.some(payload => payload.type === "game_slots"))
  assert.ok(local.length >= 2)
  assert.notEqual(tiktokWallet(economy).points, before)
  assert.equal(economy.getViewer("lunatok", "twitch"), undefined)
  adapter.disconnect()
})

test("blackjack: una partida de TikTok y otra de Twitch con el mismo nombre no se pisan", async () => {
  const { chat, economy, games, engine, overlays, adapter } = await setupPipeline()
  const realRandom = Math.random
  // Baraja determinista: con 0.3 ningun jugador saca blackjack natural (con 0.5 si),
  // lo que terminaria la partida al unirse y haria el test intermitente.
  Math.random = () => 0.3
  try {
    games.bjOpen()
    chat("hola")
    economy.addPointsFor({ platform: "tiktok", platformUserId: "777", username: "lunatok" }, 1000, "prueba")
    economy.addPointsFor({ platform: "twitch", platformUserId: "t1", username: "lunatok" }, 1000, "prueba")

    chat("!bj 100")
    engine.emit({
      platform: "twitch", type: "chat_message", id: "tw-1",
      actor: { platformUserId: "t1", username: "lunatok", displayName: "Luna" },
      message: { text: "!bj 100" }, metadata: { capabilities: { reply: true } }, reply: () => {},
    })
    const tiktokAfterJoin = tiktokWallet(economy).points
    assert.equal(tiktokAfterJoin, 900 + 2, "la apuesta de TikTok se descuenta una sola vez (mas 2 pts del primer chat)")
    assert.equal(economy.getViewer("lunatok", "twitch").points, 900)

    chat("!stand")
    const finished = overlays.filter(payload => payload.type === "game_bj")
    assert.equal(finished.length, 1, "solo termina la partida de TikTok")
    assert.equal(economy.getViewer("lunatok", "twitch").points, 900, "la de Twitch sigue en juego")
  } finally {
    Math.random = realRandom
  }
  adapter.disconnect()
})

test("!nivel responde en TikTok aunque el evento no traiga metadata.channel", async () => {
  const { chat, local, adapter } = await setupPipeline()
  chat("hola")
  chat("!nivel")
  await new Promise(resolve => setImmediate(resolve))
  assert.match(local.at(-1).text, /Nivel 2/)
  adapter.disconnect()
})

test("los regalos, likes y follows no se cuentan como chat para widgets ni comandos", async () => {
  const { emitter, widgetCalls, local, overlays, adapter } = await setupPipeline()
  emitter.emit("follow", { user: { idStr: "9", displayId: "nuevo", nickname: "Nuevo" } })
  emitter.emit("like", { user: { idStr: "9", displayId: "nuevo", nickname: "Nuevo" }, count: 3, total: "3" })
  assert.equal(widgetCalls.length, 0)
  assert.equal(local.length, 0)
  assert.equal(overlays.length, 0)
  adapter.disconnect()
})

// Garantia estructural: el nucleo, los juegos y los widgets no conocen Twitch.
test("ningun consumidor, juego ni widget depende de tmi.js ni del adaptador de Twitch", () => {
  const files = [
    "src/core/interactions/command-engine.js",
    "src/core/interactions/activity-consumer.js",
    "src/core/interactions/chat-activity-consumers.js",
    "src/core/interactions/sound-trigger-engine.js",
    "src/core/events/event-engine.js",
    "src/core/events/event-normalizer.js",
    "src/services/games.js",
    "src/services/widgets.js",
    "src/services/levels.js",
    "src/services/afk.js",
    "src/services/economy.js",
    "src/services/events.js",
    "src/services/shop.js",
    "src/services/gifts.js",
    "src/services/ranks.js",
    "src/services/roulette.js",
  ]
  for (const relativePath of files) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8")
    assert.doesNotMatch(source, /require\(["'][^"']*(tmi\.js|twitch-adapter|services\/twitch|\.\/twitch)(\.js)?["']\)/, `${relativePath} no debe requerir Twitch`)
  }
})
