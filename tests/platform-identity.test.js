// Fase 1.4 — Platform Identity Correctness.
// Prueba de extremo a extremo: identidad compuesta (platform, platformUserId)
// a través de economy.js, games.js, events.js, shop.js y Command Engine,
// sobre SQLite en memoria real (no fakes de identidad).
const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const { registerSoundTriggerEngine } = require("../src/core/interactions/sound-trigger-engine.js")
const { createSocialStreamNinjaAdapter } = require("../src/integrations/social-stream-ninja/social-stream-ninja-adapter.js")
const { normalizeTwitchChatMessage } = require("../src/integrations/twitch/twitch-adapter.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const economy = createEconomyService(platform, () => "canal")
  return { db, platform, economy }
}

function chatEvent(text, actor, overrides = {}) {
  return { platform: actor.platform, type: "chat_message", actor, message: { text }, metadata: {}, reply: () => {}, ...overrides }
}

test("1: Twitch y YouTube con el mismo username son identidades diferentes", () => {
  const { platform } = setup()
  const tw = platform.identities.resolve({ platform: "twitch", platformUserId: "123", username: "luna" })
  const yt = platform.identities.resolve({ platform: "youtube", platformUserId: "456", username: "luna" })
  assert.notEqual(tw.id, yt.id)
})

test("2: Twitch y YouTube con el mismo platformUserId textual son identidades diferentes", () => {
  const { platform } = setup()
  const tw = platform.identities.resolve({ platform: "twitch", platformUserId: "123", username: "a" })
  const yt = platform.identities.resolve({ platform: "youtube", platformUserId: "123", username: "b" })
  assert.notEqual(tw.id, yt.id)
  assert.equal(tw.platform_user_id, "123")
  assert.equal(yt.platform_user_id, "123")
})

test("3: Twitch/YouTube/TikTok con username 'luna' → tres identidades independientes", () => {
  const { platform, economy } = setup()
  economy.addPoints("luna", 10, "seed", { platform: "twitch", platformUserId: "tw_1" })
  economy.addPoints("luna", 20, "seed", { platform: "youtube", platformUserId: "yt_1" })
  economy.addPoints("luna", 30, "seed", { platform: "tiktok", platformUserId: "tt_1" })

  const tw = economy.getViewer("luna", "twitch")
  const yt = economy.getViewer("luna", "youtube")
  const tt = economy.getViewer("luna", "tiktok")
  const ids = new Set([tw.id, yt.id, tt.id])
  assert.equal(ids.size, 3)
  assert.equal(tw.points, 10)
  assert.equal(yt.points, 20)
  assert.equal(tt.points, 30)
})

test("4-7: !puntos por plataforma devuelve la wallet correcta y modificar una no afecta a la otra", () => {
  const { economy } = setup()
  const engine = createCommandEngine({
    economy, games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
  })
  const repliesTw = [], repliesYt = []

  // Sembrado SIN platformUserId (igual que hace `!dar` al resolver un
  // username escrito en texto) para no mezclar con el caso de identidad por
  // id real, que se prueba aparte en el test 9. Aquí lo que importa es que
  // "luna" en twitch y "luna" en youtube nunca comparten wallet.
  engine.handle(chatEvent("!daily", { platform: "twitch", username: "luna", displayName: "Luna" }, { reply: () => {} }))
  engine.handle(chatEvent("!daily", { platform: "youtube", username: "luna", displayName: "Luna" }, { reply: () => {} }))

  engine.handle(chatEvent("!puntos", { platform: "twitch", username: "luna", displayName: "Luna" }, { reply: m => repliesTw.push(m) }))
  engine.handle(chatEvent("!puntos", { platform: "youtube", username: "luna", displayName: "Luna" }, { reply: m => repliesYt.push(m) }))
  // !daily da 10.000 (antes 500).
  assert.match(repliesTw[0], /tenés 10,000 puntos/)
  assert.match(repliesYt[0], /tenés 10,000 puntos/)

  // !dar (mod) modifica el username "luna" — debe resolver dentro de LA MISMA
  // plataforma desde la que se ejecuta el comando, nunca cruzar a la otra.
  const modReplies = []
  engine.handle(chatEvent("!dar luna 100", { platform: "twitch", platformUserId: "mod_1", username: "streamer", displayName: "Streamer", isModerator: true }, { reply: m => modReplies.push(m) }))
  assert.match(modReplies[0], /recibió 100 pts/)

  const afterTw = [], afterYt = []
  engine.handle(chatEvent("!puntos", { platform: "twitch", username: "luna", displayName: "Luna" }, { reply: m => afterTw.push(m) }))
  engine.handle(chatEvent("!puntos", { platform: "youtube", username: "luna", displayName: "Luna" }, { reply: m => afterYt.push(m) }))
  assert.match(afterTw[0], /tenés 10,100 puntos/) // 10.000 + 100
  assert.match(afterYt[0], /tenés 10,000 puntos/)  // sin cambios
})

test("8: un evento SSN de YouTube resuelve identidad por platform=youtube, no por source", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const economy = createEconomyService(platform, () => "canal")
  const engine = createEventEngine()
  registerCommandEngine(engine, { economy, games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} } })
  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })

  ssn.handlePayload({ chatname: "luna", chatmessage: "!daily", type: "youtube", userid: "yt-99", id: "ssn-1" })

  // Requisito central de la Fase 1.4: la identidad se resuelve por
  // event.platform ("youtube"), nunca por event.source ("social-stream-ninja")
  // ni por defecto "twitch". "!daily" resuelve identidad tres veces dentro de
  // economy.js (ensureViewer, addPoints, setCooldown); las tres reciben ahora
  // el mismo platformUserId real, así que las tres deben converger en LA
  // MISMA fila (no en "twitch", no en una fila "legacy:luna" separada).
  const rows = db.prepare("SELECT platform, platform_user_id FROM viewer_identities WHERE username='luna'").all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].platform, "youtube")
  assert.equal(rows[0].platform_user_id, "yt-99")
  db.close()
})

test("9: SSN-Twitch y Twitch Native con el mismo platformUserId resuelven la MISMA identidad", () => {
  const { platform, economy } = setup()
  const engine = createEventEngine()
  registerCommandEngine(engine, { economy, games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} } })
  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })

  const twitchEvent = normalizeTwitchChatMessage({
    tags: { username: "luna", "display-name": "Luna", "user-id": "tw-123", id: "tw-irc-1" },
    message: "!daily", channel: "canal", // crea la identidad (getViewer por sí solo no crea)
  })
  engine.emit(twitchEvent)
  ssn.handlePayload({ chatname: "luna", chatmessage: "!puntos", type: "twitch", userid: "tw-123", id: "ssn-distinct" })

  const rows = platform.db.prepare("SELECT id FROM viewer_identities WHERE platform='twitch' AND platform_user_id='tw-123'").all()
  assert.equal(rows.length, 1) // una sola fila — misma identidad para ambos orígenes
})

test("10-11: sin userid de SSN, el fallback queda namespaced por plataforma (no cae en Twitch)", () => {
  const { platform, economy } = setup()
  economy.addPoints("bob", 5, "seed", { platform: "twitch", platformUserId: "tw_bob" }) // identidad Twitch real ya existente

  const engine = createEventEngine()
  registerCommandEngine(engine, { economy, games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} } })
  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })
  ssn.handlePayload({ chatname: "bob", chatmessage: "!daily", type: "youtube", id: "ssn-no-userid" }) // sin userid; !daily crea la identidad

  const ytRow = platform.db.prepare("SELECT * FROM viewer_identities WHERE platform='youtube' AND username='bob'").get()
  assert.ok(ytRow, "debe crearse una identidad youtube propia")
  assert.match(ytRow.platform_user_id, /^legacy:/) // distinguible como fallback, no un id oficial
  assert.notEqual(ytRow.platform_user_id, "tw_bob")

  const twRow = platform.db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND username='bob'").get()
  assert.notEqual(ytRow.id, twRow.id) // no se fusionó con la identidad twitch existente
})

test("12: un cooldown de daily en Twitch no bloquea al mismo username en YouTube", () => {
  const { economy } = setup()
  const tw = economy.claimDaily("luna", "Luna", "twitch")
  assert.equal(tw.ok, true)
  const twAgain = economy.claimDaily("luna", "Luna", "twitch")
  assert.equal(twAgain.ok, false) // en cooldown en Twitch

  const yt = economy.claimDaily("luna", "Luna", "youtube")
  assert.equal(yt.ok, true) // YouTube no está afectado por el cooldown de Twitch
})

// 13: el multiplicador/congelamiento de economía en events.js siguen siendo
// estado global de canal (un solo `activeEvents` a nivel de módulo, sin clave
// de viewer ni de plataforma) — confirmado por inspección de código, no por
// test automatizado: events.js importa src/services/db.js de forma EAGER en
// su primera línea, que solo puede inicializarse dentro de un proceso
// Electron real (igual que emoteSounds.js/widgets.js), así que no se puede
// requerir de forma segura desde node --test. No se le agregó ninguna clave
// de plataforma a `activeEvents` en esta fase — solo se corrigieron las
// llamadas a getViewer/addPoints que SÍ son por-viewer (rainPoints,
// equalizer, collectTax, taxEveryone, crownKing, attackBoss, etc.).

test("14: una identidad Twitch creada como antes de la Fase 1.4 conserva su saldo tras el fix", () => {
  const { platform, economy } = setup()
  // simula lo que el código ANTIGUO hacía siempre: resolver sin pasar platform explícito
  const legacyViewer = platform.identities.resolve({ platform: "twitch", platformUserId: "tw_old", username: "veterano" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: legacyViewer.id, balanceDelta: 777, reason: "historico", idempotencyKey: "hist:1" })

  // el código NUEVO, con platform explícito "twitch", debe seguir viendo el mismo saldo
  const resolved = economy.getViewer("veterano", "twitch")
  assert.equal(resolved.id, legacyViewer.id)
  assert.equal(resolved.points, 777)
})

test("15: SSN + Twitch Native con el mismo mensaje siguen deduplicándose (no regresó la Fase 1)", () => {
  const engine = createEventEngine()
  const { economy } = setup()

  let calls = 0
  const originalGetViewer = economy.getViewer
  economy.getViewer = (...args) => { calls++; return originalGetViewer(...args) } // patchear ANTES de registrar: Command Engine captura la referencia al construirse

  registerCommandEngine(engine, { economy, games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} } })
  const ssn = createSocialStreamNinjaAdapter({ eventEngine: engine })

  const twitchEvent = normalizeTwitchChatMessage({
    tags: { username: "luna", "display-name": "Luna", "user-id": "u-1", id: "tw-irc-id" },
    message: "!puntos", channel: "canal",
  })
  engine.emit(twitchEvent)
  ssn.handlePayload({ chatname: "luna", chatmessage: "!puntos", type: "twitch", userid: "u-1", id: "ssn-distinto-id" })

  assert.equal(calls, 1) // el segundo (duplicado) nunca llegó a ejecutar el comando
})
