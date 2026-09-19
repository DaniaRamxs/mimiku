const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

function loadService({ missingFile = false, masterVolume = 0.5 } = {}) {
  const broadcasts = []
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === "electron") return { app: { getPath: () => "/test-data" } }
      if (name === "fs") return {
        existsSync: file => !missingFile || !file.endsWith(".mp3"),
        readFileSync: () => JSON.stringify({
          enabled: true, masterVolume,
          mappings: [{ id: "hola", emote: "hola", file: "hola.mp3", volume: 0.8, cooldown_s: 0 }],
        }),
      }
      return require(name)
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services/emoteSounds.js"), "utf8"), context)
  const service = context.module.exports
  service.init(payload => broadcasts.push(payload))
  return { service, broadcasts }
}

function loadPage(invoke, playbackError) {
  const audios = []
  const toast = { textContent: "", classList: { add() {}, remove() {} } }
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === "electron") return { ipcRenderer: { invoke } }
      return require(path.join(__dirname, "../src/pages", name))
    },
    document: { getElementById: () => toast },
    setTimeout() {},
    Audio: class {
      constructor(url) { this.url = url; this.paused = false; audios.push(this) }
      pause() { this.paused = true }
      async play() { if (playbackError) throw playbackError; this.played = true }
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/pages/emotes.js"), "utf8"), context)
  return { page: context.module.exports, audios, toast }
}

test("Probar devuelve el audio y volumen sin emitir al overlay; el chat conserva su salida a OBS", () => {
  const { service, broadcasts } = loadService()
  const sound = service.testSound("hola")
  assert.equal(sound.url, "http://127.0.0.1:7777/audio/hola.mp3")
  assert.equal(sound.volume, 0.4)
  assert.equal(broadcasts.length, 0)
  service.onMessage("hola", "twitch")
  assert.equal(broadcasts.length, 1)
  assert.equal(broadcasts[0].url, sound.url)
  assert.equal(broadcasts[0].volume, sound.volume)
})

test("El chat acepta puntuación junto al emote sin confundir palabras más largas", () => {
  const { service, broadcasts } = loadService()
  service.onMessage("¡hola!", "twitch")
  assert.equal(broadcasts.length, 1)
  service.onMessage("holanda", "twitch")
  assert.equal(broadcasts.length, 1)
})

test("Probar informa sonidos eliminados y archivos ausentes", () => {
  assert.throws(() => loadService().service.testSound("otro"), /El sonido ya no existe/)
  assert.throws(() => loadService({ missingFile: true }).service.testSound("hola"), /El archivo de audio ya no existe/)
})

test("Probar reproduce localmente sin OBS y detiene el preview anterior", async () => {
  const { service } = loadService()
  const { page, audios } = loadPage(async (channel, id) => {
    assert.equal(channel, "emotes:test")
    return service.testSound(id)
  })
  assert.equal(await page.test("hola"), true)
  assert.equal(audios[0].played, true)
  assert.equal(audios[0].volume, 0.4)
  assert.equal(await page.test("hola"), true)
  assert.equal(audios[0].paused, true)
  assert.equal(audios[1].played, true)
})

test("Probar muestra errores de IPC y reproducción al usuario", async () => {
  const ipcFailure = loadPage(async () => { throw new Error("Archivo ausente") })
  assert.equal(await ipcFailure.page.test("hola"), false)
  assert.match(ipcFailure.toast.textContent, /Archivo ausente/)
  const { service } = loadService()
  const playbackFailure = loadPage(async () => service.testSound("hola"), new Error("Formato no compatible"))
  assert.equal(await playbackFailure.page.test("hola"), false)
  assert.match(playbackFailure.toast.textContent, /Formato no compatible/)
})

test("Probar explica el volumen cero sin cambiarlo", async () => {
  const { service } = loadService({ masterVolume: 0 })
  const { page, audios, toast } = loadPage(async () => service.testSound("hola"))
  assert.equal(await page.test("hola"), false)
  assert.equal(audios.length, 0)
  assert.match(toast.textContent, /volumen/)
  assert.equal(service.list().masterVolume, 0)
})

test("Dos clics rápidos solo reproducen la última selección aunque el IPC responda fuera de orden", async () => {
  const pending = []
  const { page, audios } = loadPage(() => new Promise(resolve => pending.push(resolve)))
  const first = page.test("uno")
  const second = page.test("dos")
  pending[1]({ url: "http://127.0.0.1:7777/audio/dos.mp3", volume: 0.8 })
  assert.equal(await second, true)
  pending[0]({ url: "http://127.0.0.1:7777/audio/uno.mp3", volume: 0.8 })
  assert.equal(await first, false)
  assert.equal(audios.length, 1)
  assert.match(audios[0].url, /dos\.mp3$/)
})
