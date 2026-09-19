const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeTwitchChatMessage, isMod, isVip } = require("../src/integrations/twitch/twitch-adapter.js")

test("normaliza un mensaje de tmi.js al contrato interno de Mimiku", () => {
  const tags = {
    username: "luna", "display-name": "Luna", "user-id": "12345",
    id: "msg-abc", color: "#ff0000", mod: false, badges: { subscriber: "1" },
  }
  const event = normalizeTwitchChatMessage({ tags, message: "hola mundo", channel: "streamer", replyFn: () => {} })

  assert.equal(event.platform, "twitch")
  assert.equal(event.type, "chat_message")
  assert.equal(event.id, "msg-abc")
  assert.deepEqual(event.actor, {
    platformUserId: "12345", username: "luna", displayName: "Luna", avatarUrl: "", isModerator: false,
  })
  assert.equal(event.message.text, "hola mundo")
  assert.equal(event.metadata.channel, "streamer")
  assert.equal(typeof event.reply, "function")
})

test("sin display-name/user-id/id, cae a defaults razonables", () => {
  const event = normalizeTwitchChatMessage({ tags: { username: "bob" }, message: "hi", channel: "c" })
  assert.equal(event.id, null)
  assert.equal(event.actor.displayName, "bob")
  assert.equal(event.actor.platformUserId, "")
})

test("isMod reconoce mod, broadcaster y user-type mod", () => {
  assert.equal(isMod({ mod: true }), true)
  assert.equal(isMod({ badges: { broadcaster: "1" } }), true)
  assert.equal(isMod({ "user-type": "mod" }), true)
  assert.equal(!!isMod({}), false)
})

test("normaliza la insignia VIP de Twitch en el actor", () => {
  const event = normalizeTwitchChatMessage({
    tags: { username: "luna", badges: { vip: "1" } },
    message: "hola",
    channel: "c",
  })
  assert.equal(isVip({ badges: { vip: "1" } }), true)
  assert.equal(event.actor.isVip, true)
})
