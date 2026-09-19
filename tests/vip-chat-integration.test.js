const test = require("node:test")
const assert = require("node:assert/strict")

const { createEventEngine } = require("../src/core/events/event-engine.js")
const { createVipService } = require("../src/services/vips.js")
const { createXpConsumer } = require("../src/core/interactions/chat-activity-consumers.js")

test("el flujo de chat conserva el badge VIP, paga puntos y emite una alerta una sola vez", () => {
  let now = 1000
  const economyCalls = []
  const broadcasts = []
  const service = createVipService({
    now: () => now,
    broadcast: payload => broadcasts.push(payload),
    config: {
      vipPointsPerMessage: 11,
      sounds: [{ id: "vip", file: "vip.mp3", command: "!bruh", cooldown_s: 30, volume: 0.5 }],
    },
  })
  const xp = createXpConsumer({
    economy: { onMessage: (...args) => economyCalls.push(args) },
    events: { isEconomyFrozen: () => false, getMultiplier: () => 1 },
    getPointsPerMessage: event => service.pointsPerMessage(event, 2),
  })
  const engine = createEventEngine()
  engine.subscribe("chat_message", event => service.onMessage(event))
  engine.subscribe("chat_message", xp.handle)

  const event = {
    id: "vip-chat-1",
    platform: "twitch",
    type: "chat_message",
    actor: {
      platformUserId: "tw-1",
      username: "luna",
      displayName: "Luna",
      isVip: true,
    },
    message: { text: "hola" },
  }
  engine.emit(event)
  engine.emit({ ...event, id: "vip-chat-2", message: { text: "!bruh" } })

  assert.equal(economyCalls.length, 1)
  assert.equal(economyCalls[0][2], 11)
  assert.equal(broadcasts.length, 1)
  now += 30_000
  engine.emit({ ...event, id: "vip-chat-3", message: { text: "!bruh otra" } })
  assert.equal(broadcasts.length, 2)
})
