const test = require("node:test")
const assert = require("node:assert/strict")

const { buildMoveSteps } = require("../src/core/vtuber/vts-moves.js")
const { createVtsEffects } = require("../src/services/vtuber/vts-effects.js")
const { nodeDefinition } = require("../src/core/vtuber/reaction-catalog.js")
const { buildTemplateFlow } = require("../src/core/vtuber/reaction-templates.js")

function total(steps, key) {
  return steps.reduce((sum, step) => sum + (step[key] || 0), 0)
}

// Reloj manual: los temporizadores solo corren con advance().
function manualClock() {
  let time = 0
  let nextId = 1
  const pending = new Map()
  const add = (fn, ms, every) => { const id = nextId++; pending.set(id, { fn, at: time + ms, every }); return id }
  const timers = {
    setTimeout: (fn, ms) => add(fn, ms, 0),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearTimeout: id => pending.delete(id),
    clearInterval: id => pending.delete(id),
  }
  async function advance(ms) {
    const end = time + ms
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      const [id, t] = due
      time = t.at
      if (t.every) t.at += t.every
      else pending.delete(id)
      t.fn()
      await new Promise(resolve => setImmediate(resolve))
    }
    time = end
  }
  return { timers, advance }
}

function fakeVts({ parameterFails = false } = {}) {
  const calls = { moves: [], injected: [], created: 0 }
  return {
    calls,
    moveModel: async step => { calls.moves.push(step) },
    injectParameters: async values => { calls.injected.push(values) },
    createParameter: async () => { calls.created++; if (parameterFails) throw new Error("VTS cerrado") },
  }
}

function effectsWith(vts) {
  const clock = manualClock()
  const effects = createVtsEffects({ vts, wait: async () => {}, timers: clock.timers, log: { warn() {} } })
  return { effects, clock }
}

test("aplastar y recuperar suman cero: el modelo vuelve a su tamaño y sitio", () => {
  for (const strength of [10, 60, 100]) {
    const steps = [...buildMoveSteps("flatten_down", strength), ...buildMoveSteps("flatten_up", strength)]
    assert.ok(Math.abs(total(steps, "size")) < 1e-9)
    assert.ok(Math.abs(total(steps, "y")) < 1e-9)
  }
})

test("el yunque deja el modelo aplastado los segundos pedidos y luego lo recupera", async () => {
  const vts = fakeVts()
  const { effects, clock } = effectsWith(vts)
  await effects.flatten({ strength: 80, seconds: 8, daze: true })
  const down = vts.calls.moves.length
  assert.ok(down > 0)
  assert.ok(total(vts.calls.moves, "size") < 0)

  await clock.advance(7900)
  assert.equal(vts.calls.moves.length, down, "no se recupera antes de tiempo")
  const deform = vts.calls.injected.flat().filter(v => v.id === "MimikuAplastado")
  assert.ok(deform.length > 20 && deform.every(v => v.value === 1), "la deformación se mantiene")

  await clock.advance(2000)
  assert.ok(Math.abs(total(vts.calls.moves, "size")) < 1e-9, "vuelve al tamaño original")
  const last = vts.calls.injected.flat().filter(v => v.id === "MimikuAplastado").at(-1)
  assert.equal(last.value, 0, "la deformación termina en 0")
})

test("los ojos cerrados solo duran el principio", async () => {
  const vts = fakeVts()
  const { effects, clock } = effectsWith(vts)
  await effects.flatten({ strength: 80, seconds: 10, daze: true })
  await clock.advance(1000)
  assert.ok(vts.calls.injected.at(-1).some(v => v.id === "EyeOpenLeft"))
  await clock.advance(4000)
  assert.ok(!vts.calls.injected.at(-1).some(v => v.id === "EyeOpenLeft"))
})

test("un segundo yunque alarga el aplastado sin encoger más", async () => {
  const vts = fakeVts()
  const { effects, clock } = effectsWith(vts)
  await effects.flatten({ strength: 80, seconds: 5, daze: false })
  const shrunk = total(vts.calls.moves, "size")
  await clock.advance(4000)
  await effects.flatten({ strength: 80, seconds: 5, daze: false })
  assert.equal(total(vts.calls.moves, "size"), shrunk)
  await clock.advance(4500)
  assert.equal(total(vts.calls.moves, "size"), shrunk, "sigue aplastado por el segundo yunque")
  await clock.advance(1000)
  assert.ok(Math.abs(total(vts.calls.moves, "size")) < 1e-9)
})

test("sin el parámetro propio igual se aplasta y se recupera", async () => {
  const vts = fakeVts({ parameterFails: true })
  const { effects, clock } = effectsWith(vts)
  await effects.flatten({ strength: 50, seconds: 2, daze: false })
  await clock.advance(3000)
  assert.ok(!vts.calls.injected.flat().some(v => v.id === "MimikuAplastado"))
  assert.ok(Math.abs(total(vts.calls.moves, "size")) < 1e-9)
})

test("el nodo yunque marca silencioso el golpe que viene de otro golpe", () => {
  const def = nodeDefinition("anvil")
  const params = { size: 220, flatten: true, seconds: 8, strength: 80, daze: true }
  assert.equal(def.build(params, { user: "Ana", event: { type: "object_hit" } }).silent, true)
  assert.equal(def.build(params, { user: "Ana", event: { type: "redemption" } }).silent, false)
})

test("las plantillas de yunque usan la acción yunque", () => {
  for (const id of ["yunque", "yunque-canje"]) {
    const flow = buildTemplateFlow(id, "f1")
    assert.ok(flow.nodes.some(n => n.type === "anvil"), id)
  }
})
