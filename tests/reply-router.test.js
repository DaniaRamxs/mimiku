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

test("reply router muestra tambien en el overlay la respuesta a TikTok, recortada a una linea", () => {
  const overlay = []
  const reply = createReplyRouter({ showOnOverlay: payload => overlay.push(payload) })
  const event = { platform: "tiktok", actor: { username: "lunatok" }, metadata: { capabilities: { reply: false } } }
  reply.send(event, "@Luna tenes 42 puntos")
  reply.send(event, "linea uno\nlinea dos " + "x".repeat(300))
  assert.deepEqual(overlay[0], { type: "reply_toast", text: "@Luna tenes 42 puntos", duration: 6000 })
  assert.equal(overlay[1].text.length, 110)
  assert.ok(!overlay[1].text.includes("\n"))
  assert.ok(overlay[1].text.endsWith("..."))
})

test("reply router no toca el overlay para Twitch ni para YouTube por SSN", () => {
  const overlay = []
  const reply = createReplyRouter({ showOnOverlay: payload => overlay.push(payload) })
  reply.send({ platform: "twitch", actor: { username: "a" }, reply() {} }, "hola")
  reply.send({ source: "social-stream-ninja", platform: "youtube", actor: { username: "b" } }, "hola")
  assert.deepEqual(overlay, [])
})
