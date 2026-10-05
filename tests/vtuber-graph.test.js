const test = require("node:test")
const assert = require("node:assert/strict")

const { sanitizeConfig, nodeCategory, nodeDefinition, NODES, CATEGORIES } = require("../src/core/vtuber/reaction-catalog.js")
const { createReactionRunner } = require("../src/core/vtuber/reaction-runner.js")
const { nodePorts, canConnect } = require("../src/core/vtuber/node-ports.js")

const node = (id, type, params = {}) => ({ id, type, x: 0, y: 0, params })
const flowLink = (from, fromPort, to, toPort = "in") => ({ from, fromPort, to, toPort })

function cleanFlow(nodes, links) {
  return sanitizeConfig({ flows: [{ id: "f1", name: "Prueba", nodes, links }] }).flows[0]
}

function runnerFor(flow, overrides = {}) {
  const calls = []
  const actions = new Proxy({}, { get: (_, name) => async params => { calls.push([name, params]) } })
  const runner = createReactionRunner({ getFlows: () => [flow], actions, sleep: async () => {}, ...overrides })
  return { runner, calls }
}

const follow = (user = "Ana", extra = {}) => ({ type: "follow", platform: "twitch", actor: { username: user.toLowerCase(), displayName: user }, ...extra })

test("los disparadores ofrecen los datos del evento como salidas", () => {
  const ports = nodePorts(nodeDefinition("on_redemption"))
  assert.deepEqual(ports.flowIn, [])
  assert.deepEqual(ports.flowOut.map(p => p.key), ["out"])
  assert.ok(["user", "message", "amount", "reward", "cost"].every(key => ports.dataOut.some(p => p.key === key)))
})

test("cada filtro tiene salida Sí y No, y cada parámetro es una entrada de datos", () => {
  const ports = nodePorts(nodeDefinition("min_amount"))
  assert.deepEqual(ports.flowOut.map(p => p.key), ["pass", "fail"])
  assert.deepEqual(ports.dataIn, [{ key: "min", label: "Mínimo", type: "number" }])
})

test("un cable de datos lleva el viewer del disparador al texto de una acción", async () => {
  const flow = cleanFlow([node("t", "on_follow"), node("a", "show_text", { text: "fijo" })], [
    flowLink("t", "out", "a"), flowLink("t", "user", "a", "text"),
  ])
  const { runner, calls } = runnerFor(flow)
  await runner.handle(follow("Bea"))
  assert.equal(calls[0][1].text, "Bea")
})

test("la salida No de un filtro sigue su propio camino", async () => {
  const flow = cleanFlow([
    node("t", "on_bits"), node("f", "min_amount", { min: 100 }),
    node("si", "show_text", { text: "mucho" }), node("no", "show_text", { text: "poco" }),
  ], [flowLink("t", "out", "f"), flowLink("f", "pass", "si"), flowLink("f", "fail", "no")])
  const { runner, calls } = runnerFor(flow)
  await runner.handle({ type: "cheer", platform: "twitch", actor: { displayName: "Ana" }, payload: { bits: 5 } })
  assert.deepEqual(calls.map(c => c[1].text), ["poco"])
})

test("Comparar usa valores de cables y compara números como números", async () => {
  const flow = cleanFlow([
    node("t", "on_bits"), node("c", "compare", { op: "gt", b: "50" }), node("si", "show_text", { text: "grande" }),
  ], [flowLink("t", "out", "c"), flowLink("t", "amount", "c", "a"), flowLink("c", "pass", "si")])
  const { runner, calls } = runnerFor(flow)
  await runner.handle({ type: "cheer", platform: "twitch", actor: { displayName: "Ana" }, payload: { bits: 100 } })
  await runner.handle({ type: "cheer", platform: "twitch", actor: { displayName: "Ana" }, payload: { bits: 9 } })
  assert.equal(calls.length, 1)
})

test("los nodos de datos se encadenan: número aleatorio -> operación -> cantidad a lanzar", async () => {
  const flow = cleanFlow([
    node("t", "on_follow"), node("r", "random_number", { min: 3, max: 3 }), node("m", "math", { op: "mul", b: 2 }),
    node("a", "throw_objects", { count: 1 }),
  ], [flowLink("t", "out", "a"), flowLink("r", "value", "m", "a"), flowLink("m", "result", "a", "count")])
  const { runner, calls } = runnerFor(flow)
  await runner.handle(follow())
  assert.equal(calls[0][1].count, 6)
})

test("Formar texto junta valores y variables del evento", async () => {
  const flow = cleanFlow([
    node("t", "on_follow"), node("f", "text_format", { template: "{a} y {usuario}", a: "Hola" }), node("a", "show_text"),
  ], [flowLink("t", "out", "a"), flowLink("f", "text", "a", "text")])
  const { runner, calls } = runnerFor(flow)
  await runner.handle(follow("Ana"))
  assert.equal(calls[0][1].text, "Hola y Ana")
})

test("un valor de cable fuera de rango se limita como si se escribiera a mano", async () => {
  const flow = cleanFlow([node("t", "on_follow"), node("n", "value_number", { value: 99999 }), node("a", "throw_objects")], [
    flowLink("t", "out", "a"), flowLink("n", "value", "a", "count"),
  ])
  const { runner, calls } = runnerFor(flow)
  await runner.handle(follow())
  assert.equal(calls[0][1].count, nodeDefinition("throw_objects").params.find(p => p.key === "count").max)
})

test("se descartan cables entre tipos incompatibles, a puertos inexistentes, dobles en una entrada y ciclos", () => {
  const flow = cleanFlow([
    node("t", "on_follow"), node("a", "math"), node("b", "math"), node("x", "show_text"),
  ], [
    flowLink("t", "user", "x", "seconds"), // texto -> número: se permite (puede ser "5")
    flowLink("t", "out", "x", "noexiste"),
    flowLink("t", "user", "a", "op"),
    flowLink("a", "result", "b", "a"),
    flowLink("b", "result", "a", "a"), // ciclo
    flowLink("b", "result", "x", "seconds"), // segunda en la misma entrada
  ])
  assert.deepEqual(flow.links.map(l => `${l.from}.${l.fromPort}>${l.to}.${l.toPort}`), ["t.user>x.seconds", "t.user>a.op", "a.result>b.a"])
  assert.equal(canConnect("bool", "color"), false)
  assert.equal(canConnect("flow", "string"), false)
})

test("Probar desde un nodo ejecuta solo desde ahí con el viewer de ejemplo", async () => {
  const flow = cleanFlow([
    node("t", "on_follow"), node("a", "show_text", { text: "uno" }), node("b", "show_text", { text: "dos" }),
  ], [flowLink("t", "out", "a"), flowLink("a", "done", "b")])
  const { runner, calls } = runnerFor(flow)
  assert.equal(await runner.test("f1", "b"), true)
  assert.deepEqual(calls.map(c => c[1].text), ["dos"])
  assert.equal(await runner.test("f1", "nada"), false)
})

test("todos los nodos tienen categoría del menú", () => {
  const known = new Set(CATEGORIES.map(([id]) => id))
  for (const def of NODES) assert.ok(known.has(nodeCategory(def)), def.type)
})

test("Comparar en modo sencillo usa variables escritas: {cantidad} es mayor que 100", async () => {
  const flow = cleanFlow([
    node("t", "on_bits"), node("c", "compare", { a: "{cantidad}", op: "gt", b: "100" }), node("si", "show_text", { text: "grande" }),
  ], [flowLink("t", "out", "c"), flowLink("c", "pass", "si")])
  const { runner, calls } = runnerFor(flow)
  const cheer = bits => ({ type: "cheer", platform: "twitch", actor: { displayName: "Ana" }, payload: { bits } })
  await runner.handle(cheer(500))
  await runner.handle(cheer(50))
  assert.equal(calls.length, 1)
})
