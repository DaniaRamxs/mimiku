const test = require("node:test")
const assert = require("node:assert/strict")

const { createAccessories } = require("../src/services/vtuber/accessories.js")

function manualTimers() {
  const pending = new Map()
  let next = 1
  return {
    setTimeout: fn => { const id = next++; pending.set(id, fn); return id },
    clearTimeout: id => pending.delete(id),
    fireAll() { const fns = [...pending.values()]; pending.clear(); fns.forEach(fn => fn()) },
    count: () => pending.size,
  }
}

function setup({ meshes = ["ArtMesh_Head", "Face01", "Body"], avatar = true } = {}) {
  const calls = []
  let n = 0
  const vts = {
    getArtMeshes: async () => meshes,
    loadCustomItem: async item => { calls.push(["load", item.fileName, item.size, item.askFirst]); return `i${++n}` },
    pinItem: async pin => { calls.push(["pin", pin.instanceID, pin.artMeshID, pin.random, pin.size]) },
    unloadItems: async ids => { calls.push(["unload", ...ids]) },
  }
  const timers = manualTimers()
  let clock = 0
  const accessories = createAccessories({
    vts, timers, now: () => ++clock, random: () => 0,
    builtinImage: item => `png-${item}`,
    avatarImage: async viewer => (avatar ? { fileName: `mimiku-av-${viewer.username}.png`, base64: "AV" } : null),
    getHeadPatterns: () => "head, face",
    log: { warn() {} },
  })
  return { accessories, calls, timers }
}

const viewer = name => ({ name, username: name.toLowerCase(), platform: "twitch", avatarUrl: "" })

test("un accesorio se pega a una parte de la cabeza y se quita solo", async () => {
  const { accessories, calls, timers } = setup()
  await accessories.accessory({ item: "crown", where: "head", seconds: 60, size: 30 })
  assert.deepEqual(calls[0], ["load", "mimiku-crown.png", 0.3, false])
  assert.deepEqual(calls[1], ["pin", "i1", "ArtMesh_Head", true, 0.3])
  timers.fireAll()
  await new Promise(setImmediate)
  assert.deepEqual(calls.at(-1), ["unload", "i1"])
})

test("repetir el mismo accesorio alarga su tiempo en vez de apilarlo", async () => {
  const { accessories, calls } = setup()
  await accessories.accessory({ item: "hat", where: "head", seconds: 60, size: 30 })
  await accessories.accessory({ item: "hat", where: "head", seconds: 60, size: 30 })
  assert.equal(calls.filter(c => c[0] === "load").length, 1)
})

test("sin partes de cabeza reconocibles se pega a cualquier parte", async () => {
  const { accessories, calls } = setup({ meshes: ["Mesh1", "Mesh2"] })
  await accessories.accessory({ item: "hat", where: "head", seconds: 60, size: 30 })
  assert.equal(calls[1][2], "")
})

test("los avatares se pegan al cuerpo y al pasar el maximo cae el mas antiguo", async () => {
  const { accessories, calls } = setup()
  for (const name of ["Ana", "Bea", "Cris"]) {
    await accessories.attachAvatar({ viewer: viewer(name), where: "body", seconds: 120, size: 16, max: 2, askFirst: false })
  }
  assert.deepEqual(calls.filter(c => c[0] === "pin").map(c => c[2]), ["", "", ""])
  assert.ok(calls.some(c => c[0] === "unload" && c[1] === "i1"))
  assert.equal(accessories.stuckAvatars(), 2)
})

test("el mismo viewer atacando otra vez no pega un segundo avatar", async () => {
  const { accessories, calls } = setup()
  await accessories.attachAvatar({ viewer: viewer("Ana"), where: "body", seconds: 120, size: 16, max: 5 })
  await accessories.attachAvatar({ viewer: viewer("Ana"), where: "body", seconds: 120, size: 16, max: 5 })
  assert.equal(calls.filter(c => c[0] === "load").length, 1)
})

test("sin foto del viewer avisa con un error claro", async () => {
  const { accessories } = setup({ avatar: false })
  await assert.rejects(accessories.attachAvatar({ viewer: viewer("Ana"), where: "body", seconds: 1, size: 16, max: 5 }), /no hay foto de Ana/)
})

test("el chichon crece con cada golpe en el mismo punto y se deshincha", async () => {
  const { accessories, calls, timers } = setup()
  await accessories.bumpGrow({ step: 5, max: 12, resetSeconds: 30 })
  await accessories.bumpGrow({ step: 5, max: 12, resetSeconds: 30 })
  await accessories.bumpGrow({ step: 5, max: 12, resetSeconds: 30 })
  const pins = calls.filter(c => c[0] === "pin")
  assert.equal(calls.filter(c => c[0] === "load").length, 1)
  assert.deepEqual(pins.map(p => p[4]), [0.05, 0.1, 0.12])
  assert.ok(pins.every(p => p[3] === false && p[2] === "ArtMesh_Head"))
  timers.fireAll()
  await new Promise(setImmediate)
  assert.deepEqual(calls.at(-1), ["unload", "i1"])
})

test("varios golpes mientras VTS responde se juntan en un solo cambio", async () => {
  const { accessories, calls } = setup()
  await Promise.all([1, 2, 3, 4].map(() => accessories.bumpGrow({ step: 2, max: 40, resetSeconds: 30 })))
  assert.equal(calls.filter(c => c[0] === "load").length, 1)
  assert.equal(calls.filter(c => c[0] === "pin").at(-1)[4], 0.08)
})

test("limpiar quita todo lo que Mimiku pego", async () => {
  const { accessories, calls, timers } = setup()
  await accessories.accessory({ item: "hat", where: "head", seconds: 60, size: 30 })
  await accessories.attachAvatar({ viewer: viewer("Ana"), where: "body", seconds: 60, size: 16, max: 5 })
  await accessories.clearAll()
  assert.deepEqual(calls.at(-1), ["unload", "i1", "i2"])
  assert.equal(timers.count(), 0)
})
