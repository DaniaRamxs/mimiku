const test = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")

const { createEventEngine } = require("../src/core/events/event-engine.js")
const {
  createTikTokAdapter, createGiftComboTracker, normalizeChat, normalizeLike, COMBO_IDLE_FLUSH_MS,
} = require("../src/integrations/tiktok/tiktok-adapter.js")

const silentLog = { warn() {}, error() {} }

function user(overrides = {}) {
  return { userId: "777", uniqueId: "LunaTok", nickname: "Luna", ...overrides }
}

function giftData({ count, end, groupId = "g1", giftType = 1, giftId = 5655, diamonds = 1 }) {
  return {
    user: user(), giftId, groupId, repeatCount: count, repeatEnd: end ? 1 : 0,
    giftDetails: { giftName: "Rosa", giftType, diamondCount: diamonds },
  }
}

// Temporizador manual para controlar el tiempo sin esperas reales.
function fakeTimers() {
  const pending = new Map()
  let nextId = 1
  return {
    setTimer: (fn, ms) => { const id = nextId++; pending.set(id, { fn, ms }); return id },
    clearTimer: id => { pending.delete(id) },
    fireAll: () => { for (const [id, { fn }] of [...pending]) { pending.delete(id); fn() } },
    size: () => pending.size,
  }
}

test("normaliza un mensaje de chat de TikTok al contrato interno", () => {
  const event = normalizeChat({ user: user(), comment: "hola", common: { msgId: "m1" } })
  assert.equal(event.platform, "tiktok")
  assert.equal(event.type, "chat_message")
  assert.equal(event.id, "m1")
  assert.equal(event.actor.platformUserId, "777")
  assert.equal(event.actor.username, "lunatok")
  assert.equal(event.message.text, "hola")
  assert.equal(event.metadata.capabilities.reply, false)
})

test("un chat vacio no genera evento", () => {
  assert.equal(normalizeChat({ user: user(), comment: "   " }), null)
})

test("normaliza likes con el total acumulado", () => {
  const event = normalizeLike({ user: user(), likeCount: 5, totalLikeCount: 120 })
  assert.deepEqual(event.payload, { count: 5, total: 120 })
})

test("un combo emite UNA sola vez, al cerrarse, con el total acumulado", () => {
  const emitted = []
  const tracker = createGiftComboTracker({ emit: event => emitted.push(event), ...fakeTimers() })
  tracker.handle(giftData({ count: 1 }))
  tracker.handle(giftData({ count: 2 }))
  tracker.handle(giftData({ count: 3 }))
  assert.equal(emitted.length, 0)

  tracker.handle(giftData({ count: 3, end: true }))
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].type, "gift")
  assert.equal(emitted[0].payload.count, 3)
  assert.equal(emitted[0].payload.coins, 3)
  assert.equal(emitted[0].payload.giftName, "Rosa")
})

test("un regalo que no es de combo se emite de inmediato", () => {
  const emitted = []
  const tracker = createGiftComboTracker({ emit: event => emitted.push(event), ...fakeTimers() })
  tracker.handle(giftData({ count: 1, giftType: 2, diamonds: 30 }))
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].payload.coins, 30)
})

test("un combo sin cierre se libera por inactividad y un cierre tardio no lo duplica", () => {
  const emitted = []
  const timers = fakeTimers()
  const tracker = createGiftComboTracker({ emit: event => emitted.push(event), ...timers })
  tracker.handle(giftData({ count: 4 }))
  timers.fireAll()
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].payload.count, 4)

  tracker.handle(giftData({ count: 4, end: true }))
  assert.equal(emitted.length, 1)
})

test("dos combos distintos del mismo usuario no se mezclan", () => {
  const emitted = []
  const tracker = createGiftComboTracker({ emit: event => emitted.push(event), ...fakeTimers() })
  tracker.handle(giftData({ count: 2, groupId: "a" }))
  tracker.handle(giftData({ count: 5, groupId: "b" }))
  tracker.handle(giftData({ count: 2, groupId: "a", end: true }))
  tracker.handle(giftData({ count: 5, groupId: "b", end: true }))
  assert.deepEqual(emitted.map(event => event.payload.count).sort(), [2, 5])
})

test("el total de coins es monedas por regalo por cantidad", () => {
  const emitted = []
  const tracker = createGiftComboTracker({ emit: event => emitted.push(event), ...fakeTimers() })
  tracker.handle(giftData({ count: 10, end: true, diamonds: 30 }))
  assert.equal(emitted[0].payload.coins, 300)
})

test("el bus no descarta dos regalos distintos del mismo usuario en pocos segundos", () => {
  const engine = createEventEngine()
  const seen = []
  engine.subscribe("gift", event => seen.push(event.payload.giftId))
  const tracker = createGiftComboTracker({ emit: event => engine.emit(event), ...fakeTimers() })
  tracker.handle(giftData({ count: 1, giftType: 2, giftId: 1 }))
  tracker.handle(giftData({ count: 1, giftType: 2, giftId: 2 }))
  assert.deepEqual(seen, ["1", "2"])
})

function fakeConnectionFactory({ failTimes = 0 } = {}) {
  const connections = []
  let failures = failTimes
  const factory = async () => {
    const emitter = new EventEmitter()
    const conn = {
      emitter,
      on: (name, handler) => emitter.on(name, handler),
      connect: async () => { if (failures-- > 0) throw new Error("offline") },
      disconnect: async () => { conn.closed = true },
      closed: false,
    }
    connections.push(conn)
    return conn
  }
  return { factory, connections }
}

test("el adaptador conecta y entrega chat, follow y likes al bus", async () => {
  const engine = createEventEngine()
  const seen = []
  for (const type of ["chat_message", "follow", "like"]) engine.subscribe(type, event => seen.push(event.type))
  const { factory, connections } = fakeConnectionFactory()
  const adapter = createTikTokAdapter({ eventEngine: engine, connectionFactory: factory, log: silentLog, ...fakeTimers() })

  await adapter.connect("@LunaTok")
  assert.equal(adapter.getStatus().state, "connected")
  assert.equal(adapter.getStatus().username, "lunatok")

  connections[0].emitter.emit("chat", { user: user(), comment: "hola", common: { msgId: "1" } })
  connections[0].emitter.emit("follow", { user: user() })
  connections[0].emitter.emit("like", { user: user(), likeCount: 2, totalLikeCount: 9 })
  assert.deepEqual(seen, ["chat_message", "follow", "like"])
})

test("si la conexion falla, reintenta con reconexion automatica", async () => {
  const engine = createEventEngine()
  const timers = fakeTimers()
  const { factory, connections } = fakeConnectionFactory({ failTimes: 1 })
  const adapter = createTikTokAdapter({ eventEngine: engine, connectionFactory: factory, log: silentLog, ...timers })

  await adapter.connect("luna")
  assert.equal(adapter.getStatus().state, "reconnecting")
  assert.equal(timers.size(), 1)

  timers.fireAll()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(adapter.getStatus().state, "connected")
  assert.equal(connections.length, 2)
})

test("sin autoReconnect no reintenta", async () => {
  const timers = fakeTimers()
  const { factory } = fakeConnectionFactory({ failTimes: 5 })
  const adapter = createTikTokAdapter({ eventEngine: createEventEngine(), connectionFactory: factory, log: silentLog, ...timers })
  await adapter.connect("luna", { autoReconnect: false })
  assert.equal(adapter.getStatus().state, "error")
  assert.equal(timers.size(), 0)
})

test("desconectar cancela reintentos y descarta eventos de la conexion vieja", async () => {
  const engine = createEventEngine()
  const seen = []
  engine.subscribe("chat_message", event => seen.push(event))
  const timers = fakeTimers()
  const { factory, connections } = fakeConnectionFactory()
  const adapter = createTikTokAdapter({ eventEngine: engine, connectionFactory: factory, log: silentLog, ...timers })
  await adapter.connect("luna")
  adapter.disconnect()

  connections[0].emitter.emit("chat", { user: user(), comment: "tarde" })
  assert.equal(seen.length, 0)
  assert.equal(connections[0].closed, true)
  assert.equal(adapter.getStatus().state, "disconnected")
  assert.equal(timers.size(), 0)
})

test("si la libreria no esta instalada el estado es unavailable y no revienta", async () => {
  const adapter = createTikTokAdapter({
    eventEngine: createEventEngine(), log: silentLog, ...fakeTimers(),
    connectionFactory: async () => { const error = new Error("nope"); error.code = "ERR_MODULE_NOT_FOUND"; throw error },
  })
  await adapter.connect("luna")
  assert.equal(adapter.getStatus().state, "unavailable")
})

test("exige un usuario", () => {
  const adapter = createTikTokAdapter({ eventEngine: createEventEngine(), connectionFactory: async () => {}, ...fakeTimers() })
  assert.throws(() => adapter.connect("  @ "), /usuario de TikTok/)
})

test("COMBO_IDLE_FLUSH_MS es un valor razonable", () => {
  assert.ok(COMBO_IDLE_FLUSH_MS >= 3000 && COMBO_IDLE_FLUSH_MS <= 30000)
})
