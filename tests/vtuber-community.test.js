const test = require("node:test")
const assert = require("node:assert/strict")

const { createReactionRunner } = require("../src/core/vtuber/reaction-runner.js")
const { pickChatObject } = require("../src/core/vtuber/nodes-actions.js")
const { createHitStats } = require("../src/core/vtuber/hit-stats.js")
const { createBossMode } = require("../src/core/vtuber/boss-mode.js")
const { circleAvatar } = require("../src/core/vtuber/avatar-mask.js")
const { sanitizeConfig } = require("../src/core/vtuber/reaction-catalog.js")

const node = (id, type, params = {}) => ({ id, type, x: 0, y: 0, params })
const flow = (nodes, links) => ({ id: "f", name: "F", enabled: true, nodes, links })
const chain = (...ids) => ids.slice(1).map((to, i) => ({ from: ids[i], to }))

function runnerFor(flows, overrides = {}) {
  const calls = []
  const actions = new Proxy({}, { get: (_, name) => async params => { calls.push([name, params]) } })
  const runner = createReactionRunner({ getFlows: () => flows, actions, sleep: async () => {}, ...overrides })
  return { runner, calls }
}

const chat = (text, actor = {}) => ({
  type: "chat_message", platform: "twitch", message: { text },
  actor: { username: "ana", displayName: "Ana", platformUserId: "u1", ...actor },
})

test("!lanzar tomate lanza un tomate y respeta la lista de permitidos", () => {
  assert.equal(pickChatObject("tomate", ""), "tomato")
  assert.equal(pickChatObject("Huevo por favor", ""), "egg")
  assert.equal(pickChatObject("bola de nieve", ""), "snowball")
  assert.equal(pickChatObject("CORAZÓN", ""), "heart")
  assert.equal(pickChatObject("tomate", "huevo, pelota"), "egg")
  assert.equal(pickChatObject("", "estrella"), "star")
})

test("el comando pasa el objeto pedido, el nombre y la foto del viewer", async () => {
  const { runner, calls } = runnerFor([flow([
    node("t", "on_command", { command: "!lanzar" }), node("a", "throw_objects", { object: "chat", showName: true }),
  ], chain("t", "a"))])
  await runner.handle(chat("!lanzar huevo", { avatarUrl: "https://x/a.png" }))
  assert.equal(calls[0][1].object, "egg")
  assert.equal(calls[0][1].label, "Ana")
  assert.equal(calls[0][1].by, "Ana")
  const { runner: r2, calls: c2 } = runnerFor([flow([node("t", "on_command", { command: "!foto" }), node("a", "throw_objects", { object: "avatar" })], chain("t", "a"))])
  await r2.handle(chat("!foto", { avatarUrl: "https://x/a.png" }))
  assert.deepEqual(c2[0][1].viewer, { name: "Ana", username: "ana", platform: "twitch", avatarUrl: "https://x/a.png" })
})

test("el enfriamiento por viewer deja atacar a otros mientras uno espera", async () => {
  const { runner, calls } = runnerFor([flow([
    node("t", "on_command", { command: "!atacar" }), node("c", "cooldown", { seconds: 60, perViewer: true }), node("a", "show_text"),
  ], chain("t", "c", "a"))])
  await runner.handle(chat("!atacar"))
  await runner.handle(chat("!atacar"))
  await runner.handle(chat("!atacar", { username: "bea", displayName: "Bea", platformUserId: "u2" }))
  assert.equal(calls.length, 2)
})

test("cobrar puntos corta la rama si al viewer no le alcanza", async () => {
  const charged = []
  const { runner, calls } = runnerFor([flow([
    node("t", "on_command", { command: "!escudo" }), node("p", "cost_points", { points: 500 }), node("a", "shield"),
  ], chain("t", "p", "a"))], {
    chargePoints: async (ctx, points) => { charged.push([ctx.username, points]); return ctx.username === "rica" },
  })
  await runner.handle(chat("!escudo"))
  await runner.handle(chat("!escudo", { username: "rica", displayName: "Rica" }))
  assert.deepEqual(charged, [["ana", 500], ["rica", 500]])
  assert.equal(calls.length, 1)
})

test("probar un flujo no cobra puntos", async () => {
  let charged = 0
  const { runner, calls } = runnerFor([flow([node("t", "on_command"), node("p", "cost_points"), node("a", "shield")], chain("t", "p", "a"))], {
    chargePoints: async () => { charged++; return false },
  })
  await runner.test("f")
  assert.equal(charged, 0)
  assert.equal(calls.length, 1)
})

test("el combo dispara al llegar a N golpes y vuelve a contar desde cero", async () => {
  let clock = 100000
  const { runner, calls } = runnerFor([flow([node("t", "on_hit_combo", { hits: 3, seconds: 10 }), node("a", "dizzy_stars")], chain("t", "a"))], { now: () => clock })
  const hits = []
  const hit = async () => { hits.push(clock); await runner.handle({ type: "object_hit", platform: "mimiku", actor: {}, payload: { recentHits: [...hits] } }); clock += 1000 }
  await hit(); await hit()
  assert.equal(calls.length, 0)
  await hit()
  assert.equal(calls.length, 1)
  await hit(); await hit()
  assert.equal(calls.length, 1)
  await hit()
  assert.equal(calls.length, 2)
})

test("el rebote al golpe recibe el lado del impacto", async () => {
  const { runner, calls } = runnerFor([flow([node("t", "on_hit"), node("a", "vts_move", { move: "recoil" })], chain("t", "a"))])
  await runner.handle({ type: "object_hit", platform: "mimiku", actor: { displayName: "Ana" }, payload: { direction: -1 } })
  assert.equal(calls[0][1].direction, -1)
})

test("el contador de golpes lleva hoy, record y top de atacantes, y reinicia al cambiar de dia", () => {
  let clock = new Date(2026, 9, 1, 20, 0).getTime()
  const saves = []
  const stats = createHitStats({ now: () => clock, onChange: s => saves.push(s) })
  for (const by of ["Ana", "Bea", "Ana", "Ana", "Cris", "Bea", ""]) stats.record(by)
  const snap = stats.snapshot()
  assert.equal(snap.today, 7)
  assert.equal(snap.record, 7)
  assert.deepEqual(snap.top, [{ name: "Ana", hits: 3 }, { name: "Bea", hits: 2 }, { name: "Cris", hits: 1 }])
  clock = new Date(2026, 9, 2, 9, 0).getTime()
  stats.record("Dani")
  assert.deepEqual({ ...stats.snapshot(), top: undefined }, { today: 1, record: 7, total: 8, top: undefined })
  assert.equal(saves.length, 8)
})

test("el contador acepta un estado guardado roto sin fallar", () => {
  const stats = createHitStats({ saved: { day: 5, today: -3, record: "x", attackers: { Ana: 2, ["x".repeat(50)]: 9 } } })
  assert.deepEqual(stats.snapshot().top, [])
})

test("el modo jefe se gana con los golpes necesarios y se pierde por tiempo", () => {
  let clock = 0
  const boss = createBossMode({ now: () => clock })
  boss.start({ title: "Jefe", hits: 3, seconds: 30 })
  assert.equal(boss.hit("Ana").won, false)
  boss.hit("Bea")
  const last = boss.hit("Ana")
  assert.equal(last.won, true)
  assert.deepEqual(last.state.top[0], { name: "Ana", hits: 2 })
  assert.equal(boss.isActive(), false)
  boss.start({ title: "Jefe", hits: 3, seconds: 30 })
  clock = 31000
  assert.equal(boss.hit("Ana").counted, false)
  assert.equal(boss.expire(), true)
  assert.equal(boss.expire(), false)
})

test("el avatar queda redondo: esquinas transparentes y centro intacto", () => {
  const size = 16
  const photo = Buffer.alloc(size * size * 4, 200)
  const out = circleAvatar(photo, size, { ringColor: "#ff0000", ringWidth: 2 })
  assert.equal(out[3], 0)
  const center = ((8 * size) + 8) * 4
  assert.deepEqual([...out.subarray(center, center + 4)], [200, 200, 200, 200])
  const edge = ((8 * size) + 1) * 4
  assert.equal(out[edge + 2], 255)
  assert.equal(photo[3], 200)
})

test("la escena guarda el contador y las partes de la cabeza", () => {
  const { stage } = sanitizeConfig({ stage: { showCounter: true, counterCorner: "zz", headMeshes: "Pelo" } })
  assert.equal(stage.showCounter, true)
  assert.equal(stage.counterCorner, "tr")
  assert.equal(stage.headMeshes, "Pelo")
})

const { TEMPLATES, buildTemplateFlow } = require("../src/core/vtuber/reaction-templates.js")

test("cada plantilla de comunidad produce un flujo valido y sin nodos perdidos", () => {
  for (const template of TEMPLATES) {
    const built = buildTemplateFlow(template.id, `t-${template.id}`)
    const expected = template.branches.reduce((total, branch) => total + branch.length - 1 + branch[branch.length - 1].length, 0)
    assert.equal(built.nodes.length, expected, template.id)
    assert.equal(built.links.length, expected - template.branches.length, template.id)
    assert.equal(built.name, template.title)
  }
})

test("la plantilla !atacar pega el avatar con enfriamiento por viewer", async () => {
  const built = buildTemplateFlow("atacar", "a1")
  const { runner, calls } = runnerFor([built])
  await runner.handle(chat("!atacar"))
  await runner.handle(chat("!atacar"))
  await runner.handle(chat("!atacar", { username: "bea", displayName: "Bea", platformUserId: "u2" }))
  assert.deepEqual(calls.map(c => [c[0], c[1].viewer.name]), [["attachAvatar", "Ana"], ["attachAvatar", "Bea"]])
})

test("la plantilla del jefe solo la lanzan los mods", async () => {
  const { runner, calls } = runnerFor([buildTemplateFlow("jefe", "j1")])
  await runner.handle(chat("!jefe"))
  await runner.handle(chat("!jefe", { isModerator: true }))
  assert.deepEqual(calls.map(c => c[0]), ["bossMode"])
})
