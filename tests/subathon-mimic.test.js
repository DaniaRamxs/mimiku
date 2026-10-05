const test = require("node:test")
const assert = require("node:assert/strict")
const { createSubathonTimer, MINUTE_MS } = require("../src/services/subathon-timer.js")
const { rollMinutes, applySubathonBlock, MIN_LEFT_MS } = require("../src/services/subathon-mimic.js")

function memoryStore() {
  const data = {}
  return { load: key => data[key], save: (key, value) => { data[key] = value } }
}

function runningTimer(minutes, clock = { t: 1_000_000 }) {
  const timer = createSubathonTimer({ store: memoryStore(), now: () => clock.t })
  timer.setRemaining(minutes * MINUTE_MS)
  timer.start()
  return timer
}

test("rollMinutes stays inside the range, inclusive", () => {
  assert.equal(rollMinutes(10, 30, () => 0), 10)
  assert.equal(rollMinutes(10, 30, () => 0.9999), 30)
  assert.equal(rollMinutes(30, 10, () => 0), 10) // rango invertido
  assert.equal(rollMinutes(15, 15, () => 0.5), 15)
})

test("rollMinutes treats invalid or negative values as 0", () => {
  assert.equal(rollMinutes("x", 30, () => 0), 0)
  assert.equal(rollMinutes(-5, 0, () => 0), 0)
})

test("remove block subtracts the rolled minutes from a running subathon", () => {
  const timer = runningTimer(120)
  const result = applySubathonBlock(timer, { type: "subathon_time", mode: "remove", min: 10, max: 30 }, { user: "ana", random: () => 0.5 })
  assert.equal(result.ok, true)
  assert.equal(result.minutes, 20)
  assert.equal(result.appliedMs, -20 * MINUTE_MS)
  assert.equal(timer.snapshot().remainingMs, 100 * MINUTE_MS)
  const entry = timer.snapshot().history[0]
  assert.equal(entry.source, "mimic")
  assert.equal(entry.user, "ana")
})

test("add block adds time", () => {
  const timer = runningTimer(60)
  const result = applySubathonBlock(timer, { mode: "add", min: 5, max: 5 }, { random: () => 0 })
  assert.equal(result.appliedMs, 5 * MINUTE_MS)
  assert.equal(timer.snapshot().remainingMs, 65 * MINUTE_MS)
})

test("remove never ends the subathon: leaves at least MIN_LEFT_MS", () => {
  const timer = runningTimer(12)
  const result = applySubathonBlock(timer, { mode: "remove", min: 30, max: 30 }, { random: () => 0 })
  assert.equal(result.ok, true)
  assert.equal(result.capped, true)
  assert.equal(timer.snapshot().remainingMs, MIN_LEFT_MS)
  assert.equal(timer.snapshot().status, "running")
})

test("remove does nothing when already at the floor", () => {
  const timer = runningTimer(1)
  const result = applySubathonBlock(timer, { mode: "remove", min: 10, max: 30 }, { random: () => 0 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, "floor")
  assert.equal(timer.snapshot().remainingMs, MIN_LEFT_MS)
})

test("works while paused", () => {
  const timer = runningTimer(90)
  timer.pause()
  applySubathonBlock(timer, { mode: "remove", min: 10, max: 10 }, { random: () => 0 })
  assert.equal(timer.snapshot().remainingMs, 80 * MINUTE_MS)
})

test("ignored when the subathon has not started or has ended", () => {
  const idle = createSubathonTimer({ store: memoryStore(), now: () => 0 })
  idle.setRemaining(60 * MINUTE_MS)
  assert.deepEqual(applySubathonBlock(idle, { mode: "remove", min: 10, max: 30 }), { ok: false, reason: "not-started" })
  assert.equal(idle.snapshot().remainingMs, 60 * MINUTE_MS)

  const clock = { t: 0 }
  const ended = runningTimer(1, clock)
  clock.t += 2 * MINUTE_MS
  ended.settle()
  assert.deepEqual(applySubathonBlock(ended, { mode: "remove", min: 10, max: 30 }), { ok: false, reason: "ended" })
})
