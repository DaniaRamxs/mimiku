const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createJobs, MIN_MS, FISH_REEL_MS, TASK_TTL_MS } = require("../src/services/jobs.js")
const { createCanjeJobs, handleJobsApi } = require("../src/services/canje-jobs.js")
const { createLiveFeed } = require("../src/services/live-feed.js")

function setup({ points = 0, rolls = [] } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-10-05T12:00:00Z") }
  const queue = [...rolls]
  const random = () => (queue.length ? queue.shift() : 0.5)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  if (points) platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: points, idempotencyKey: "seed", reason: "seed" })
  let n = 0
  const jobs = createJobs({ platform, getChannel: () => "canal", now: () => clock.t, random, newId: () => `t${++n}` })
  const balance = () => platform.economy.getBalance("canal", viewer.id).balance
  return { db, platform, clock, viewer, jobs, balance, queue }
}

test("lavar un plato paga 1000 si no se rompe", () => {
  const { jobs, viewer, clock, balance, queue } = setup()
  const started = jobs.start(viewer.id, "dishes")
  assert.equal(started.ok, true)
  clock.t += MIN_MS.dishes
  queue.push(0.99) // no se rompe
  const done = jobs.finish(viewer.id, started.task.id)
  assert.deepEqual({ ok: done.ok, broken: done.outcome.broken, delta: done.delta }, { ok: true, broken: false, delta: 1000 })
  assert.equal(balance(), 1000)
})

test("un plato roto quita 500 pero nunca deja el saldo en negativo", () => {
  const { jobs, viewer, clock, balance, queue } = setup({ points: 300 })
  const started = jobs.start(viewer.id, "dishes")
  clock.t += MIN_MS.dishes
  queue.push(0) // se rompe
  const done = jobs.finish(viewer.id, started.task.id)
  assert.equal(done.outcome.broken, true)
  assert.equal(done.delta, -300)
  assert.equal(balance(), 0)
})

test("no se puede entregar antes del tiempo minimo ni dos veces", () => {
  const { jobs, viewer, clock, balance } = setup()
  const started = jobs.start(viewer.id, "dishes")
  clock.t += MIN_MS.dishes - 1
  assert.equal(jobs.finish(viewer.id, started.task.id).reason, "too-fast")
  clock.t += 1
  assert.equal(jobs.finish(viewer.id, started.task.id).ok, true)
  assert.equal(jobs.finish(viewer.id, started.task.id).reason, "no-task")
  assert.equal(balance(), 1000)
})

test("empezar otra tarea anula la anterior y las tareas caducan", () => {
  const { jobs, viewer, clock } = setup()
  const first = jobs.start(viewer.id, "dishes")
  const second = jobs.start(viewer.id, "mine")
  clock.t += MIN_MS.dishes
  assert.equal(jobs.finish(viewer.id, first.task.id).reason, "no-task")
  const third = jobs.start(viewer.id, "mine")
  clock.t += TASK_TTL_MS + 1
  assert.equal(jobs.finish(viewer.id, third.task.id).reason, "no-task")
  assert.equal(second.ok, true)
})

test("la pesca espera a que pique el pez y a recoger el sedal", () => {
  const { jobs, viewer, clock, queue, balance } = setup()
  queue.push(0) // pica lo antes posible
  const started = jobs.start(viewer.id, "fish")
  assert.equal(started.task.biteMs, 1800)
  clock.t += started.task.biteMs + FISH_REEL_MS - 1
  assert.equal(jobs.finish(viewer.id, started.task.id).reason, "too-fast")
  clock.t += 1
  queue.push(0.9999) // el ultimo de la tabla: pez dorado
  const done = jobs.finish(viewer.id, started.task.id)
  assert.equal(done.outcome.id, "dorado")
  assert.equal(done.outcome.big, true)
  assert.equal(balance(), 20000)
})

test("la mina paga lo que sale y un trabajo que no existe se rechaza", () => {
  const { jobs, viewer, clock, queue, balance } = setup()
  assert.equal(jobs.start(viewer.id, "robar").reason, "bad-job")
  const started = jobs.start(viewer.id, "mine")
  clock.t += MIN_MS.mine
  queue.push(0) // piedra
  assert.equal(jobs.finish(viewer.id, started.task.id).outcome.id, "piedra")
  assert.equal(balance(), 200)
})

test("los valores del lavaplatos se configuran y se validan", () => {
  const { jobs, viewer, clock, queue, balance } = setup()
  assert.deepEqual(jobs.setConfig({ dishPay: 1500, dishPenalty: 0, dishBreakPct: 50 }), { dishPay: 1500, dishPenalty: 0, dishBreakPct: 50 })
  assert.throws(() => jobs.setConfig({ dishBreakPct: 95 }))
  assert.throws(() => jobs.setConfig({ dishPay: 0 }))
  const started = jobs.start(viewer.id, "dishes")
  clock.t += MIN_MS.dishes
  queue.push(0.6) // 60 >= 50: no se rompe
  assert.equal(jobs.finish(viewer.id, started.task.id).delta, 1500)
  assert.equal(balance(), 1500)
  assert.equal(jobs.info().dishes.breakPct, 50)
})

test("la API encadena la siguiente tarea y apunta en vivo solo los hallazgos gordos", async () => {
  const { platform, clock, queue } = setup()
  const feed = createLiveFeed({ now: () => clock.t })
  const api = createCanjeJobs({ platform, getChannel: () => "canal", feed, now: () => clock.t, random: () => (queue.length ? queue.shift() : 0.5) })
  const call = (pathname, body = {}) => handleJobsApi({ pathname, readJson: async () => body, user: { twitchId: "111" }, jobs: api })
  const [, started] = await call("/api/jobs/start", { job: "mine" })
  clock.t += MIN_MS.mine
  queue.push(0.9999) // diamante
  const [status, done] = await call("/api/jobs/finish", { id: started.task.id, next: true })
  assert.equal(status, 200)
  assert.equal(done.outcome.id, "diamante")
  assert.equal(done.balance, 12000)
  assert.equal(done.next.job, "mine")
  clock.t += MIN_MS.mine
  queue.push(0) // piedra: no va al tablon
  await call("/api/jobs/finish", { id: done.next.id })
  const events = feed.list("canal").events
  assert.equal(events.length, 1)
  assert.equal(events[0].game, "trabajo")
  assert.match(events[0].label, /Diamante/)
  const [badStatus, bad] = await call("/api/jobs/finish", { id: "nada" })
  assert.equal(badStatus, 409)
  assert.equal(bad.reason, "no-task")
  const [unknown] = await handleJobsApi({ pathname: "/api/jobs/start", readJson: async () => ({ job: "mine" }), user: { twitchId: "999" }, jobs: api })
  assert.equal(unknown, 409)
})
