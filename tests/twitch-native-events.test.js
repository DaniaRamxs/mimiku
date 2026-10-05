const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeTwitchNativeEvent } = require("../src/integrations/twitch/twitch-adapter.js")
const { createEventEngine } = require("../src/core/events/event-engine.js")

test("un cheer de Twitch llega al Event Engine con los bits en el payload", () => {
  const engine = createEventEngine()
  const seen = []
  engine.subscribe("cheer", event => seen.push(event))
  engine.emit(normalizeTwitchNativeEvent("cheer", {
    tags: { id: "m1", "display-name": "Luna", "user-id": "7", badges: { subscriber: "1" } },
    username: "luna", payload: { bits: 300 },
  }))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].id, "twitch-cheer:m1")
  assert.deepEqual(seen[0].payload, { bits: 300 })
  assert.equal(seen[0].actor.displayName, "Luna")
  assert.equal(seen[0].actor.isSubscriber, true)
})

test("un raid sin tags tiene un actor valido y sin id", () => {
  const event = normalizeTwitchNativeEvent("raid", { username: "amiga", payload: { viewers: 25 } })
  assert.equal(event.id, null)
  assert.equal(event.actor.displayName, "amiga")
  assert.equal(event.actor.isModerator, false)
})

test("dos subs regalados distintos del mismo viewer no se toman por duplicados", () => {
  const engine = createEventEngine()
  let count = 0
  engine.subscribe("subgift", () => count++)
  engine.emit(normalizeTwitchNativeEvent("subgift", { username: "ana", payload: { count: 1, recipient: "bea" } }))
  engine.emit(normalizeTwitchNativeEvent("subgift", { username: "ana", payload: { count: 1, recipient: "carla" } }))
  assert.equal(count, 2)
})
