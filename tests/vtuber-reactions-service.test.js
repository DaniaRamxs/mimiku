const test = require("node:test")
const assert = require("node:assert/strict")

const { createVtuberReactionsService, ENGINE_EVENT_TYPES } = require("../src/services/vtuber-reactions.js")

// Temporizadores manuales: `fire()` ejecuta lo pendiente sin esperar de verdad.
function manualTimers() {
  const pending = new Map()
  let next = 1
  const add = (fn, repeat) => { const id = next++; pending.set(id, { fn, repeat }); return id }
  return {
    setTimeout: fn => add(fn, false), setInterval: fn => add(fn, true),
    clearTimeout: id => pending.delete(id), clearInterval: id => pending.delete(id),
    fire() { for (const [id, t] of [...pending]) { if (!t.repeat) pending.delete(id); t.fn() } },
    count: () => pending.size,
  }
}

function setup(initial = {}, overrides = {}) {
  const sent = []
  const vtsCalls = []
  const spoken = []
  let saved = null
  let clock = 10000
  const timers = manualTimers()
  const vts = new Proxy({}, { get: (_, name) => async arg => { vtsCalls.push([name, arg]) } })
  const service = createVtuberReactionsService({
    store: { load: () => initial, save: data => { saved = data } },
    broadcast: payload => sent.push(payload),
    vts, speakInWindow: payload => spoken.push(payload),
    now: () => clock, sleep: async () => {}, timers, random: () => 0.5, log: { warn() {} },
    ...overrides,
  })
  return { service, sent, vtsCalls, spoken, timers, saved: () => saved, tick: ms => { clock += ms } }
}

const flowWith = (actionType, params = {}, trigger = "on_follow") => ({
  flows: [{ id: "f", name: "F", nodes: [{ id: "t", type: trigger }, { id: "a", type: actionType, params }], links: [{ from: "t", to: "a" }] }],
})

const follow = { type: "follow", platform: "twitch", actor: { displayName: "Ana" } }

test("escucha los eventos de los disparadores menos el impacto", () => {
  assert.ok(ENGINE_EVENT_TYPES.includes("follow") && ENGINE_EVENT_TYPES.includes("cheer") && ENGINE_EVENT_TYPES.includes("gift"))
  assert.ok(!ENGINE_EVENT_TYPES.includes("object_hit"))
})

test("guardar limpia la config, la persiste y avisa al overlay de la escena", () => {
  const { service, sent, saved } = setup()
  service.saveConfig({ flows: [], stage: { headX: 999 } })
  assert.equal(saved().stage.headX, 100)
  assert.equal(sent.at(-1).type, "vtuber_stage")
  assert.equal(sent.at(-1).headX, 100)
  assert.equal(sent.at(-1).showCounter, false)
})

test("lanzar objetos manda los objetos al overlay", async () => {
  const { service, sent } = setup(flowWith("throw_objects", { object: "star", count: 3 }))
  await service.handleEvent(follow)
  assert.equal(sent[0].type, "vtuber_throw")
  assert.equal(sent[0].object, "star")
  assert.equal(sent[0].count, 3)
})

test("el tinte del modelo se quita solo al terminar", async () => {
  const { service, vtsCalls, timers } = setup(flowWith("vts_tint", { color: "#ff0080", seconds: 3 }))
  await service.handleEvent(follow)
  assert.deepEqual(vtsCalls[0], ["tintModel", { r: 255, g: 0, b: 128, rainbow: false }])
  timers.fire()
  assert.deepEqual(vtsCalls[1], ["tintModel", { r: 255, g: 255, b: 255 }])
})

test("mover el modelo manda todos los pasos de la coreografia", async () => {
  const { service, vtsCalls } = setup(flowWith("vts_move", { move: "jump" }))
  await service.handleEvent(follow)
  assert.deepEqual(vtsCalls.map(c => c[0]), ["moveModel", "moveModel"])
})

test("los impactos de objetos se limitan en el tiempo", async () => {
  const { service, sent, tick } = setup(flowWith("show_text", { text: "auch" }, "on_hit"))
  await service.handleHit()
  await service.handleHit()
  tick(400)
  await service.handleHit()
  assert.equal(sent.filter(p => p.type === "alert").length, 2)
})

test("el texto a voz va a la ventana y la boca se mueve mientras habla", async () => {
  const { service, spoken, vtsCalls, timers } = setup(flowWith("speak", { text: "Hola {usuario}" }))
  await service.handleEvent(follow)
  assert.equal(spoken[0].text, "Hola Ana")
  service.speechState(true, true)
  timers.fire()
  assert.equal(vtsCalls[0][0], "injectParameters")
  service.speechState(false)
  assert.deepEqual(vtsCalls.at(-1), ["injectParameters", [{ id: "MouthOpen", value: 0 }]])
  assert.equal(timers.count(), 0)
})

test("sin lip-sync la voz no toca la boca", () => {
  const { service, vtsCalls, timers } = setup()
  service.speechState(true, false)
  timers.fire()
  assert.deepEqual(vtsCalls, [])
})

test("los objetos lanzados por un impacto no vuelven a reportar impactos", async () => {
  const { service, sent } = setup(flowWith("throw_objects", {}, "on_hit"))
  await service.handleHit()
  const thrown = sent.find(p => p.type === "vtuber_throw")
  assert.equal(thrown.silent, true)
  const other = setup(flowWith("throw_objects"))
  await other.service.handleEvent(follow)
  assert.equal(other.sent[0].silent, false)
})

// ── Comunidad ──
const chatCommand = (text, actor = {}) => ({
  type: "chat_message", platform: "twitch", message: { text },
  actor: { username: "ana", displayName: "Ana", platformUserId: "u1", ...actor },
})
const commandFlow = (command, ...nodes) => ({
  flows: [{ id: "f", name: "F", nodes: [{ id: "t", type: "on_command", params: { command } }, ...nodes.map((n, i) => ({ id: `n${i}`, ...n }))],
    links: nodes.map((_, i) => ({ from: i ? `n${i - 1}` : "t", to: `n${i}` })) }],
})

test("cobrar puntos usa la economia y solo sigue si cobro", async () => {
  const charges = []
  const { service, sent } = setup(commandFlow("!escudo", { type: "cost_points", params: { points: 300 } }, { type: "shield", params: { seconds: 20 } }), {
    points: { charge: async (ctx, n) => { charges.push([ctx.username, n]); return ctx.username === "rica" } },
  })
  await service.handleEvent(chatCommand("!escudo"))
  await service.handleEvent(chatCommand("!escudo", { username: "rica", displayName: "Rica" }))
  assert.deepEqual(charges, [["ana", 300], ["rica", 300]])
  assert.deepEqual(sent.filter(p => p.type === "vtuber_shield"), [{ type: "vtuber_shield", seconds: 20, by: "Rica" }])
})

test("el bonk baja el martillo y aplasta el modelo", async () => {
  const { service, sent, vtsCalls } = setup(commandFlow("!bonk", { type: "bonk", params: {} }))
  await service.handleEvent(chatCommand("!bonk"))
  assert.equal(sent[0].type, "vtuber_bonk")
  assert.equal(sent[0].by, "Ana")
  assert.ok(vtsCalls.length >= 2 && vtsCalls.every(c => c[0] === "moveModel"))
})

test("lanzar la foto del viewer usa su avatar y sin foto cae a una pelota", async () => {
  const { service, sent } = setup(commandFlow("!foto", { type: "throw_objects", params: { object: "avatar", count: 1 } }), {
    avatars: { avatarUrl: async viewer => (viewer.username === "ana" ? "https://cdn/ana.png" : null) },
  })
  await service.handleEvent(chatCommand("!foto"))
  await service.handleEvent(chatCommand("!foto", { username: "nadie", displayName: "Nadie" }))
  const throws = sent.filter(p => p.type === "vtuber_throw")
  assert.deepEqual(throws.map(t => [t.object, t.image]), [["avatar", "https://cdn/ana.png"], ["ball", ""]])
  assert.ok(throws.every(t => !("viewer" in t)))
})

function attachSetup(connected) {
  const attached = []
  const ctx = setup(commandFlow("!atacar", { type: "attach_avatar", params: { flyIn: true } }), {
    vts: { isConnected: () => connected },
    avatars: { avatarUrl: async () => "https://cdn/ana.png" },
    accessories: { attachAvatar: async p => { attached.push(p.viewer.name) } },
  })
  return { ...ctx, attached }
}

test("!atacar con VTube Studio: el avatar llega volando y se pega al modelo", async () => {
  const { service, sent, attached } = attachSetup(true)
  await service.handleEvent(chatCommand("!atacar"))
  const flight = sent.find(p => p.type === "vtuber_throw")
  assert.equal(flight.image, "https://cdn/ana.png")
  assert.equal(flight.vanish, true)
  assert.equal(flight.sticky, false)
  assert.deepEqual(attached, ["Ana"])
})

test("!atacar sin VTube Studio: el avatar se queda pegado en el overlay", async () => {
  const { service, sent, attached } = attachSetup(false)
  await service.handleEvent(chatCommand("!atacar"))
  assert.equal(sent.find(p => p.type === "vtuber_throw").sticky, true)
  assert.deepEqual(attached, [])
})

test("cada golpe suma al contador con el nombre de quien lo lanzo", async () => {
  const { service, tick } = setup()
  await service.handleHit({ by: "Ana", direction: -1 })
  tick(100)
  await service.handleHit({ by: "Ana" })
  tick(100)
  await service.handleHit({ by: "Bea" })
  const hits = service.hits()
  assert.equal(hits.today, 3)
  assert.deepEqual(hits.top[0], { name: "Ana", hits: 2 })
})

test("el modo jefe cuenta golpes y al ganar dispara su reaccion", async () => {
  const flows = {
    flows: [
      { id: "a", name: "A", nodes: [{ id: "t", type: "on_command", params: { command: "!jefe" } }, { id: "b", type: "boss_mode", params: { hits: 5, seconds: 60 } }], links: [{ from: "t", to: "b" }] },
      { id: "w", name: "W", nodes: [{ id: "t", type: "on_boss_win" }, { id: "x", type: "show_text", params: { text: "Gana {usuario}" } }], links: [{ from: "t", to: "x" }] },
    ],
  }
  const { service, sent, tick } = setup(flows)
  await service.handleEvent(chatCommand("!jefe"))
  assert.equal(sent.find(p => p.type === "vtuber_boss").active, true)
  for (let i = 0; i < 4; i++) { await service.handleHit({ by: "Bea" }); tick(100) }
  assert.equal(sent.filter(p => p.type === "vtuber_boss").at(-1).result, undefined)
  await service.handleHit({ by: "Bea" })
  assert.equal(sent.filter(p => p.type === "vtuber_boss").at(-1).result, "win")
  assert.equal(sent.find(p => p.type === "alert").text, "Gana Bea")
})

test("el modo jefe se pierde si se acaba el tiempo", async () => {
  const flows = {
    flows: [
      { id: "a", name: "A", nodes: [{ id: "t", type: "on_command", params: { command: "!jefe" } }, { id: "b", type: "boss_mode", params: { hits: 50, seconds: 10 } }], links: [{ from: "t", to: "b" }] },
      { id: "l", name: "L", nodes: [{ id: "t", type: "on_boss_fail" }, { id: "x", type: "show_text", params: { text: "Perdisteis" } }], links: [{ from: "t", to: "x" }] },
    ],
  }
  const { service, sent, timers } = setup(flows)
  await service.handleEvent(chatCommand("!jefe"))
  timers.fire()
  await new Promise(setImmediate)
  assert.equal(sent.filter(p => p.type === "vtuber_boss").at(-1).result, "fail")
  assert.equal(sent.find(p => p.type === "alert").text, "Perdisteis")
})

test("un overlay recien conectado recibe escena, contador y jefe", () => {
  const { service } = setup()
  assert.deepEqual(service.overlayState().map(m => m.type), ["vtuber_stage", "vtuber_hits", "vtuber_boss"])
})
