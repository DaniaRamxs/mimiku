const test = require("node:test")
const assert = require("node:assert/strict")
const { createWatchTime } = require("../src/services/watch-time.js")

function setup(live = true) {
  const clock = { t: 0 }
  const granted = []
  const watch = createWatchTime({ grant: viewers => granted.push(viewers.map(v => v.username)), isLive: () => live, now: () => clock.t })
  return { watch, clock, granted }
}

test("da tiempo a quien escribio en los ultimos 10 minutos", () => {
  const { watch, clock, granted } = setup()
  watch.note("luna", "1")
  clock.t += 4 * 60_000
  watch.note("zorro", "2")
  watch.tick()
  assert.deepEqual(granted[0].sort(), ["luna", "zorro"])
  clock.t += 7 * 60_000
  watch.tick()
  assert.deepEqual(granted[1], ["zorro"], "luna lleva mas de 10 min sin escribir")
})

test("sin directo no da nada; si no se sabe, cuenta mientras haya chat", () => {
  const off = setup(false)
  off.watch.note("luna", "1")
  off.watch.tick()
  assert.equal(off.granted.length, 0)
  const unknown = setup(null)
  unknown.watch.note("luna", "1")
  unknown.watch.tick()
  assert.deepEqual(unknown.granted, [["luna"]])
})

test("la misma persona cuenta una vez aunque escriba mucho", () => {
  const { watch, granted } = setup()
  for (let i = 0; i < 20; i++) watch.note("luna", "1")
  watch.tick()
  assert.deepEqual(granted, [["luna"]])
})
