const test = require("node:test")
const assert = require("node:assert/strict")

const {
  normalizeSsnPayload, createSocialStreamNinjaAdapter, PLATFORM_ALIASES,
} = require("../src/integrations/social-stream-ninja/social-stream-ninja-adapter.js")
const { createSocialStreamNinjaState } = require("../src/integrations/social-stream-ninja/social-stream-ninja-state.js")
const { createEventEngine } = require("../src/core/events/event-engine.js")

function ssnPayload(overrides = {}) {
  return {
    chatname: "Luna", chatmessage: "hola mundo", chatimg: "https://cdn.example/luna.png",
    type: "twitch", id: "ssn-msg-1", userid: "twitch-123",
    chatbadges: ["subscriber"], moderator: false,
    ...overrides,
  }
}

test("1-3: payload válido de SSN para Twitch/YouTube/TikTok normaliza a chat_message", () => {
  for (const type of ["twitch", "youtube", "tiktok"]) {
    const { event, rejected } = normalizeSsnPayload(ssnPayload({ type }))
    assert.equal(rejected, undefined)
    assert.equal(event.type, "chat_message")
    assert.equal(event.platform, type)
    assert.equal(event.source, "social-stream-ninja")
  }
})

test("4: userid termina en actor.platformUserId", () => {
  const { event } = normalizeSsnPayload(ssnPayload({ userid: "abc-999" }))
  assert.equal(event.actor.platformUserId, "abc-999")
})

test("5: chatname se normaliza a username/displayName; sin chatname cae a 'anon'", () => {
  const { event } = normalizeSsnPayload(ssnPayload({ chatname: "  Luna  " }))
  assert.equal(event.actor.username, "Luna")
  assert.equal(event.actor.displayName, "Luna")

  const { event: fallback } = normalizeSsnPayload(ssnPayload({ chatname: "" }))
  assert.equal(fallback.actor.username, "anon")
})

test("6: la plataforma se normaliza vía tabla explícita, no matching ambiguo", () => {
  assert.equal(normalizeSsnPayload(ssnPayload({ type: "Twitch" })).event.platform, "twitch") // case-insensitive
  assert.equal(normalizeSsnPayload(ssnPayload({ type: "kick" })).event.platform, "kick")
  assert.deepEqual(Object.keys(PLATFORM_ALIASES).sort(), ["kick", "tiktok", "twitch", "youtube"])
})

test("7: metadata relevante (badges, membership, donación) se conserva sin filtrar al nivel superior", () => {
  const { event } = normalizeSsnPayload(ssnPayload({
    chatbadges: ["moderator", "subscriber"], membership: "Tier 2 Subscriber", hasDonation: "$50.00 USD",
  }))
  assert.deepEqual(event.metadata.badges, ["moderator", "subscriber"])
  assert.equal(event.metadata.membership, "Tier 2 Subscriber")
  assert.equal(event.metadata.donation, "$50.00 USD")
  assert.equal(event.actor.platformUserId, "twitch-123") // no se movió nada de nivel
})

test("normaliza una insignia VIP de Social Stream Ninja", () => {
  const { event } = normalizeSsnPayload(ssnPayload({ chatbadges: ["vip", "subscriber"] }))
  assert.equal(event.actor.isVip, true)
})

test("8: payload inválido se rechaza sin lanzar", () => {
  assert.equal(normalizeSsnPayload(null).rejected, "el payload no es un objeto JSON")
  assert.equal(normalizeSsnPayload("string").rejected, "el payload no es un objeto JSON")
  assert.equal(normalizeSsnPayload({}).rejected, 'falta "type" (plataforma de origen)')
  assert.equal(normalizeSsnPayload({ type: "twitch" }).rejected, 'falta "chatmessage" (sin texto de chat no hay evento que procesar en esta fase)')
})

test("11: plataforma desconocida no crashea y se marca como 'unknown' con el valor crudo en metadata", () => {
  const { event } = normalizeSsnPayload(ssnPayload({ type: "friendster" }))
  assert.equal(event.platform, "unknown")
  assert.equal(event.metadata.ssn.rawPlatform, "friendster")
})

test("20: el estado de integración cambia al recibir y al rechazar eventos", () => {
  const state = createSocialStreamNinjaState()
  const engine = createEventEngine()
  const adapter = createSocialStreamNinjaAdapter({ eventEngine: engine, state })

  assert.equal(state.getStatus().status, "not_detected")

  adapter.handlePayload(ssnPayload({ type: "youtube", id: "y-1" }))
  const afterReceive = state.getStatus()
  assert.equal(afterReceive.status, "receiving")
  assert.equal(afterReceive.counters.received, 1)
  assert.deepEqual(afterReceive.platforms, ["youtube"])

  adapter.handlePayload({}) // inválido
  const afterReject = state.getStatus()
  assert.equal(afterReject.counters.rejected, 1)
  assert.equal(afterReject.status, "receiving") // ya había recibido algo antes; no retrocede a error
})

test("un payload que solo aporta el propio motor no importa Command/Sound Engine ni economy", () => {
  // Si social-stream-ninja-adapter.js importara economy/mimics/etc. al cargarse
  // (en vez de solo el Event Engine), este require ya habría fallado fuera
  // de Electron, igual que le pasaría a emoteSounds.js o db.js.
  assert.equal(typeof createSocialStreamNinjaAdapter, "function")
})
