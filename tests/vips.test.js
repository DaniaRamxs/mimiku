const test = require("node:test")
const assert = require("node:assert/strict")

const { createVipService, decodeAudioData, normalizeCommand } = require("../src/services/vips.js")

function chatEvent({
  username = "luna",
  platform = "twitch",
  text = "hola",
  isVip = true,
} = {}) {
  return {
    platform,
    type: "chat_message",
    actor: {
      platformUserId: platform + "-1",
      username,
      displayName: username,
      isVip,
    },
    message: { text },
  }
}

test("VIP points are configurable while regular viewers keep the base value", () => {
  const service = createVipService({
    config: { vipPointsPerMessage: 9 },
  })

  assert.equal(service.pointsPerMessage(chatEvent(), 2), 9)
  assert.equal(service.pointsPerMessage(chatEvent({ isVip: false }), 2), 2)
})

test("VIP alert commands are normalized with a leading exclamation", () => {
  assert.equal(normalizeCommand("bruh"), "!bruh")
  assert.equal(normalizeCommand("!BRUH"), "!bruh")
  assert.equal(normalizeCommand("hola mundo"), "")
})

test("configured VIP identities work when the platform does not provide a badge", () => {
  const service = createVipService({
    config: {
      users: [{ username: "Luna", platform: "youtube" }],
      vipPointsPerMessage: 7,
    },
  })

  assert.equal(service.isVip(chatEvent({ platform: "youtube", isVip: false })), true)
  assert.equal(service.isVip(chatEvent({ platform: "twitch", isVip: false })), false)
  assert.equal(service.pointsPerMessage(chatEvent({ platform: "youtube", isVip: false }), 2), 7)
})

test("VIP sound commands reject non-VIPs and report the remaining cooldown", () => {
  let now = 1_000
  const broadcasts = []
  const replies = []
  const service = createVipService({
    now: () => now,
    broadcast: payload => broadcasts.push(payload),
    reply: (_, message) => replies.push(message),
    config: {
      sounds: [{
        id: "welcome",
        file: "vip-welcome.mp3",
        command: "!bruh",
        url: "http://127.0.0.1:7777/audio/vip-welcome.mp3",
        cooldown_s: 10,
        volume: 0.65,
      }],
    },
  })

  assert.equal(service.onMessage(chatEvent({ text: "!bruh", isVip: false })).length, 0)
  assert.match(replies[0], /no eres VIP/i)
  assert.equal(service.onMessage(chatEvent({ text: "!bruh" })).length, 1)
  assert.equal(service.onMessage(chatEvent({ text: "!bruh otra vez" })).length, 0)
  assert.match(replies[1], /esperar 10 segundos/i)
  assert.equal(service.onMessage(chatEvent({ text: "hola" })).length, 0)
  assert.equal(service.onMessage(chatEvent({ text: "!otro", isVip: false })).length, 0)
  now += 10_000
  assert.equal(service.onMessage(chatEvent({ text: "!bruh" })).length, 1)
  assert.deepEqual(broadcasts, [
    {
      type: "emote_sound",
      url: "http://127.0.0.1:7777/audio/vip-welcome.mp3",
      volume: 0.65,
    },
    {
      type: "emote_sound",
      url: "http://127.0.0.1:7777/audio/vip-welcome.mp3",
      volume: 0.65,
    },
  ])
})

test("VIP denial uses the normalized event reply when no callback is injected", () => {
  const replies = []
  const service = createVipService({
    config: { sounds: [{ id: "reply", command: "!bruh", url: "https://example.test/reply.mp3" }] },
  })
  const event = chatEvent({ text: "!bruh", isVip: false })
  event.reply = message => replies.push(message)

  assert.deepEqual(service.onMessage(event), [])
  assert.match(replies[0], /no eres VIP/i)
})

test("VIP service clamps invalid points, cooldown, and volume values", () => {
  const service = createVipService({
    config: {
      vipPointsPerMessage: -3,
      sounds: [{ id: "bad", file: "bad.mp3", command: "!bad", cooldown_s: -4, volume: 4 }],
    },
  })
  const config = service.getConfig()

  assert.equal(config.vipPointsPerMessage, 0)
  assert.equal(config.sounds[0].cooldown_s, 0)
  assert.equal(config.sounds[0].volume, 1)
})

test("VIP sound alerts skip files that disappeared from disk", () => {
  const service = createVipService({
    fileExists: () => false,
    config: { sounds: [{ id: "missing", file: "missing.mp3", command: "!missing", cooldown_s: 0 }] },
  })

  assert.deepEqual(service.onMessage(chatEvent()), [])
})

test("VIP command info lists only active commands for the current platform", () => {
  const service = createVipService({
    config: {
      enabled: true,
      sounds: [
        { id: "all", command: "!hola", url: "https://example.test/hola.mp3", platform: "all" },
        { id: "twitch", command: "!twitch", url: "https://example.test/twitch.mp3", platform: "twitch" },
        { id: "youtube", command: "!youtube", url: "https://example.test/youtube.mp3", platform: "youtube" },
        { id: "off", command: "!off", url: "https://example.test/off.mp3", platform: "all", enabled: false },
        { id: "duplicate", command: "!hola", url: "https://example.test/hola-2.mp3", platform: "all" },
      ],
    },
  })

  assert.deepEqual(service.getCommandNames("twitch"), ["!hola", "!twitch"])
  assert.deepEqual(service.getCommandNames("youtube"), ["!hola", "!youtube"])
})

test("VIP command info is empty when VIP benefits are disabled", () => {
  const service = createVipService({
    config: {
      enabled: false,
      sounds: [{ id: "off", command: "!off", url: "https://example.test/off.mp3" }],
    },
  })

  assert.deepEqual(service.getCommandNames("twitch"), [])
})

test("VIP audio upload rejects oversized or malformed base64 before decoding", () => {
  assert.throws(() => decodeAudioData("%%%"), /base64 válido/)
  assert.throws(() => decodeAudioData("A".repeat(14_000_000)), /entre 1 byte y 10 MB/)
})
