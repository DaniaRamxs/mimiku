const test = require("node:test")
const assert = require("node:assert/strict")

const { createEventEngine } = require("../src/core/events/event-engine.js")
const { normalizeEvent } = require("../src/core/events/event-normalizer.js")

function chatEvent(overrides = {}) {
  return {
    platform: "twitch",
    type: "chat_message",
    actor: { platformUserId: "u1", username: "luna" },
    message: { text: "hola" },
    ...overrides,
  }
}

test("normalizeEvent rellena defaults y valida campos mínimos", () => {
  const event = normalizeEvent(chatEvent())
  assert.equal(event.source, "twitch-native")
  assert.equal(event.actor.displayName, "luna")
  assert.deepEqual(event.message.emotes, [])
  assert.equal(typeof event.reply, "function")
  assert.throws(() => normalizeEvent({ type: "chat_message" }), /platform/)
  assert.throws(() => normalizeEvent({ platform: "twitch" }), /type/)
})

test("normalizeEvent conserva la marca de suscriptor del adaptador", () => {
  const sub = normalizeEvent({ ...chatEvent(), actor: { username: "luna", isSubscriber: true } })
  assert.equal(sub.actor.isSubscriber, true)
  const viewer = normalizeEvent(chatEvent())
  assert.equal("isSubscriber" in viewer.actor, false)
})

test("Event Engine distribuye un evento a los suscriptores de su tipo", () => {
  const engine = createEventEngine()
  const received = []
  engine.subscribe("chat_message", event => received.push(event.message.text))
  engine.subscribe("other_type", () => received.push("no debería llamarse"))

  const result = engine.emit(chatEvent())

  assert.equal(result.delivered, true)
  assert.equal(result.handled, 1)
  assert.deepEqual(received, ["hola"])
})

test("un consumidor que falla no impide que otros reciban el evento", () => {
  const engine = createEventEngine()
  const received = []
  engine.subscribe("chat_message", () => { throw new Error("consumidor roto") })
  engine.subscribe("chat_message", event => received.push(event.actor.username))

  const result = engine.emit(chatEvent())

  assert.equal(result.handled, 1) // solo el segundo consumidor se contó como exitoso
  assert.deepEqual(received, ["luna"])
})

test("deduplicación primaria por (platform, id): un id repetido se procesa una sola vez", () => {
  const engine = createEventEngine()
  let count = 0
  engine.subscribe("chat_message", () => count++)

  const first = engine.emit(chatEvent({ id: "msg-1" }))
  const second = engine.emit(chatEvent({ id: "msg-1", message: { text: "hola otra vez" } }))

  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(count, 1)
})

test("fallback de deduplicación sin id: mismo actor y texto dentro de la ventana temporal se deduplica", async () => {
  const engine = createEventEngine({ dedupWindowMs: 40 })
  let count = 0
  engine.subscribe("chat_message", () => count++)

  engine.emit(chatEvent())
  engine.emit(chatEvent()) // mismo actor+texto, sin id, dentro de la ventana → duplicado
  assert.equal(count, 1)

  await new Promise(resolve => setTimeout(resolve, 60)) // pasa la ventana de 40ms

  engine.emit(chatEvent()) // fuera de la ventana → ya no es duplicado
  assert.equal(count, 2)
})

test("dos mensajes distintos del mismo usuario no se deduplican incorrectamente", () => {
  const engine = createEventEngine()
  let count = 0
  engine.subscribe("chat_message", () => count++)

  engine.emit(chatEvent({ message: { text: "hola" } }))
  engine.emit(chatEvent({ message: { text: "chau" } }))

  assert.equal(count, 2)
})
