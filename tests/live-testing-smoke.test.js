// Fase 1.6 — Live Testing Readiness: smoke tests de los flujos críticos para
// el primer Multistream Technical Alpha. A diferencia de los tests de
// unidad de fases anteriores, estos usan la función de registro REAL
// (registerChatActivityConsumers) tal como la llama overlay-server.js#start(),
// no cada sub-consumidor por separado — para probar el cableado de
// producción, no solo las piezas.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const { registerSoundTriggerEngine } = require("../src/core/interactions/sound-trigger-engine.js")
const { createActivityTracker, registerActivityConsumer } = require("../src/core/interactions/activity-consumer.js")
const { registerChatActivityConsumers } = require("../src/core/interactions/chat-activity-consumers.js")
const { createSocialStreamNinjaAdapter } = require("../src/integrations/social-stream-ninja/social-stream-ninja-adapter.js")
const { normalizeTwitchChatMessage } = require("../src/integrations/twitch/twitch-adapter.js")

// Simula exactamente lo que overlay-server.js#start() registra al arrancar
// Mimiku — sin Supabase, sin Twitch conectado, sin SSN configurado. Todas
// las dependencias reales (economy/levels/widgets/afk/events/games/shop) se
// inyectan como fakes: esta suite prueba el CABLEADO, no la lógica de cada
// servicio (ya cubierta en las fases anteriores).
function bootMimiku() {
  const engine = createEventEngine()
  const chatFeed = []
  const soundCalls = []
  const commandReplies = []

  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 0 }), addPoints: () => ({}) },
    games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
    afk: { getIdleCommandReply: () => null },
  })
  registerSoundTriggerEngine(engine, { onMessage: (text, platform) => soundCalls.push({ text, platform }) })

  const activity = createActivityTracker()
  registerActivityConsumer(engine, activity)

  registerChatActivityConsumers(engine, {
    xp: { economy: { onMessage: () => {} }, events: { isEconomyFrozen: () => false, getMultiplier: () => 1 } },
    levels: { levels: { onMessage: () => {} } },
    widgets: { widgets: { onChatMessage: () => Promise.resolve() } },
    afk: { afk: { onMessage: () => {} } },
    challenge: { economy: { addPoints: () => {} }, announce: () => {} },
    chatFeed: { notify: (channel, payload) => { if (channel === "chat:message") chatFeed.push(payload) } },
  })

  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })
  return { engine, activity, chatFeed, soundCalls, ssn }
}

test("Clean start: Mimiku registra todos los consumidores sin config previa, sin Supabase, sin Twitch ni SSN configurados", () => {
  assert.doesNotThrow(() => bootMimiku())
  assert.equal(process.env.MIMIKU_SUPABASE_URL, undefined)
})

test("SSN-only: un evento de YouTube por SSN aparece en el chat y en activity sin cargar Twitch Adapter", () => {
  const { chatFeed, activity, ssn } = bootMimiku()
  ssn.handlePayload({ chatname: "kira", chatmessage: "buenas", type: "youtube", userid: "yt-1", id: "ssn-1" })

  assert.equal(chatFeed.length, 1)
  assert.equal(chatFeed[0].platform, "youtube")
  assert.equal(chatFeed[0].displayName, "kira")
  assert.equal(activity.getActiveViewerIdentities().length, 1)
})

test("SSN-only: Emote Sounds se inicializa al arrancar sin depender de twitch:connect", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "..", "main.cjs"), "utf8")
  const readyStart = main.indexOf("app.whenReady()")
  const windowLoad = main.indexOf('win.loadFile("src/index.html")', readyStart)
  const startup = main.slice(readyStart, windowLoad)

  assert.notEqual(readyStart, -1)
  assert.ok(windowLoad > readyStart)
  assert.match(
    startup,
    /emoteSounds\.init\(payload => overlay\(\)\.broadcast\(payload\)\)/,
  )
})

test("SSN-only: el Command Engine de producción envía los minijuegos al overlay", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "services", "overlay-server.js"),
    "utf8",
  )
  const commandRegistration = source.indexOf("registerCommandEngine(eventEngine")
  const soundRegistration = source.indexOf("registerSoundTriggerEngine(eventEngine", commandRegistration)
  const wiring = source.slice(commandRegistration, soundRegistration)

  assert.notEqual(commandRegistration, -1)
  assert.ok(soundRegistration > commandRegistration)
  assert.match(wiring, /overlay:\s*broadcast/)
})

test("Twitch-only: un mensaje de Twitch aparece en el chat, activity y dispara Sound Trigger Engine", () => {
  const { engine, chatFeed, activity, soundCalls } = bootMimiku()
  const event = normalizeTwitchChatMessage({
    tags: { username: "luna", "display-name": "Luna", "user-id": "tw-1", id: "tw-irc-1", color: "#fff" },
    message: "jajaja", channel: "canal",
  })
  engine.emit(event)

  assert.equal(chatFeed.length, 1)
  assert.equal(chatFeed[0].platform, "twitch")
  assert.equal(activity.getActiveViewerIdentities().length, 1)
  assert.deepEqual(soundCalls, [{ text: "jajaja", platform: "twitch" }])
})

test("Dual input: Twitch Native + SSN-Twitch duplicado se ve en el chat UNA sola vez", () => {
  const { engine, chatFeed, ssn } = bootMimiku()
  const twitchEvent = normalizeTwitchChatMessage({
    tags: { username: "luna", "display-name": "Luna", "user-id": "tw-1", id: "tw-irc-1" },
    message: "hola de nuevo", channel: "canal",
  })
  engine.emit(twitchEvent)
  ssn.handlePayload({ chatname: "luna", chatmessage: "hola de nuevo", type: "twitch", userid: "tw-1", id: "ssn-distinto" })

  assert.equal(chatFeed.length, 1)
})

test("Multistream: Twitch/YouTube/TikTok Luna generan 3 mensajes con 3 identidades correctamente etiquetadas", () => {
  const { chatFeed, activity, ssn } = bootMimiku()
  ssn.handlePayload({ chatname: "luna", chatmessage: "hola", type: "twitch", userid: "tw-1", id: "a" })
  ssn.handlePayload({ chatname: "luna", chatmessage: "hola", type: "youtube", userid: "yt-1", id: "b" })
  ssn.handlePayload({ chatname: "luna", chatmessage: "hola", type: "tiktok", userid: "tt-1", id: "c" })

  assert.equal(chatFeed.length, 3)
  assert.deepEqual(chatFeed.map(m => m.platform).sort(), ["tiktok", "twitch", "youtube"])
  assert.equal(activity.getActiveViewerIdentities().length, 3)
})
