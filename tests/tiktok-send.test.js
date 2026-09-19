// Envio opcional de chat a TikTok: cola con ritmo limitado, seguridad ante
// fallos y capacidad de respuesta real en los eventos.
const test = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")

const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const {
  createTikTokAdapter, prepareOutgoing, CHAT_MAX_LENGTH, SEND_MAX_CONSECUTIVE_FAILURES,
} = require("../src/integrations/tiktok/tiktok-adapter.js")

const silentLog = { warn() {}, error() {} }
const CREDENTIALS = { signApiKey: "euler-key", sessionId: "session-abc", ttTargetIdc: "useast1a" }

function fakeTimers() {
  const pending = new Map()
  let nextId = 1
  return {
    setTimer: fn => { const id = nextId++; pending.set(id, fn); return id },
    clearTimer: id => { pending.delete(id) },
    fireAll: () => { for (const [id, fn] of [...pending]) { pending.delete(id); fn() } },
    size: () => pending.size,
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

function setup({ credentials = CREDENTIALS, sendImpl } = {}) {
  const engine = createEventEngine()
  const timers = fakeTimers()
  const emitter = new EventEmitter()
  const sent = []
  const factoryCalls = []
  const adapter = createTikTokAdapter({
    eventEngine: engine, log: silentLog, ...timers,
    getCredentials: () => credentials,
    connectionFactory: async (username, options) => {
      factoryCalls.push(options)
      return {
        on: (name, fn) => emitter.on(name, fn),
        connect: async () => {},
        disconnect: async () => {},
        ...(options.credentials ? { sendMessage: async text => { sent.push(text); if (sendImpl) return sendImpl(text) } } : {}),
      }
    },
  })
  const chats = []
  engine.subscribe("chat_message", event => chats.push(event))
  const chat = (text, id = "1") => emitter.emit("chat", {
    user: { userId: id, uniqueId: `user${id}`, nickname: `User${id}` }, comment: text, common: { msgId: `m-${text}-${id}` },
  })
  return { engine, adapter, timers, emitter, sent, factoryCalls, chats, chat }
}

test("prepareOutgoing: una linea, limite de longitud y nunca empieza por !", () => {
  assert.equal(prepareOutgoing("hola\n  mundo"), "hola mundo")
  assert.equal(prepareOutgoing("   "), "")
  assert.match(prepareOutgoing("!daily disponible"), /^Mimiku: !daily/)
  const long = prepareOutgoing("x".repeat(500))
  assert.equal(long.length, CHAT_MAX_LENGTH)
  assert.ok(long.endsWith("..."))
})

test("sin la opcion activada no se usan credenciales y el chat no puede responderse", async () => {
  const { adapter, factoryCalls, chat, chats } = setup()
  await adapter.connect("streamer")
  assert.equal(factoryCalls[0].credentials, null)
  chat("hola")
  assert.equal(chats[0].metadata.capabilities.reply, false)
  assert.equal(adapter.getStatus().canSend, false)
})

test("con la opcion y credenciales completas el chat responde por TikTok", async () => {
  const { adapter, factoryCalls, chat, chats, sent } = setup()
  await adapter.connect("streamer", { sendReplies: true })
  assert.deepEqual(factoryCalls[0].credentials, CREDENTIALS)
  assert.equal(adapter.getStatus().canSend, true)

  chat("hola")
  assert.equal(chats[0].metadata.capabilities.reply, true)
  chats[0].reply("@user1 recibiste 100 puntos")
  await flush()
  assert.deepEqual(sent, ["@user1 recibiste 100 puntos"])
})

test("faltan credenciales: no se envia y la UI recibe el motivo", async () => {
  const { adapter, factoryCalls, chat, chats } = setup({ credentials: { signApiKey: "k", sessionId: "", ttTargetIdc: "x" } })
  await adapter.connect("streamer", { sendReplies: true })
  assert.equal(factoryCalls[0].credentials, null)
  chat("hola")
  assert.equal(chats[0].metadata.capabilities.reply, false)
  assert.match(adapter.getStatus().sendNote, /Faltan credenciales/)
})

test("los envios respetan la espera minima entre mensajes", async () => {
  const { adapter, sent, timers, chat, chats } = setup()
  await adapter.connect("streamer", { sendReplies: true })
  chat("hola")
  chats[0].reply("uno")
  chats[0].reply("dos")
  chats[0].reply("tres")
  await flush()
  assert.deepEqual(sent, ["uno"])

  timers.fireAll()
  await flush()
  assert.deepEqual(sent, ["uno", "dos"])
  timers.fireAll()
  await flush()
  assert.deepEqual(sent, ["uno", "dos", "tres"])
})

test("la cola tiene tope: no se inunda el chat", async () => {
  const { adapter, sent, chat, chats } = setup()
  await adapter.connect("streamer", { sendReplies: true })
  chat("hola")
  let accepted = 0
  for (let i = 0; i < 100; i++) if (chats[0].reply(`msg ${i}`) !== false) accepted++
  await flush()
  // El primero sale ya; el resto queda en cola hasta el tope.
  assert.ok(adapter.say("otro") === false || accepted <= 21)
  assert.equal(sent.length, 1)
})

test("tras fallos consecutivos se desactiva el envio y se avisa", async () => {
  const { adapter, timers, chat, chats } = setup({ sendImpl: () => { throw new Error("sesion caducada") } })
  await adapter.connect("streamer", { sendReplies: true })
  chat("hola")
  for (let i = 0; i < SEND_MAX_CONSECUTIVE_FAILURES; i++) {
    chats[0].reply(`intento ${i}`)
    await flush()
    timers.fireAll()
    await flush()
  }
  const status = adapter.getStatus()
  assert.equal(status.canSend, false)
  assert.match(status.sendNote, /Se desactiv/)

  chat("otro", "2")
  assert.equal(chats.at(-1).metadata.capabilities.reply, false)
})

test("desconectar deja de enviar", async () => {
  const { adapter, sent } = setup()
  await adapter.connect("streamer", { sendReplies: true })
  adapter.disconnect()
  assert.equal(adapter.say("hola"), false)
  await flush()
  assert.deepEqual(sent, [])
})

test("las credenciales nunca aparecen en el estado publico del adaptador", async () => {
  const { adapter } = setup()
  await adapter.connect("streamer", { sendReplies: true })
  const serialized = JSON.stringify(adapter.getStatus())
  for (const secret of Object.values(CREDENTIALS)) assert.equal(serialized.includes(secret), false)
})

test("de punta a punta: !puntos en TikTok se responde en el chat de TikTok y no en el panel local", async () => {
  const { engine, adapter, chat, sent } = setup()
  const local = []
  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 42 }), getViewerFor: () => ({ points: 42 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    commandConfig: { evaluate: () => ({ allowed: true }), record: () => {} },
    notify: (channel, payload) => { if (channel === "chat:response") local.push(payload) },
  })
  await adapter.connect("streamer", { sendReplies: true })
  chat("!puntos")
  await flush()
  assert.equal(sent.length, 1)
  assert.match(sent[0], /42 puntos/)
  assert.equal(local.length, 0)
})

test("de punta a punta sin envio: la respuesta va al panel local como antes", async () => {
  const { engine, adapter, chat, sent } = setup()
  const local = []
  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 42 }), getViewerFor: () => ({ points: 42 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    commandConfig: { evaluate: () => ({ allowed: true }), record: () => {} },
    notify: (channel, payload) => { if (channel === "chat:response") local.push(payload) },
  })
  await adapter.connect("streamer")
  chat("!puntos")
  await flush()
  assert.equal(sent.length, 0)
  assert.equal(local.length, 1)
})
