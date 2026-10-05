const test = require("node:test")
const assert = require("node:assert/strict")

const { createJail, parseTarget, formatDuration, normalizeJailConfig } = require("../src/services/jail.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const { createCommandConfigService } = require("../src/services/command-config.js")

const SUB = { platform: "twitch", platformUserId: "1", username: "subdemo", displayName: "SubDemo" }

// Reloj y temporizadores manuales: se avanza el tiempo a mano.
function setup(overrides = {}) {
  const clock = { now: 1_000_000 }
  const timers = []
  const sent = []
  const config = normalizeJailConfig(overrides.config || {})
  const jail = createJail({
    getConfig: () => config,
    getAvatar: async login => (login === "emiligatita" ? "https://cdn.example/emi.png" : null),
    displayNameOf: login => (login === "emiligatita" ? "EmiliGatita" : null),
    getStreamer: () => "canal",
    broadcast: payload => sent.push(payload),
    now: () => clock.now,
    setTimer: (fn, ms) => { const t = { fn, at: clock.now + ms, done: false }; timers.push(t); return t },
    clearTimer: t => { if (t) t.done = true },
  })
  const advance = ms => {
    clock.now += ms
    for (const t of timers) if (!t.done && t.at <= clock.now) { t.done = true; t.fn() }
  }
  return { jail, sent, advance, config }
}

test("!carcel acepta @usuario y rechaza lo que no parece un usuario", () => {
  assert.equal(parseTarget("@Emili_Gatita"), "emili_gatita")
  assert.equal(parseTarget("emiligatita extra"), "emiligatita")
  assert.equal(parseTarget("@"), null)
  assert.equal(parseTarget("<script>"), null)
})

test("la duracion se dice en palabras", () => {
  assert.equal(formatDuration(60), "1 minuto")
  assert.equal(formatDuration(120), "2 minutos")
  assert.equal(formatDuration(45), "45 segundos")
  assert.equal(formatDuration(90), "1 min 30 s")
})

test("encierra: manda la celda con foto, nombres y 1 minuto por defecto", async () => {
  const { jail, sent } = setup()
  const result = await jail.jail(SUB, "@EmiliGatita")
  assert.deepEqual({ ok: result.ok, target: result.target, text: result.durationText }, { ok: true, target: "EmiliGatita", text: "1 minuto" })
  const add = sent[0]
  assert.equal(add.type, "jail_add")
  assert.equal(add.target, "EmiliGatita")
  assert.equal(add.jailer, "SubDemo")
  assert.equal(add.avatar, "https://cdn.example/emi.png")
  assert.equal(add.durationMs, 60000)
})

test("al pasar el tiempo sale libre y se anuncia", async () => {
  const { jail, sent, advance } = setup()
  await jail.jail(SUB, "@emiligatita")
  advance(59_000)
  assert.equal(sent.length, 1)
  advance(1_000)
  assert.deepEqual(sent[1], { type: "jail_release", key: sent[0].key, target: "EmiliGatita", announce: true })
  assert.deepEqual(jail.state().prisoners, [])
})

test("no se puede encerrar dos veces a la misma persona a la vez", async () => {
  const { jail } = setup()
  const [first, second] = await Promise.all([jail.jail(SUB, "@luna"), jail.jail(SUB, "@luna")])
  assert.equal(first.ok, true)
  assert.equal(second.reason, "already")
})

test("al streamer no se le puede encerrar (salvo que se desactive la proteccion)", async () => {
  assert.equal((await setup().jail.jail(SUB, "@Canal")).reason, "streamer")
  assert.equal((await setup({ config: { protect_streamer: false } }).jail.jail(SUB, "@canal")).ok, true)
})

test("si la carcel esta llena hay que esperar", async () => {
  const { jail } = setup({ config: { max_cells: 2 } })
  await jail.jail(SUB, "@a")
  await jail.jail(SUB, "@b")
  assert.equal((await jail.jail(SUB, "@c")).reason, "full")
})

test("sin foto de Twitch se encierra igual (el overlay pone la inicial)", async () => {
  const { jail, sent } = setup()
  await jail.jail(SUB, "@desconocido")
  assert.equal(sent[0].avatar, null)
  assert.equal(sent[0].target, "desconocido")
})

test("un overlay que se reconecta recibe las celdas ocupadas", async () => {
  const { jail } = setup()
  await jail.jail(SUB, "@luna")
  const state = jail.state()
  assert.equal(state.type, "jail_state")
  assert.deepEqual(state.prisoners.map(p => p.target), ["luna"])
})

test("soltar a todos vacia las celdas sin anunciar a cada uno", async () => {
  const { jail, sent } = setup()
  await jail.jail(SUB, "@a")
  await jail.jail(SUB, "@b")
  jail.releaseAll()
  assert.deepEqual(sent.filter(p => p.type === "jail_release").map(p => p.announce), [false, false])
  assert.deepEqual(jail.state().prisoners, [])
})

test("desactivada no encierra a nadie", async () => {
  const { jail, sent } = setup({ config: { enabled: false } })
  assert.equal((await jail.jail(SUB, "@luna")).reason, "disabled")
  assert.equal(sent.length, 0)
})

test("la configuracion se limpia", () => {
  const config = normalizeJailConfig({ duration_s: 1, corner: "centro", max_cells: 99 })
  assert.equal(config.duration_s, 10)
  assert.equal(config.corner, "bottom-left")
  assert.equal(config.max_cells, 8)
})

// ── Comando ──────────────────────────────────────────────────────────────────
function engineWith(ranks, jailImpl) {
  const replies = []
  let saved = null
  const moderation = { moderation: { getConfig: () => saved, setConfig: (_c, _k, value) => { saved = value; return saved } } }
  const commandConfig = createCommandConfigService(moderation, () => "canal", { rankResolver: () => ranks })
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    jail: jailImpl, commandConfig,
  })
  return { engine, replies }
}

function chat(text) {
  return { platform: "twitch", type: "chat_message", metadata: { channel: "canal" }, actor: { platformUserId: "1", username: "subdemo", displayName: "SubDemo" }, message: { text } }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test("!carcel es solo para subs: ni mods sin sub pueden usarlo", async () => {
  const calls = []
  const fake = { jail: async (who, target) => { calls.push(target); return { ok: true, target: "luna", durationText: "1 minuto" } } }
  const mod = engineWith(["twitch:mod"], fake)
  mod.engine.handle(chat("!carcel @luna"))
  await flush()
  assert.equal(calls.length, 0)
  assert.match(mod.replies[0], /solo para: Suscriptor de Twitch\.$/)

  const sub = engineWith(["twitch:sub"], fake)
  sub.engine.handle(chat("!carcel @luna"))
  await flush()
  assert.deepEqual(calls, ["@luna"])
  assert.equal(sub.replies[0], "@SubDemo encerró a @luna en la celda por 1 minuto.")
})

test("!carcel sin usuario explica el uso y avisa si ya esta encerrado", async () => {
  const fake = { jail: async () => ({ ok: false, reason: "already" }) }
  const { engine, replies } = engineWith(["twitch:sub"], fake)
  engine.handle(chat("!carcel"))
  assert.equal(replies[0], "Uso: !carcel @usuario")
  engine.handle({ ...chat("!jail @luna"), actor: { platformUserId: "2", username: "otro", displayName: "Otro" } })
  await flush()
  assert.match(replies[1], /ya está en la celda/)
})
