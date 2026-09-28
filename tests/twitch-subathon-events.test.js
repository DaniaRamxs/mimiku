// Los eventos de Twitch (subs, regalos y bits) llegan al subathon.
// Se sustituyen tmi.js, la economia y el subathon por dobles antes de cargar
// el adaptador, para no depender de red ni de SQLite.
const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { EventEmitter } = require("node:events")

function stubModule(relativePath, exports) {
  const file = require.resolve(path.join(__dirname, "..", relativePath))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}

let lastClient = null
class FakeClient extends EventEmitter {
  constructor() { super(); lastClient = this }
  connect() { return Promise.resolve() }
  disconnect() { return Promise.resolve() }
  say() { return Promise.resolve() }
}
require.cache[require.resolve("tmi.js")] = { id: "tmi.js", filename: "tmi.js", loaded: true, exports: { Client: FakeClient } }

const calls = []
stubModule("src/services/economy.js", { addPoints: () => ({}) })
stubModule("src/services/subathon.js", {
  getDefaultSubathon: () => ({
    recordTwitchSub: input => calls.push(["sub", input]),
    recordTwitchBits: input => calls.push(["bits", input]),
  }),
})

const adapter = require("../src/integrations/twitch/twitch-adapter.js")
adapter.connect("canal", "")

test.beforeEach(() => { calls.length = 0 })

test("sub y resub suman al subathon con su tier e id", () => {
  lastClient.emit("subscription", "#canal", "luna", { plan: "2000" }, "", { id: "s1", "display-name": "Luna", "msg-param-sub-plan": "2000" })
  lastClient.emit("resub", "#canal", "sol", 5, "", { id: "s2", "display-name": "Sol", "msg-param-sub-plan": "1000" })
  assert.deepEqual(calls.map(([kind, input]) => [kind, input.id, input.user, input.plan]), [
    ["sub", "s1", "Luna", "2000"],
    ["sub", "s2", "Sol", "1000"],
  ])
})

test("cada sub regalado cuenta, tambien los anonimos", () => {
  lastClient.emit("subgift", "#canal", "mimi", 0, "ana", {}, { id: "g1", "display-name": "Mimi", "msg-param-sub-plan": "1000" })
  lastClient.emit("anonsubgift", "#canal", 0, "bea", {}, { id: "g2", "msg-param-sub-plan": "1000" })
  assert.deepEqual(calls.map(([, input]) => [input.id, input.user]), [["g1", "Mimi"], ["g2", "Anónimo"]])
})

test("el anuncio de un lote de regalos no cuenta: cuentan sus subgift individuales", () => {
  lastClient.emit("submysterygift", "#canal", "mimi", 5, {}, { id: "m1", "display-name": "Mimi" })
  lastClient.emit("anonsubmysterygift", "#canal", 3, {}, { id: "m2" })
  assert.equal(calls.length, 0)
})

test("los bits de un cheer llegan al subathon", () => {
  lastClient.emit("cheer", "#canal", { id: "c1", username: "luna", "display-name": "Luna", bits: "250" }, "Cheer250")
  assert.deepEqual(calls, [["bits", { id: "c1", user: "Luna", bits: 250 }]])
})
