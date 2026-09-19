const test = require("node:test")
const assert = require("node:assert/strict")

const { createActivityTracker, registerActivityConsumer } = require("../src/core/interactions/activity-consumer.js")
const { createEventEngine } = require("../src/core/events/event-engine.js")

function chatEvent(platform, actor, text) {
  return { platform, type: "chat_message", actor, message: { text } }
}

test("1: un chat_message de Twitch actualiza activity", () => {
  const tracker = createActivityTracker()
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "tw-1", username: "luna", displayName: "Luna" }, "hola"))
  const active = tracker.getActiveViewerIdentities()
  assert.equal(active.length, 1)
  assert.equal(active[0].platform, "twitch")
})

test("2: un chat_message de SSN-YouTube actualiza activity", () => {
  const tracker = createActivityTracker()
  tracker.recordMessage(chatEvent("youtube", { platformUserId: "yt-1", username: "luna", displayName: "Luna" }, "hola"))
  const active = tracker.getActiveViewerIdentities()
  assert.equal(active.length, 1)
  assert.equal(active[0].platform, "youtube")
})

test("3: un chat_message de SSN-TikTok actualiza activity", () => {
  const tracker = createActivityTracker()
  tracker.recordMessage(chatEvent("tiktok", { platformUserId: "tt-1", username: "luna", displayName: "Luna" }, "hola"))
  const active = tracker.getActiveViewerIdentities()
  assert.equal(active.length, 1)
  assert.equal(active[0].platform, "tiktok")
})

test("4: Twitch y YouTube con el mismo username son viewers activos distintos", () => {
  const tracker = createActivityTracker()
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "hola"))
  tracker.recordMessage(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "hola"))
  const active = tracker.getActiveViewerIdentities()
  assert.equal(active.length, 2)
  assert.notDeepEqual(active[0], active[1])
})

test("5: el mismo platformUserId textual en plataformas distintas sigue separado", () => {
  const tracker = createActivityTracker()
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "123", username: "a" }, "hola"))
  tracker.recordMessage(chatEvent("youtube", { platformUserId: "123", username: "b" }, "hola"))
  const active = tracker.getActiveViewerIdentities()
  assert.equal(active.length, 2)
})

test("los comandos ('!...') no cuentan como actividad, igual que antes", () => {
  const tracker = createActivityTracker()
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "!puntos"))
  assert.equal(tracker.getActiveViewerIdentities().length, 0)
})

test("getActiveUsernames() es el wrapper legacy (solo strings)", () => {
  const tracker = createActivityTracker()
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "hola"))
  assert.deepEqual(tracker.getActiveUsernames(), ["luna"])
})

test("23: los viewers activos expiran (TTL) y no crecen indefinidamente", () => {
  const tracker = createActivityTracker({ ttlMs: 20 })
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "hola"))
  assert.equal(tracker.getActiveViewerIdentities().length, 1)
  const before = Date.now()
  while (Date.now() - before < 30) { /* espera activa breve para pasar el TTL de 20ms */ }
  assert.equal(tracker.getActiveViewerIdentities().length, 0)
})

test("registerActivityConsumer se suscribe al Event Engine y responde a chat_message", () => {
  const engine = createEventEngine()
  const tracker = createActivityTracker()
  registerActivityConsumer(engine, tracker)
  engine.emit(chatEvent("youtube", { platformUserId: "yt-9", username: "ana" }, "hola"))
  assert.equal(tracker.getActiveViewerIdentities().length, 1)
})

test("el rey del chat (onKingUpdate) se calcula por mensajes, no confunde plataformas", () => {
  let kingCalls = []
  const tracker = createActivityTracker({ onKingUpdate: king => kingCalls.push(king) })
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "hola"))
  tracker.recordMessage(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "hola"))
  tracker.recordMessage(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "hola de nuevo"))
  const king = tracker.getKing()
  assert.equal(king.platform, "youtube") // youtube-luna mandó 2 mensajes, twitch-luna solo 1
  assert.equal(king.messages, 2)
})
