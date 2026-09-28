const test = require("node:test")
const assert = require("node:assert/strict")

const { createSubathon } = require("../src/services/subathon.js")
const { normalizeGoalConfig, activeMilestone } = require("../src/services/subathon-goals.js")

const MIN = 60_000
const HOUR = 60 * MIN

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial))
  return { load: key => data.get(key), save: (key, value) => data.set(key, JSON.parse(JSON.stringify(value))), data }
}

function setup({ store = memoryStore() } = {}) {
  const clock = { now: 1_000_000 }
  const timerEvents = []
  const goalEvents = []
  const subathon = createSubathon({
    store, now: () => clock.now,
    onTimerChange: (snap, detail) => timerEvents.push({ snap, detail }),
    onGoalChange: (snap, detail) => goalEvents.push({ snap, detail }),
  })
  const advance = ms => { clock.now += ms }
  return { subathon, timer: subathon.timer, goals: subathon.goals, clock, advance, store, timerEvents, goalEvents }
}

function running(hours = 1) {
  const ctx = setup()
  ctx.timer.setRemaining(hours * HOUR)
  ctx.timer.start()
  return ctx
}

// ── Contador ─────────────────────────────────────────────────────────────────
test("por defecto: 10 min por sub y 10 min por cada 100 bits", () => {
  const { timer } = setup()
  assert.equal(timer.getConfig().minutesPerSub, 10)
  assert.equal(timer.getConfig().minutesPerHundredBits, 10)
})

test("no se puede empezar sin tiempo inicial", () => {
  const { timer } = setup()
  assert.throws(() => timer.start(), /tiempo inicial/)
})

test("en marcha descuenta con el reloj y en pausa se congela", () => {
  const { timer, advance } = running(2)
  advance(30 * MIN)
  assert.equal(timer.snapshot().remainingMs, 90 * MIN)
  timer.pause()
  advance(HOUR)
  assert.equal(timer.snapshot().remainingMs, 90 * MIN)
  timer.start()
  advance(10 * MIN)
  assert.equal(timer.snapshot().remainingMs, 80 * MIN)
})

test("un sub suma 10 minutos y queda en el historial", () => {
  const { subathon, timer } = running(1)
  subathon.recordTwitchSub({ id: "a", user: "Luna" })
  assert.equal(timer.snapshot().remainingMs, 70 * MIN)
  assert.equal(timer.snapshot().history[0].user, "Luna")
  assert.equal(timer.snapshot().history[0].source, "sub")
})

test("el mismo evento de Twitch repetido solo cuenta una vez", () => {
  const { subathon, timer, goals } = running(1)
  subathon.recordTwitchSub({ id: "dup" })
  assert.equal(subathon.recordTwitchSub({ id: "dup" }).duplicate, true)
  assert.equal(timer.snapshot().remainingMs, 70 * MIN)
  assert.equal(goals.snapshot("subs").count, 1)
})

test("los bits suman por cada 100 y guardan el sobrante", () => {
  const { subathon, timer } = running(1)
  subathon.recordTwitchBits({ id: "b1", bits: 150 })
  assert.equal(timer.snapshot().remainingMs, 70 * MIN)
  assert.equal(timer.snapshot().bitsCarry, 50)
  subathon.recordTwitchBits({ id: "b2", bits: 50 })
  assert.equal(timer.snapshot().remainingMs, 80 * MIN)
  assert.equal(timer.snapshot().bitsCarry, 0)
})

test("con tiers activos, tier 2 vale x2 y tier 3 x5", () => {
  const { subathon, timer } = running(1)
  timer.setConfig({ tierWeights: true })
  subathon.recordTwitchSub({ id: "t2", plan: "2000" })
  assert.equal(timer.snapshot().remainingMs, 80 * MIN)
  subathon.recordTwitchSub({ id: "t3", plan: "3000" })
  assert.equal(timer.snapshot().remainingMs, 130 * MIN)
  subathon.recordTwitchSub({ id: "p", plan: "Prime" })
  assert.equal(timer.snapshot().remainingMs, 140 * MIN)
})

test("sin tiers, cualquier sub vale lo mismo", () => {
  const { subathon, timer } = running(1)
  subathon.recordTwitchSub({ id: "t3", plan: "3000" })
  assert.equal(timer.snapshot().remainingMs, 70 * MIN)
})

test("antes de empezar, los subs no suman tiempo pero si cuentan para la meta", () => {
  const { subathon, timer, goals } = setup()
  timer.setRemaining(HOUR)
  subathon.recordTwitchSub({ id: "x" })
  assert.equal(timer.snapshot().remainingMs, HOUR)
  assert.equal(goals.snapshot("subs").count, 1)
})

test("en pausa los subs si suman", () => {
  const { subathon, timer } = running(1)
  timer.pause()
  subathon.recordTwitchSub({ id: "x" })
  assert.equal(timer.snapshot().remainingMs, 70 * MIN)
})

test("tiempo manual (StreamElements / Yape) en horas y minutos, y quitar tiempo", () => {
  const { timer } = running(1)
  timer.add(1 * HOUR + 30 * MIN, { source: "manual", label: "Yape · Luna 20 soles" })
  assert.equal(timer.snapshot().remainingMs, 150 * MIN)
  assert.equal(timer.snapshot().history[0].label, "Yape · Luna 20 soles")
  timer.add(-20 * MIN, { source: "manual", label: "correccion" })
  assert.equal(timer.snapshot().remainingMs, 130 * MIN)
})

test("el tiempo manual antes de empezar se suma al tiempo inicial", () => {
  const { timer } = setup()
  timer.setRemaining(HOUR)
  timer.add(30 * MIN, { source: "manual" })
  assert.equal(timer.snapshot().remainingMs, 90 * MIN)
})

test("quitar mas tiempo del que queda deja el contador en 0, no negativo", () => {
  const { timer } = running(1)
  timer.add(-5 * HOUR, { source: "manual" })
  assert.equal(timer.snapshot().remainingMs, 0)
})

test("al llegar a 0 termina, avisa y ya no suma subs", () => {
  const { subathon, timer, advance, timerEvents } = running(1)
  advance(HOUR + 1000)
  timer.settle()
  assert.equal(timer.snapshot().status, "ended")
  assert.equal(timerEvents.at(-1).detail.ended, true)
  subathon.recordTwitchSub({ id: "tarde" })
  assert.equal(timer.snapshot().remainingMs, 0)
})

test("el contador sobrevive a un reinicio de Mimiku", () => {
  const first = running(2)
  first.subathon.recordTwitchSub({ id: "a" })
  first.advance(10 * MIN)
  const reopened = createSubathon({ store: first.store, now: () => first.clock.now })
  assert.equal(reopened.timer.snapshot().status, "running")
  assert.equal(reopened.timer.snapshot().remainingMs, 120 * MIN)
  assert.equal(reopened.goals.snapshot("subs").count, 1)
})

test("reiniciar deja el contador vacio", () => {
  const { timer } = running(1)
  timer.reset()
  assert.deepEqual({ status: timer.snapshot().status, ms: timer.snapshot().remainingMs }, { status: "idle", ms: 0 })
})

test("minutos por sub en 0 desactiva la suma automatica", () => {
  const { subathon, timer } = running(1)
  timer.setConfig({ minutesPerSub: 0 })
  subathon.recordTwitchSub({ id: "a" })
  assert.equal(timer.snapshot().remainingMs, HOUR)
})

test("la configuracion del contador se limpia", () => {
  const { timer } = setup()
  const config = timer.setConfig({ position: "javascript:", palette: "x", customColors: ["red", "#00FF00"], size: 999 })
  assert.equal(config.position, "top-center")
  assert.equal(config.palette, "purple-haze")
  assert.deepEqual(config.customColors, ["#a855f7", "#00ff00"])
  assert.equal(config.size, 200)
})

// ── Metas ────────────────────────────────────────────────────────────────────
test("las metas se ordenan, sin repetidos ni ceros", () => {
  const config = normalizeGoalConfig("subs", { milestones: [{ target: 50 }, { target: 10, reward: "A" }, { target: 0 }, { target: 10, reward: "B" }] })
  assert.deepEqual(config.milestones, [{ target: 10, reward: "B" }, { target: 50, reward: "" }])
  assert.throws(() => normalizeGoalConfig("subs", { milestones: [] }), /al menos una meta/)
})

test("el hito activo avanza y al final queda el ultimo lleno", () => {
  const list = [{ target: 10 }, { target: 25 }]
  assert.equal(activeMilestone(list, 3).milestone.target, 10)
  assert.equal(activeMilestone(list, 10).milestone.target, 25)
  const done = activeMilestone(list, 30)
  assert.equal(done.allDone, true)
  assert.equal(done.milestone.target, 25)
})

test("cruzar una meta avisa con el premio y pasa a la siguiente", () => {
  const { goals, goalEvents } = setup()
  goals.setConfig("subs", { milestones: [{ target: 2, reward: "Cosplay" }, { target: 5, reward: "Karaoke" }] })
  goals.record("subs", 1)
  assert.deepEqual(goalEvents.at(-1).detail.reached, [])
  goals.record("subs", 1)
  assert.deepEqual(goalEvents.at(-1).detail.reached, [{ target: 2, reward: "Cosplay" }])
  assert.equal(goalEvents.at(-1).snap.target, 5)
  assert.equal(goalEvents.at(-1).snap.reward, "Karaoke")
})

test("un salto grande celebra todas las metas cruzadas", () => {
  const { goals, goalEvents } = setup()
  goals.setConfig("bits", { milestones: [{ target: 100 }, { target: 500 }, { target: 1000 }] })
  goals.record("bits", 600)
  assert.deepEqual(goalEvents.at(-1).detail.reached.map(item => item.target), [100, 500])
})

test("los bits de Twitch cuentan para la meta de bits", () => {
  const { subathon, goals } = setup()
  subathon.recordTwitchBits({ id: "c", bits: 300 })
  assert.equal(goals.snapshot("bits").count, 300)
  assert.equal(goals.snapshot("bits").goal, "bits")
})

test("una meta desactivada no cuenta lo que llega de Twitch, pero se puede ajustar a mano", () => {
  const { subathon, goals } = setup()
  goals.setConfig("subs", { enabled: false })
  subathon.recordTwitchSub({ id: "a" })
  assert.equal(goals.snapshot("subs").count, 0)
  goals.add("subs", 3)
  assert.equal(goals.snapshot("subs").count, 3)
})

test("bajar el contador a mano no celebra ni pasa de 0", () => {
  const { goals, goalEvents } = setup()
  goals.setCount("subs", 20)
  goals.add("subs", -50)
  assert.equal(goals.snapshot("subs").count, 0)
  assert.deepEqual(goalEvents.at(-1).detail.reached, [])
})

test("el snapshot de meta no pisa el tipo del mensaje del overlay", () => {
  const { goals } = setup()
  const message = { type: "subathon_goal", ...goals.snapshot("subs") }
  assert.equal(message.type, "subathon_goal")
  assert.equal(message.goal, "subs")
})
