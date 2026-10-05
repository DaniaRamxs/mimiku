const test = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")

const { createTwitchEventSub, normalizeRedemption, REDEMPTION_TYPE } = require("../src/services/twitch-eventsub.js")
const { matchTrigger } = require("../src/core/vtuber/reaction-runner.js")
const { nodeDefinition } = require("../src/core/vtuber/reaction-catalog.js")
const { buildTemplateFlow } = require("../src/core/vtuber/reaction-templates.js")

const quietLog = { warn() {} }

function fakeSockets() {
  const opened = []
  class FakeSocket extends EventEmitter {
    constructor(url) { super(); this.url = url; this.closed = false; opened.push(this) }
    close() { this.closed = true; this.emit("close") }
    send(message) { this.emit("message", JSON.stringify(message)) }
  }
  return { FakeSocket, opened }
}

function fakeFetch({ scopes = ["chat:read", "channel:read:redemptions"], login = "canal", subscribeStatus = 202 } = {}) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.includes("oauth2/validate")) {
      return { ok: true, status: 200, json: async () => ({ client_id: "cid", login, user_id: "42", scopes }) }
    }
    return { ok: subscribeStatus < 300, status: subscribeStatus, json: async () => ({}) }
  }
  return { fetchImpl, calls }
}

function manualTimers() {
  const pending = []
  return {
    pending,
    timers: {
      setTimeout: (fn, ms) => { const t = { fn, ms }; pending.push(t); return t },
      clearTimeout: t => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1) },
    },
  }
}

function welcome(id = "sess-1") {
  return { metadata: { message_id: `w-${id}`, message_type: "session_welcome" }, payload: { session: { id, keepalive_timeout_seconds: 10 } } }
}

function redemption(messageId, title = "Lanzar tomates") {
  return {
    metadata: { message_id: messageId, message_type: "notification", subscription_type: REDEMPTION_TYPE },
    payload: { event: { id: `r-${messageId}`, user_id: "7", user_login: "ana", user_name: "Ana", user_input: "", reward: { id: "rw", title, cost: 500 } } },
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

function setup(fetchOptions) {
  const { FakeSocket, opened } = fakeSockets()
  const { fetchImpl, calls } = fakeFetch(fetchOptions)
  const { timers, pending } = manualTimers()
  const emitted = []
  const statuses = []
  const sub = createTwitchEventSub({
    getToken: () => "oauth:abc", getChannel: () => "Canal",
    emit: event => emitted.push(event), onStatus: s => statuses.push(s.state),
    WebSocketImpl: FakeSocket, fetchImpl, timers, log: quietLog,
  })
  return { sub, opened, calls, emitted, statuses, pending }
}

test("normalizeRedemption convierte un canje de EventSub en evento de Mimiku", () => {
  const event = normalizeRedemption({ id: "x1", user_id: "7", user_login: "ana", user_name: "Ana", user_input: " hola ", reward: { id: "rw", title: "Tomates", cost: 300 } })
  assert.equal(event.type, "redemption")
  assert.equal(event.id, "twitch-redemption:x1")
  assert.deepEqual(event.actor, { platformUserId: "7", username: "ana", displayName: "Ana" })
  assert.deepEqual(event.message, { text: "hola" })
  assert.deepEqual(event.payload, { rewardId: "rw", rewardTitle: "Tomates", cost: 300 })
})

test("se suscribe con el id de sesion y entrega cada canje una sola vez", async () => {
  const { sub, opened, calls, emitted, statuses } = setup()
  await sub.start()
  assert.equal(opened.length, 1)
  opened[0].send(welcome())
  await flush()
  const subscribeCall = calls.find(c => c.url.endsWith("/eventsub/subscriptions"))
  const body = JSON.parse(subscribeCall.options.body)
  assert.equal(body.type, REDEMPTION_TYPE)
  assert.deepEqual(body.condition, { broadcaster_user_id: "42" })
  assert.equal(body.transport.session_id, "sess-1")
  assert.equal(subscribeCall.options.headers.Authorization, "Bearer abc")
  assert.equal(statuses.at(-1), "connected")

  opened[0].send(redemption("m1"))
  opened[0].send(redemption("m1")) // reenvio de Twitch
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].payload.rewardTitle, "Lanzar tomates")
})

test("sin el permiso de canjes no abre el socket", async () => {
  const { sub, opened, statuses } = setup({ scopes: ["chat:read", "chat:edit"] })
  await sub.start()
  assert.equal(opened.length, 0)
  assert.equal(statuses.at(-1), "missing-scope")
})

test("un token de otra cuenta se rechaza", async () => {
  const { sub, opened } = setup({ login: "mi_bot" })
  const status = await sub.start()
  assert.equal(opened.length, 0)
  assert.equal(status.state, "wrong-account")
})

test("un canal sin puntos de canal (403) se informa y no reintenta", async () => {
  const { sub, opened, pending } = setup({ subscribeStatus: 403 })
  await sub.start()
  opened[0].send(welcome())
  await flush()
  assert.equal(sub.getStatus().state, "not-affiliate")
  assert.equal(pending.length, 0)
})

test("si se cae el socket reintenta y vuelve a suscribirse", async () => {
  const { sub, opened, pending, calls } = setup()
  await sub.start()
  opened[0].send(welcome())
  await flush()
  opened[0].close()
  assert.equal(sub.getStatus().state, "reconnecting")
  const retry = pending.find(t => t.ms === 2000)
  pending.splice(pending.indexOf(retry), 1)
  retry.fn()
  await flush()
  assert.equal(opened.length, 2)
  opened[1].send(welcome("sess-2"))
  await flush()
  const subscriptions = calls.filter(c => c.url.endsWith("/eventsub/subscriptions"))
  assert.equal(subscriptions.length, 2)
  assert.equal(sub.getStatus().state, "connected")
})

test("session_reconnect se mueve a la nueva URL sin volver a suscribirse", async () => {
  const { sub, opened, calls, emitted } = setup()
  await sub.start()
  opened[0].send(welcome())
  await flush()
  opened[0].send({ metadata: { message_id: "rc", message_type: "session_reconnect" }, payload: { session: { reconnect_url: "wss://otro" } } })
  assert.equal(opened[1].url, "wss://otro")
  opened[1].send(welcome("sess-2"))
  await flush()
  assert.equal(opened[0].closed, true)
  assert.equal(calls.filter(c => c.url.endsWith("/eventsub/subscriptions")).length, 1)
  opened[1].send(redemption("m2"))
  assert.equal(emitted.length, 1)
})

test("stop cierra el socket y no deja reintentos", async () => {
  const { sub, opened, pending } = setup()
  await sub.start()
  opened[0].send(welcome())
  await flush()
  sub.stop()
  assert.equal(opened[0].closed, true)
  assert.equal(pending.length, 0)
  assert.equal(sub.getStatus().state, "off")
})

test("el disparador de canje filtra por nombre sin tildes ni mayusculas", () => {
  const def = nodeDefinition("on_redemption")
  const event = { type: "redemption", platform: "twitch", actor: { displayName: "Ana" }, payload: { rewardTitle: "Lanzar Tomátes" } }
  assert.ok(matchTrigger({ type: "on_redemption", params: { reward: "lanzar tomates" } }, def, event))
  assert.ok(matchTrigger({ type: "on_redemption", params: { reward: "" } }, def, event))
  assert.equal(matchTrigger({ type: "on_redemption", params: { reward: "Bonk" } }, def, event), null)
})

test("la plantilla de tomates usa el canje y lanza tomates", () => {
  const flow = buildTemplateFlow("tomates-canje", "f1")
  const trigger = flow.nodes.find(n => n.type === "on_redemption")
  const throwNode = flow.nodes.find(n => n.type === "throw_objects")
  assert.equal(trigger.params.reward, "Lanzar tomates")
  assert.equal(throwNode.params.object, "tomato")
  assert.ok(flow.links.some(l => l.from === trigger.id && l.to === throwNode.id))
})
