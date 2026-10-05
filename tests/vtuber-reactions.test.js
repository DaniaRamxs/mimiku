const test = require("node:test")
const assert = require("node:assert/strict")

const { sanitizeConfig, nodeDefinition, eventAmount, renderTemplate } = require("../src/core/vtuber/reaction-catalog.js")
const { createReactionRunner } = require("../src/core/vtuber/reaction-runner.js")

function flow(nodes, links, extra = {}) {
  return { id: "f1", name: "Prueba", enabled: true, nodes, links, ...extra }
}

function node(id, type, params = {}) {
  return { id, type, x: 0, y: 0, params }
}

function event(type, fields = {}) {
  return {
    type, platform: fields.platform || "twitch",
    actor: { username: "ana", displayName: "Ana", ...(fields.actor || {}) },
    message: fields.text ? { text: fields.text } : null,
    payload: fields.payload,
  }
}

function recorder() {
  const calls = []
  const actions = new Proxy({}, { get: (_, name) => async params => { calls.push([name, params]) } })
  return { calls, actions }
}

function runnerFor(flows, overrides = {}) {
  const { calls, actions } = recorder()
  const runner = createReactionRunner({ getFlows: () => flows, actions, sleep: async () => {}, ...overrides })
  return { runner, calls }
}

test("el catalogo rellena parametros por defecto y descarta tipos desconocidos", () => {
  const config = sanitizeConfig({
    flows: [flow([node("a", "on_follow"), node("b", "throw_objects", { count: 9999 }), node("c", "hackear_pc")], [
      { from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "b" },
    ])],
  })
  const [clean] = config.flows
  assert.deepEqual(clean.nodes.map(n => n.type), ["on_follow", "throw_objects"])
  assert.equal(clean.nodes[1].params.count, nodeDefinition("throw_objects").params.find(p => p.key === "count").max)
  assert.equal(clean.nodes[1].params.object, "ball")
  assert.deepEqual(clean.links, [{ from: "a", fromPort: "out", to: "b", toPort: "in" }])
})

test("el catalogo no deja entrar enlaces hacia un disparador", () => {
  const config = sanitizeConfig({ flows: [flow([node("a", "on_follow"), node("b", "on_raid")], [{ from: "a", to: "b" }])] })
  assert.deepEqual(config.flows[0].links, [])
})

test("la cantidad de cada evento sale del dato correcto", () => {
  assert.equal(eventAmount(event("cheer", { payload: { bits: 500 } })), 500)
  assert.equal(eventAmount(event("gift", { payload: { coins: 30, count: 3 } })), 30)
  assert.equal(eventAmount(event("raid", { payload: { viewers: 42 } })), 42)
  assert.equal(eventAmount(event("follow")), 1)
})

test("las plantillas solo sustituyen las variables conocidas", () => {
  assert.equal(renderTemplate("Gracias {usuario} por {cantidad} {otra}", { user: "Ana", amount: 5 }), "Gracias Ana por 5 {otra}")
})

test("un follow dispara la accion enlazada con los datos del viewer", async () => {
  const { runner, calls } = runnerFor([flow([node("t", "on_follow"), node("a", "show_text", { text: "Hola {usuario}" })], [{ from: "t", to: "a" }])])
  const fired = await runner.handle(event("follow"))
  assert.equal(fired, 1)
  assert.deepEqual(calls, [["showText", { text: "Hola Ana", seconds: 5 }]])
})

test("un flujo apagado no reacciona", async () => {
  const { runner, calls } = runnerFor([flow([node("t", "on_follow"), node("a", "show_text")], [{ from: "t", to: "a" }], { enabled: false })])
  assert.equal(await runner.handle(event("follow")), 0)
  assert.deepEqual(calls, [])
})

test("el filtro de cantidad minima corta la rama", async () => {
  const flows = [flow([
    node("t", "on_bits"), node("f", "min_amount", { min: 100 }), node("a", "show_text", { text: "{cantidad} bits" }),
  ], [{ from: "t", to: "f" }, { from: "f", to: "a" }])]
  const { runner, calls } = runnerFor(flows)
  await runner.handle(event("cheer", { payload: { bits: 50 } }))
  assert.deepEqual(calls, [])
  await runner.handle(event("cheer", { payload: { bits: 150 } }))
  assert.deepEqual(calls, [["showText", { text: "150 bits", seconds: 5 }]])
})

test("el comando de chat pasa el resto del mensaje como {mensaje}", async () => {
  const flows = [flow([node("t", "on_command", { command: "!di" }), node("a", "speak", { text: "{usuario} dice {mensaje}" })], [{ from: "t", to: "a" }])]
  const { runner, calls } = runnerFor(flows)
  await runner.handle(event("chat_message", { text: "hola que tal" }))
  await runner.handle(event("chat_message", { text: "!DI hola chat" }))
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "speak")
  assert.equal(calls[0][1].text, "Ana dice hola chat")
})

test("el enfriamiento bloquea repeticiones dentro de la ventana", async () => {
  let clock = 1000
  const flows = [flow([node("t", "on_follow"), node("c", "cooldown", { seconds: 10 }), node("a", "show_text")], [{ from: "t", to: "c" }, { from: "c", to: "a" }])]
  const { runner, calls } = runnerFor(flows, { now: () => clock })
  await runner.handle(event("follow"))
  clock += 5000
  await runner.handle(event("follow"))
  clock += 6000
  await runner.handle(event("follow"))
  assert.equal(calls.length, 2)
})

test("lanzar objetos puede multiplicar por la cantidad sin pasar el tope", async () => {
  const flows = [flow([node("t", "on_bits"), node("a", "throw_objects", { count: 2, perAmount: true })], [{ from: "t", to: "a" }])]
  const { runner, calls } = runnerFor(flows)
  await runner.handle(event("cheer", { payload: { bits: 10 } }))
  await runner.handle(event("cheer", { payload: { bits: 100000 } }))
  assert.equal(calls[0][1].count, 20)
  assert.equal(calls[1][1].count, 100)
})

test("las acciones encadenadas esperan a la anterior y la espera usa sleep", async () => {
  const slept = []
  const flows = [flow([
    node("t", "on_follow"), node("a", "show_text", { text: "uno" }), node("w", "wait", { seconds: 2 }), node("b", "show_text", { text: "dos" }),
  ], [{ from: "t", to: "a" }, { from: "a", to: "w" }, { from: "w", to: "b" }])]
  const { runner, calls } = runnerFor(flows, { sleep: async ms => { slept.push(ms) } })
  await runner.handle(event("follow"))
  assert.deepEqual(calls.map(c => c[1].text), ["uno", "dos"])
  assert.deepEqual(slept, [2000])
})

test("un error en una accion no frena las demas ramas", async () => {
  const errors = []
  const flows = [flow([node("t", "on_follow"), node("a", "vts_hotkey", { hotkeyId: "x" }), node("b", "show_text")], [{ from: "t", to: "a" }, { from: "t", to: "b" }])]
  const actions = {
    vtsHotkey: async () => { throw new Error("VTS cerrado") },
    showText: async () => { errors.push("texto") },
  }
  const runner = createReactionRunner({ getFlows: () => flows, actions, sleep: async () => {}, onError: e => errors.push(e.message) })
  await runner.handle(event("follow"))
  assert.deepEqual(errors.sort(), ["VTS cerrado", "texto"])
})

test("probar un flujo ignora los filtros de disparo y usa un evento de ejemplo", async () => {
  const flows = [flow([node("t", "on_raid"), node("f", "min_amount", { min: 1 }), node("a", "show_text", { text: "{usuario} {cantidad}" })], [{ from: "t", to: "f" }, { from: "f", to: "a" }])]
  const { runner, calls } = runnerFor(flows)
  assert.equal(await runner.test("f1"), true)
  assert.equal(calls[0][1].text, "Viewer de prueba 10")
})

const { buildMoveSteps } = require("../src/core/vtuber/vts-moves.js")

test("cada movimiento del modelo termina donde empezo", () => {
  for (const move of ["shake", "jump", "spin", "zoom", "tilt"]) {
    for (const strength of [10, 60, 100]) {
      const steps = buildMoveSteps(move, strength)
      const sum = key => steps.reduce((total, step) => total + (step[key] || 0), 0)
      assert.ok(Math.abs(sum("x")) < 1e-9 && Math.abs(sum("y")) < 1e-9 && Math.abs(sum("size")) < 1e-9, `${move} ${strength}`)
      assert.equal(sum("rotation") % 360, 0, `${move} ${strength}`)
      assert.ok(steps.every(step => step.seconds > 0 && step.seconds <= 2))
    }
  }
})

const { buildWizardFlow, WIZARD_REACTIONS } = require("../src/core/vtuber/reaction-presets.js")

test("el asistente arma bits -> minimo -> enfriamiento -> acciones en paralelo", () => {
  const built = buildWizardFlow({ id: "w1", trigger: "on_bits", reactions: ["throw", "speak"], minAmount: 100, cooldown: 10 })
  assert.deepEqual(built.nodes.map(n => n.type), ["on_bits", "min_amount", "cooldown", "throw_objects", "speak"])
  const flowLink = (from, fromPort, to) => ({ from, fromPort, to, toPort: "in" })
  assert.deepEqual(built.links, [flowLink("n1", "out", "n2"), flowLink("n2", "pass", "n3"), flowLink("n3", "pass", "n4"), flowLink("n3", "pass", "n5")])
  assert.equal(built.nodes[1].params.min, 100)
  assert.equal(built.name, "Alguien dona bits")
  assert.ok(built.nodes[4].x > built.nodes[2].x && built.nodes[4].y > built.nodes[3].y)
})

test("el asistente usa el comando y descarta la cantidad donde no aplica", () => {
  const built = buildWizardFlow({ id: "w2", trigger: "on_command", command: " !bonk ", reactions: ["throw"], minAmount: 50 })
  assert.equal(built.nodes[0].params.command, "!bonk")
  assert.deepEqual(built.nodes.map(n => n.type), ["on_command", "throw_objects"])
})

test("cada reaccion del asistente produce un nodo valido que el runner sabe ejecutar", async () => {
  const built = buildWizardFlow({ id: "w3", trigger: "on_follow", reactions: WIZARD_REACTIONS.map(r => r.id) })
  assert.equal(built.nodes.length, 1 + WIZARD_REACTIONS.length)
  const { runner, calls } = runnerFor([built])
  await runner.handle(event("follow"))
  assert.equal(calls.length, WIZARD_REACTIONS.length)
})
