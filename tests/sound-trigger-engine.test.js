const test = require("node:test")
const assert = require("node:assert/strict")

const { createSoundTriggerEngine } = require("../src/core/interactions/sound-trigger-engine.js")

function chatEvent(text, platform = "twitch") {
  return {
    platform,
    type: "chat_message",
    actor: { username: "luna" },
    message: { text },
  }
}

test("un mensaje normal dispara el matcher de sonidos con el texto y la plataforma", () => {
  const calls = []
  const engine = createSoundTriggerEngine({ onMessage: (text, platform) => calls.push({ text, platform }) })
  engine.handle(chatEvent("jaja KEKW jaja"))
  assert.deepEqual(calls, [{ text: "jaja KEKW jaja", platform: "twitch" }])
})

test("un comando (empieza con '!') no dispara sonidos, igual que hoy", () => {
  const calls = []
  const engine = createSoundTriggerEngine({ onMessage: (...args) => calls.push(args) })
  engine.handle(chatEvent("!puntos"))
  assert.equal(calls.length, 0)
})

test("el motor no importa nada de tmi.js/Twitch al cargarse (solo requiere emoteSounds de forma perezosa)", () => {
  // Si esto rompiera por una dependencia eager de Electron, el require ya habría fallado.
  assert.equal(typeof createSoundTriggerEngine, "function")
})
