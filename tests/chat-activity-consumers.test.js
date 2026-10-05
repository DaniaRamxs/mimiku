const test = require("node:test")
const assert = require("node:assert/strict")

const {
  createXpConsumer, createLevelsConsumer, createWidgetsConsumer, createChallengeConsumer,
} = require("../src/core/interactions/chat-activity-consumers.js")

function chatEvent(platform, actor, text) {
  return { platform, type: "chat_message", actor, message: { text }, metadata: { color: "#ff0000" } }
}

function fakeEvents(overrides = {}) {
  return { isEconomyFrozen: () => false, getMultiplier: () => 1, ...overrides }
}

// ── XP por mensaje (6-9) ─────────────────────────────────────────────────────
test("6-8: XP por mensaje funciona para Twitch, YouTube y TikTok", () => {
  const calls = []
  const economy = { onMessage: (...args) => calls.push(args) }
  const xp = createXpConsumer({ economy, events: fakeEvents() })

  xp.handle(chatEvent("twitch", { platformUserId: "tw-1", username: "luna", displayName: "Luna" }, "hola"))
  xp.handle(chatEvent("youtube", { platformUserId: "yt-1", username: "luna", displayName: "Luna" }, "hola"))
  xp.handle(chatEvent("tiktok", { platformUserId: "tt-1", username: "luna", displayName: "Luna" }, "hola"))

  assert.equal(calls.length, 3)
  const [tw, yt, tt] = calls
  assert.equal(tw[4], "twitch"); assert.equal(tw[3], "tw-1")
  assert.equal(yt[4], "youtube"); assert.equal(yt[3], "yt-1")
  assert.equal(tt[4], "tiktok"); assert.equal(tt[3], "tt-1")
})

test("9: XP de YouTube no llama a economía con plataforma Twitch (no modifica el wallet Twitch)", () => {
  const calls = []
  const economy = { onMessage: (...args) => calls.push(args) }
  const xp = createXpConsumer({ economy, events: fakeEvents() })
  xp.handle(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "hola"))
  assert.equal(calls.length, 1)
  assert.notEqual(calls[0][4], "twitch")
})

test("los bots de chat conocidos no ganan puntos por chatear", () => {
  const calls = []
  const economy = { onMessage: (...args) => calls.push(args) }
  const xp = createXpConsumer({ economy, events: fakeEvents() })
  for (const username of ["Nightbot", "moobot", "StreamlootsBot"]) xp.handle(chatEvent("twitch", { platformUserId: username, username }, "hola"))
  assert.equal(calls.length, 0)
  xp.handle(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "hola"))
  assert.equal(calls.length, 1)
})

test("XP no se otorga si la economía está congelada, ni en comandos", () => {
  const calls = []
  const economy = { onMessage: (...args) => calls.push(args) }
  const xpFrozen = createXpConsumer({ economy, events: fakeEvents({ isEconomyFrozen: () => true }) })
  xpFrozen.handle(chatEvent("twitch", { username: "luna" }, "hola"))
  assert.equal(calls.length, 0)

  const xp = createXpConsumer({ economy, events: fakeEvents() })
  xp.handle(chatEvent("twitch", { username: "luna" }, "!puntos"))
  assert.equal(calls.length, 0)
})

test("XP permite resolver puntos dinámicos por mensaje sin cambiar el consumidor base", () => {
  const calls = []
  const economy = { onMessage: (...args) => calls.push(args) }
  const xp = createXpConsumer({
    economy,
    events: fakeEvents({ getMultiplier: () => 2 }),
    getPointsPerMessage: event => event.actor.isVip ? 9 : 2,
  })

  xp.handle(chatEvent("twitch", { username: "luna", displayName: "Luna", isVip: true }, "hola"))
  xp.handle(chatEvent("twitch", { username: "bob", displayName: "Bob" }, "hola"))

  assert.equal(calls[0][2], 18)
  assert.equal(calls[1][2], 4)
})

// ── Niveles (10) ─────────────────────────────────────────────────────────────
test("10: levels.onMessage funciona desde un evento de SSN sin conectar Twitch", () => {
  const calls = []
  const levels = { onMessage: (...args) => calls.push(args) }
  const consumer = createLevelsConsumer({ levels })
  consumer.handle(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "hola"))
  assert.deepEqual(calls, [["luna", "yt-1", "youtube"]])
})

// ── Widgets (11-12) ──────────────────────────────────────────────────────────
test("11: el widget de avatar recibe un mensaje de YouTube", () => {
  const calls = []
  const widgets = { onChatMessage: (...args) => { calls.push(args); return Promise.resolve() } }
  const consumer = createWidgetsConsumer({ widgets })
  consumer.handle(chatEvent("youtube", { platformUserId: "yt-1", username: "luna", displayName: "Luna" }, "hola"))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][3], "youtube")
  assert.equal(calls[0][4], "yt-1")
})

test("12: el widget no mezcla Twitch:luna con YouTube:luna", () => {
  const calls = []
  const widgets = { onChatMessage: (...args) => { calls.push(args); return Promise.resolve() } }
  const consumer = createWidgetsConsumer({ widgets })
  consumer.handle(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "hola"))
  consumer.handle(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "hola"))
  assert.equal(calls.length, 2)
  assert.notEqual(calls[0][3], calls[1][3]) // distinta plataforma
  assert.notEqual(calls[0][4], calls[1][4]) // distinto platformUserId
})

// ── Mini-reto (13-14) ────────────────────────────────────────────────────────
test("13: el mini-reto puede recibir una participación de YouTube", () => {
  const calls = []
  const economy = { addPoints: (...args) => calls.push(args) }
  const challenge = createChallengeConsumer({ economy })
  challenge.start("fuego", 0.05, 50)
  challenge.handle(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "aquí viene el fuego"))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "luna")
  assert.equal(calls[0][3].platform, "youtube")
  assert.equal(calls[0][3].platformUserId, "yt-1")
})

test("14: Twitch:luna y YouTube:luna participan en el mini-reto como identidades distintas", () => {
  const calls = []
  const economy = { addPoints: (...args) => calls.push(args) }
  const challenge = createChallengeConsumer({ economy })
  challenge.start("fuego", 0.05, 50)
  challenge.handle(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "fuego"))
  challenge.handle(chatEvent("youtube", { platformUserId: "yt-1", username: "luna" }, "fuego"))
  assert.equal(calls.length, 2) // ambas ganan, no se bloquean entre sí por compartir username
  assert.equal(challenge.getActiveChallenge().winners.size, 2)
})

test("un mismo viewer no puede ganar el mini-reto dos veces", () => {
  const calls = []
  const economy = { addPoints: (...args) => calls.push(args) }
  const challenge = createChallengeConsumer({ economy })
  challenge.start("fuego", 0.05, 50)
  challenge.handle(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "fuego"))
  challenge.handle(chatEvent("twitch", { platformUserId: "tw-1", username: "luna" }, "otro fuego"))
  assert.equal(calls.length, 1)
})
