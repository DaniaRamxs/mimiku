const test = require("node:test")
const assert = require("node:assert/strict")

const { createEventEngine } = require("../src/core/events/event-engine.js")

test("an asynchronously rejected consumer is isolated and reported", async () => {
  const errors = []
  const engine = createEventEngine({ onError: error => errors.push(error.message) })
  let delivered = 0
  engine.subscribe("chat_message", async () => { throw new Error("async boom") })
  engine.subscribe("chat_message", () => { delivered++ })

  const result = engine.emit({
    id: "evt-async",
    platform: "youtube",
    type: "chat_message",
    actor: { platformUserId: "yt-1", username: "luna" },
    message: { text: "hola" },
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(result.handled, 2)
  assert.equal(delivered, 1)
  assert.deepEqual(errors, ["async boom"])
})

