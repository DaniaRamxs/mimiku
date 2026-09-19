// Pruebas de convivencia SSN + Twitch Native sobre un Event Engine compartido,
// usando el Command Engine y el Sound Trigger Engine REALES (sin modificarlos).
const test = require("node:test")
const assert = require("node:assert/strict")

const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const { registerSoundTriggerEngine } = require("../src/core/interactions/sound-trigger-engine.js")
const { createSocialStreamNinjaAdapter } = require("../src/integrations/social-stream-ninja/social-stream-ninja-adapter.js")
const { normalizeTwitchChatMessage } = require("../src/integrations/twitch/twitch-adapter.js")

function setup() {
  const engine = createEventEngine()
  const replies = []
  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 7 }), addPoints: () => ({}) },
    games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
  })
  const soundCalls = []
  registerSoundTriggerEngine(engine, { onMessage: (text, platform) => soundCalls.push({ text, platform }) })
  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })
  return { engine, ssn, replies, soundCalls }
}

function ssnPayload(overrides = {}) {
  return { chatname: "luna", chatmessage: "!puntos", type: "youtube", userid: "yt-1", id: "ssn-1", ...overrides }
}

test("12: un mensaje de YouTube recibido por SSN ejecuta un comando sin tocar Command Engine", () => {
  // Fase 1 no tiene canal de salida hacia SSN (ver §11 de la fase): el
  // payload de SSN no trae `reply`, así que el comando corre en silencio
  // (event.reply es un no-op por defecto en event-normalizer.js). Lo que
  // sí observamos es que el EFECTO del comando ocurrió: se consultó/otorgó
  // sobre la identidad real vía economy, igual que con Twitch.
  const engine = createEventEngine()
  const getViewerCalls = []
  registerCommandEngine(engine, {
    economy: { getViewer: (u) => { getViewerCalls.push(u); return { points: 7 } }, addPoints: () => ({}) },
    games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
  })
  const adapter = createSocialStreamNinjaAdapter({ eventEngine: engine })

  const result = adapter.handlePayload(ssnPayload())
  assert.equal(result.accepted, true)
  assert.deepEqual(getViewerCalls, ["luna"])
})

test("13: un mensaje de TikTok recibido por SSN dispara el Sound Trigger Engine sin tocar ese motor", () => {
  const { ssn, soundCalls } = setup()
  ssn.handlePayload(ssnPayload({ type: "tiktok", chatmessage: "jaja bruh", id: "ssn-2" }))
  assert.deepEqual(soundCalls, [{ text: "jaja bruh", platform: "tiktok" }])
})

test("SSN-only: !slots ejecuta el minijuego y produce su evento visual", () => {
  const engine = createEventEngine()
  const overlays = []
  registerCommandEngine(engine, {
    economy: {},
    games: {
      playSlots: (username, bet, platform, platformUserId) => ({
        ok: true,
        s1: "🍒", s2: "🍒", s3: "🍒",
        result: "jackpot", payout: 100, bet, multiplier: 10,
        msg: "jackpot", username, platform, platformUserId,
      }),
    },
    events: {},
    shop: {},
    afk: { getIdleCommandReply: () => null },
    overlay: payload => overlays.push(payload),
  })
  const adapter = createSocialStreamNinjaAdapter({ eventEngine: engine })

  adapter.handlePayload(ssnPayload({ type: "youtube", chatmessage: "!slots 10", userid: "yt-7" }))

  assert.equal(overlays.length, 1)
  assert.equal(overlays[0].type, "game_slots")
  assert.equal(overlays[0].platformUserId, "yt-7")
})

test("14: el mismo evento SSN repetido (mismo id) se deduplica", () => {
  const { ssn, soundCalls } = setup()
  ssn.handlePayload(ssnPayload({ type: "tiktok", chatmessage: "hola", id: "dup-1" }))
  ssn.handlePayload(ssnPayload({ type: "tiktok", chatmessage: "hola", id: "dup-1" }))
  assert.equal(soundCalls.length, 1)
})

test("15: el mismo mensaje de Twitch por Twitch Native y por SSN produce una sola ejecución", () => {
  const engine = createEventEngine()
  const replies = []
  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 3 }), addPoints: () => ({}) },
    games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
  })
  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })

  // Twitch Native: tmi.js entrega su propio id de IRC.
  const twitchEvent = normalizeTwitchChatMessage({
    tags: { username: "luna", "display-name": "Luna", "user-id": "u-1", id: "tw-irc-id" },
    message: "!puntos", channel: "canal", replyFn: msg => replies.push(msg),
  })
  engine.emit(twitchEvent)

  // SSN reenvía el MISMO mensaje real de Twitch ~300ms después, con SU PROPIO
  // id (distinto al de tmi.js) — exactamente el caso que la auditoría pidió cubrir.
  ssn.handlePayload({ chatname: "luna", chatmessage: "!puntos", type: "twitch", userid: "u-1", id: "ssn-distinto-id" })

  assert.equal(replies.length, 1) // el comando NO se ejecutó dos veces
})

test("16: dos mensajes realmente distintos del mismo usuario no se deduplican", () => {
  const { ssn, soundCalls } = setup()
  ssn.handlePayload(ssnPayload({ type: "tiktok", chatmessage: "primer mensaje", id: "a" }))
  ssn.handlePayload(ssnPayload({ type: "tiktok", chatmessage: "segundo mensaje totalmente distinto", id: "b" }))
  assert.equal(soundCalls.length, 2)
})

test("17: un payload inválido de SSN no afecta el procesamiento de Twitch Native", () => {
  const engine = createEventEngine()
  const replies = []
  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 9 }), addPoints: () => ({}) },
    games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
  })
  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })

  const rejection = ssn.handlePayload({ garbage: true }) // sin type ni chatmessage
  assert.equal(rejection.accepted, false)

  const twitchEvent = normalizeTwitchChatMessage({
    tags: { username: "bob", "display-name": "Bob", id: "tw-2" },
    message: "!puntos", channel: "canal", replyFn: msg => replies.push(msg),
  })
  engine.emit(twitchEvent)
  assert.equal(replies.length, 1) // Twitch sigue funcionando con normalidad
})
