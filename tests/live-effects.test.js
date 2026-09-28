// Efectos de directo: comandos gratuitos de animacion, exclusivos de TikTok por
// defecto, con cooldown por viewer y espaciado global.
const test = require("node:test")
const assert = require("node:assert/strict")

const { createCommandConfigService } = require("../src/services/command-config.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const {
  LIVE_EFFECTS, findLiveEffect, EFFECT_GLOBAL_SPACING_MS, EFFECT_DEFAULT_COOLDOWN_SECONDS,
} = require("../src/core/interactions/live-effects.js")

function fakePlatform() {
  let saved = null
  return { moderation: { getConfig: () => saved, setConfig: (_c, _k, value) => { saved = value; return saved } } }
}

function chatEvent(text, { platform = "tiktok", id = "1", name = "Luna" } = {}) {
  return {
    platform, source: `${platform}-native`, type: "chat_message",
    actor: { platformUserId: id, username: name.toLowerCase(), displayName: name, isModerator: false },
    message: { text },
    metadata: { capabilities: { reply: false } },
  }
}

// Motor con reloj manual y la configuracion real de comandos (en memoria).
function setup() {
  const clock = { t: 1_000_000 }
  const overlay = []
  const replies = []
  const config = createCommandConfigService(fakePlatform(), () => "workspace", { now: () => clock.t })
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    commandConfig: config,
    overlay: payload => overlay.push(payload),
    replyRouter: { send: (_event, text) => replies.push(text) },
    now: () => clock.t,
  })
  return { engine, config, overlay, replies, clock }
}

test("los efectos aparecen en Comandos, categoria Efectos, exclusivos de TikTok y con cooldown por defecto", () => {
  const { config } = setup()
  const listed = config.list().filter(command => command.category === "Efectos")
  assert.deepEqual(listed.map(command => command.name), LIVE_EFFECTS.map(effect => effect.name))
  for (const command of listed) {
    assert.equal(command.platform, "tiktok")
    assert.equal(command.cooldownSeconds, EFFECT_DEFAULT_COOLDOWN_SECONDS)
    assert.equal(command.enabled, true)
  }
})

test("editar un solo campo de un efecto conserva su plataforma y cooldown por defecto", () => {
  const { config } = setup()
  config.update("!fiesta", { enabled: false })
  const fiesta = config.list().find(command => command.name === "!fiesta")
  assert.equal(fiesta.platform, "tiktok")
  assert.equal(fiesta.cooldownSeconds, EFFECT_DEFAULT_COOLDOWN_SECONDS)
  assert.equal(fiesta.enabled, false)
})

test("los comandos existentes siguen con plataforma all y sin cooldown", () => {
  const { config } = setup()
  config.update("!puntos", { enabled: true })
  const puntos = config.list().find(command => command.name === "!puntos")
  assert.equal(puntos.platform, "all")
  assert.equal(puntos.cooldownSeconds, 0)
})

test("un efecto en TikTok dispara sus mensajes de overlay y responde", () => {
  const { engine, overlay, replies } = setup()
  engine.handle(chatEvent("!fuego"))
  assert.deepEqual(overlay.map(item => item.type), ["mimic_flash", "mimic_emoji_rain"])
  assert.equal(overlay[1].emoji.codePointAt(0), 0x1f525)
  assert.equal(replies.length, 1)
  assert.match(replies[0], /Luna activó Fuego/)
})

test("los alias y las mayusculas funcionan", () => {
  const { engine, overlay, clock } = setup()
  engine.handle(chatEvent("!PARTY"))
  assert.deepEqual(overlay.map(item => item.type), ["confetti", "rainbow"])
  clock.t += 60_000
  engine.handle(chatEvent("!Terremoto", { id: "2", name: "Kai" }))
  assert.equal(overlay.at(-1).type, "mimic_shake")
})

test("los efectos no se ejecutan en Twitch mientras sean exclusivos de TikTok", () => {
  const { engine, overlay, replies } = setup()
  engine.handle(chatEvent("!fiesta", { platform: "twitch" }))
  assert.deepEqual(overlay, [])
  assert.deepEqual(replies, [])
})

test("el streamer puede abrir un efecto a todas las plataformas", () => {
  const { engine, config, overlay } = setup()
  config.update("!flash", { platform: "all" })
  engine.handle(chatEvent("!flash", { platform: "twitch" }))
  assert.equal(overlay.length, 1)
})

test("un efecto desactivado no hace nada", () => {
  const { engine, config, overlay } = setup()
  config.update("!estrellas", { enabled: false })
  engine.handle(chatEvent("!estrellas"))
  assert.deepEqual(overlay, [])
})

test("cooldown por viewer: el mismo viewer espera, otro no (tras el espaciado global)", () => {
  const { engine, overlay, replies, clock } = setup()
  engine.handle(chatEvent("!corazones"))
  clock.t += EFFECT_GLOBAL_SPACING_MS + 1
  engine.handle(chatEvent("!estrellas")) // mismo viewer, otro efecto: cooldown es por comando
  assert.equal(overlay.length, 2)

  clock.t += EFFECT_GLOBAL_SPACING_MS + 1
  engine.handle(chatEvent("!corazones")) // mismo viewer y comando: en cooldown
  assert.equal(overlay.length, 2)
  assert.match(replies.at(-1), /espera \d+s/)

  clock.t += EFFECT_GLOBAL_SPACING_MS + 1
  engine.handle(chatEvent("!corazones", { id: "2", name: "Kai" }))
  assert.equal(overlay.length, 3)
})

test("espaciado global: dos efectos seguidos de viewers distintos no se apilan", () => {
  const { engine, overlay, clock } = setup()
  engine.handle(chatEvent("!fiesta"))
  const before = overlay.length
  clock.t += EFFECT_GLOBAL_SPACING_MS - 1
  engine.handle(chatEvent("!terremoto", { id: "2", name: "Kai" }))
  assert.equal(overlay.length, before)
  clock.t += 2
  engine.handle(chatEvent("!terremoto", { id: "2", name: "Kai" }))
  assert.equal(overlay.length, before + 1)
})

test("un efecto descartado por espaciado NO gasta el cooldown del viewer", () => {
  const { engine, overlay, clock } = setup()
  engine.handle(chatEvent("!fiesta"))
  clock.t += 1000
  engine.handle(chatEvent("!terremoto", { id: "2", name: "Kai" })) // descartado por espaciado
  clock.t += EFFECT_GLOBAL_SPACING_MS
  engine.handle(chatEvent("!terremoto", { id: "2", name: "Kai" })) // debe poder usarse ya
  assert.equal(overlay.at(-1).type, "mimic_shake")
})

test("los efectos no mueven economia: solo overlay y respuesta", () => {
  const { engine } = setup()
  assert.doesNotThrow(() => engine.handle(chatEvent("!fiesta")))
})

test("findLiveEffect ignora comandos que no son efectos", () => {
  assert.equal(findLiveEffect("!puntos"), null)
  assert.equal(findLiveEffect("!FIESTA").name, "!fiesta")
})
