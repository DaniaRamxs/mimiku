// Prueba de la pregunta de cierre de la Fase 0: ¿puede un segundo adaptador
// (aquí, uno falso que simula Social Stream Ninja) emitir un chat_message al
// Event Engine sin modificar Command Engine ni Sound Trigger Engine?
const test = require("node:test")
const assert = require("node:assert/strict")

const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const { registerSoundTriggerEngine } = require("../src/core/interactions/sound-trigger-engine.js")

test("un segundo adaptador (no-Twitch) puede emitir chat_message sin tocar Command/Sound Engine", () => {
  const engine = createEventEngine()
  const replies = []
  const soundCalls = []

  // Se registran EXACTAMENTE los mismos módulos que usa Twitch, sin ninguna
  // modificación ni bifurcación por plataforma.
  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 42 }), addPoints: () => ({}) },
    games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
  })
  registerSoundTriggerEngine(engine, { onMessage: (text, platform) => soundCalls.push({ text, platform }) })

  // Adaptador falso de una fuente distinta a Twitch (simula un futuro
  // SocialStreamNinjaAdapter): emite el mismo contrato de evento normalizado.
  function fakeYouTubeAdapterEmit(text, reply) {
    engine.emit({
      platform: "youtube",
      type: "chat_message",
      actor: { platformUserId: "yt-1", username: "lunayt", displayName: "LunaYT" },
      message: { text },
      reply,
    })
  }

  fakeYouTubeAdapterEmit("!puntos", msg => replies.push(msg))
  fakeYouTubeAdapterEmit("jaja bien", () => {})

  assert.equal(replies.length, 1)
  assert.match(replies[0], /tenés 42 puntos/)
  assert.deepEqual(soundCalls, [{ text: "jaja bien", platform: "youtube" }])
})
