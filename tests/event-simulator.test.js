const test = require("node:test")
const assert = require("node:assert/strict")
const { createEventEngine } = require("../src/core/events/event-engine.js")
const { createEventSimulator } = require("../src/services/event-simulator.js")

test("local simulator emits a normalized fictitious event through Event Engine", () => {
  const eventEngine = createEventEngine()
  const received = []
  eventEngine.subscribe("chat_message", event => received.push(event))
  const simulator = createEventSimulator({
    eventEngine,
    getChannel: () => "local-test",
    createId: () => "fake-id",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  })

  const result = simulator.simulate({ platform: "youtube", text: "hola" })
  assert.equal(result.delivered, true)
  assert.equal(received.length, 1)
  assert.equal(received[0].source, "mimiku-simulator")
  assert.equal(received[0].platform, "youtube")
  assert.equal(received[0].actor.platformUserId, "mimiku-test-viewer")
  assert.equal(received[0].metadata.simulated, true)
})

test("local simulator rejects unknown platforms", () => {
  const simulator = createEventSimulator({ eventEngine: createEventEngine(), getChannel: () => "local-test" })
  assert.throws(() => simulator.simulate({ platform: "unknown", text: "hola" }), /no permitida/)
})
