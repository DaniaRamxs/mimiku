const test = require("node:test")
const assert = require("node:assert/strict")

const { createReplyRouter } = require("../src/core/interactions/reply-router.js")

test("reply router prefers a native platform reply when available", () => {
  const native = []
  const local = []
  const reply = createReplyRouter({ notifyLocal: payload => local.push(payload) })
  reply.send({ platform: "twitch", actor: { username: "luna" }, reply: msg => native.push(msg) }, "hola")
  assert.deepEqual(native, ["hola"])
  assert.deepEqual(local, [])
})

test("reply router keeps SSN commands observable without sending chat outbound", () => {
  const local = []
  const reply = createReplyRouter({ notifyLocal: payload => local.push(payload) })
  reply.send({ source: "social-stream-ninja", platform: "youtube", actor: { username: "kira" } }, "42 puntos")
  assert.deepEqual(local, [{ platform: "youtube", username: "kira", text: "42 puntos" }])
})


test("reply router respects a declared reply=false capability (TikTok) even if a reply function exists", () => {
  const native = []
  const local = []
  const reply = createReplyRouter({ notifyLocal: payload => local.push(payload) })
  reply.send({
    source: "tiktok-native", platform: "tiktok", actor: { username: "lunatok" },
    metadata: { capabilities: { reply: false } }, reply: msg => native.push(msg),
  }, "hola")
  assert.deepEqual(native, [])
  assert.deepEqual(local, [{ platform: "tiktok", username: "lunatok", text: "hola" }])
})

test("reply router still replies natively when the capability is declared true", () => {
  const native = []
  const reply = createReplyRouter()
  reply.send({ platform: "twitch", actor: { username: "luna" }, metadata: { capabilities: { reply: true } }, reply: msg => native.push(msg) }, "hola")
  assert.deepEqual(native, ["hola"])
})
