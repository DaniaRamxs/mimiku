// Fase 1.5 — pruebas de alto nivel: deduplicación entre Twitch Native y SSN
// a través de los NUEVOS consumidores de actividad, equivalencia entre
// Twitch/YouTube/TikTok, y el invariante de que Mimiku funciona sin Twitch.
const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const { registerSoundTriggerEngine } = require("../src/core/interactions/sound-trigger-engine.js")
const { createActivityTracker, registerActivityConsumer } = require("../src/core/interactions/activity-consumer.js")
const {
  createXpConsumer, createLevelsConsumer, createWidgetsConsumer, createChallengeConsumer,
} = require("../src/core/interactions/chat-activity-consumers.js")
const { createSocialStreamNinjaAdapter } = require("../src/integrations/social-stream-ninja/social-stream-ninja-adapter.js")
const { normalizeTwitchChatMessage } = require("../src/integrations/twitch/twitch-adapter.js")

// levels.js usa el singleton de src/services/local-runtime.js (que en
// producción abre SQLite vía Electron); se stubea su module cache con un
// getLocalPlatform() que devuelve la instancia en memoria de este test —
// misma técnica de las Fases 1.4/1.45. economy.js se construye directo con
// createEconomyService (evita el singleton y su fallback a app-config.js,
// que también toca Electron si no hay canal configurado).
const { createEconomyService } = require("../src/services/economy.js")

function loadRealEconomyAndLevels(platform) {
  const runtimePath = require.resolve("../src/services/local-runtime.js")
  const levelsPath = require.resolve("../src/services/levels.js")

  const savedRuntime = require.cache[runtimePath]
  const savedLevels = require.cache[levelsPath]

  require.cache[runtimePath] = { id: runtimePath, filename: runtimePath, loaded: true, exports: { getLocalPlatform: () => platform } }
  delete require.cache[levelsPath]

  const economy = createEconomyService(platform, () => "canal")
  const levels = require("../src/services/levels.js")
  levels.init("canal", () => {})

  function restore() {
    if (savedRuntime) require.cache[runtimePath] = savedRuntime; else delete require.cache[runtimePath]
    delete require.cache[levelsPath]
    if (savedLevels) require.cache[levelsPath] = savedLevels
  }

  return { economy, levels, restore }
}

function setupFullPipeline({ economy, levels, widgets, challengeAnnounce } = {}) {
  const engine = createEventEngine()
  const commandEconomy = economy || { getViewer: () => ({ points: 0 }), addPoints: () => ({}) }
  registerCommandEngine(engine, { economy: commandEconomy, games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} } })
  registerSoundTriggerEngine(engine, { onMessage: () => {} })

  const activity = createActivityTracker()
  registerActivityConsumer(engine, activity)

  const xp = createXpConsumer({ economy: commandEconomy, events: { isEconomyFrozen: () => false, getMultiplier: () => 1 } })
  const levelsConsumer = createLevelsConsumer(levels ? { levels } : undefined)
  const widgetsConsumer = createWidgetsConsumer({ widgets: widgets || { onChatMessage: () => Promise.resolve() } })
  const challenge = createChallengeConsumer({ economy: commandEconomy, announce: challengeAnnounce || (() => {}) })

  engine.subscribe("chat_message", xp.handle)
  engine.subscribe("chat_message", levelsConsumer.handle)
  engine.subscribe("chat_message", widgetsConsumer.handle)
  engine.subscribe("chat_message", challenge.handle)

  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })
  return { engine, activity, xp, levelsConsumer, widgetsConsumer, challenge, ssn }
}

// ── Deduplicación (18-20) ────────────────────────────────────────────────────
test("18-20: Twitch Native + SSN duplicado otorga XP, avanza challenge y actualiza widget UNA sola vez", () => {
  const xpCalls = []
  const widgetCalls = []
  const economy = {
    getViewer: () => ({ points: 100 }), addPoints: () => ({}),
    onMessage: (...args) => xpCalls.push(args),
  }
  const widgets = { onChatMessage: (...args) => { widgetCalls.push(args); return Promise.resolve() } }
  const { engine, activity, challenge } = setupFullPipeline({ economy, widgets })
  challenge.start("fuego", 0.05, 50)

  const twitchEvent = normalizeTwitchChatMessage({
    tags: { username: "luna", "display-name": "Luna", "user-id": "tw-1", id: "tw-irc-1", color: "#fff" },
    message: "fuego en el chat", channel: "canal",
  })
  engine.emit(twitchEvent)
  // SSN reenvía el MISMO mensaje real de Twitch con SU PROPIO id distinto.
  engine.emit({
    source: "social-stream-ninja", platform: "twitch", type: "chat_message",
    actor: { platformUserId: "tw-1", username: "luna", displayName: "Luna" },
    message: { text: "fuego en el chat" }, metadata: { color: "#fff" }, id: "ssn-distinto-id",
  })

  assert.equal(xpCalls.length, 1)
  assert.equal(widgetCalls.length, 1)
  assert.equal(challenge.getActiveChallenge().winners.size, 1)
  assert.equal(activity.getActiveViewerIdentities().length, 1)
})

// ── Equivalencia entre plataformas (21) ─────────────────────────────────────
test("21: Twitch, YouTube y TikTok con el mismo texto atraviesan Activity/XP/Widgets/Challenge de forma independiente", () => {
  const xpCalls = []
  const widgetCalls = []
  const economy = { getViewer: () => ({ points: 0 }), addPoints: () => ({}), onMessage: (...a) => xpCalls.push(a) }
  const widgets = { onChatMessage: (...a) => { widgetCalls.push(a); return Promise.resolve() } }
  const { engine, activity, challenge } = setupFullPipeline({ economy, widgets })
  challenge.start("hola", 0.05, 10)

  const platforms = [
    { platform: "twitch", platformUserId: "tw-1" },
    { platform: "youtube", platformUserId: "yt-1" },
    { platform: "tiktok", platformUserId: "tt-1" },
  ]
  for (const p of platforms) {
    engine.emit({
      source: `${p.platform}-native`, platform: p.platform, type: "chat_message",
      actor: { platformUserId: p.platformUserId, username: "viewer", displayName: "Viewer" },
      message: { text: "hola a todos" },
    })
  }

  assert.equal(xpCalls.length, 3)
  assert.equal(widgetCalls.length, 3)
  assert.equal(activity.getActiveViewerIdentities().length, 3)
  assert.equal(challenge.getActiveChallenge().winners.size, 3)
  assert.deepEqual(new Set(activity.getActiveViewerIdentities().map(v => v.platform)), new Set(["twitch", "youtube", "tiktok"]))
})

// ── Invariante: sin Twitch (22) ──────────────────────────────────────────────
test("22: un viewer de YouTube por SSN completa Activity + XP + Levels + Widgets sin que twitch-adapter.js se conecte jamás", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const { economy, levels, restore } = loadRealEconomyAndLevels(platform)

  try {
    const widgetCalls = []
    const widgets = { onChatMessage: (...a) => { widgetCalls.push(a); return Promise.resolve() } }
    const { engine, activity } = setupFullPipeline({ economy, levels, widgets })

    const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })
    // Ningún require de twitch-adapter.js/twitch.js ocurrió en esta prueba.
    for (let i = 0; i < 3; i++) {
      ssn.handlePayload({ chatname: "luna", chatmessage: `mensaje ${i}`, type: "youtube", userid: "yt-99", id: `ssn-${i}` })
    }

    // Activity
    const active = activity.getActiveViewerIdentities()
    assert.equal(active.length, 1)
    assert.equal(active[0].platform, "youtube")

    // XP (economía por mensaje)
    const wallet = economy.getViewer("luna", "youtube")
    assert.ok(wallet.points > 0)

    // Levels
    const levelInfo = platform.levels.getViewer("canal", platform.identities.byUsername("luna", "youtube").id)
    assert.ok(levelInfo.xp > 0)

    // Widgets
    assert.ok(widgetCalls.length >= 1)
    assert.equal(widgetCalls[0][3], "youtube")

    // La identidad vive exclusivamente bajo "youtube", nunca "social-stream-ninja".
    const rows = db.prepare("SELECT DISTINCT platform FROM viewer_identities WHERE username='luna'").all()
    assert.deepEqual(rows.map(r => r.platform), ["youtube"])
  } finally {
    restore()
    db.close()
  }
})

test("15 (política): platform=unknown no otorga XP/economía/reto y tampoco crashea", () => {
  const xpCalls = []
  const economy = { onMessage: (...a) => xpCalls.push(a), addPoints: (...a) => xpCalls.push(a) }
  const xp = createXpConsumer({ economy, events: { isEconomyFrozen: () => false, getMultiplier: () => 1 } })
  const levelsCalls = []
  const levelsConsumer = createLevelsConsumer({ levels: { onMessage: (...a) => levelsCalls.push(a) } })
  const challenge = createChallengeConsumer({ economy })
  challenge.start("hola", 0.05, 10)

  const event = { platform: "unknown", type: "chat_message", actor: { username: "anon" }, message: { text: "hola desconocido" } }
  assert.doesNotThrow(() => { xp.handle(event); levelsConsumer.handle(event); challenge.handle(event) })

  assert.equal(xpCalls.length, 0)
  assert.equal(levelsCalls.length, 0)
  assert.equal(challenge.getActiveChallenge().winners.size, 0)
})
