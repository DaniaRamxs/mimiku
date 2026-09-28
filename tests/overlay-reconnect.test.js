const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

function loadOverlay({ constructorFailures = 0 } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "../src/services/overlay.html"), "utf8")
  // Run the real connection setup and message router without the unrelated animations.
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const connectionScript = script.slice(0, script.indexOf("var RED_NUMS"))
  const sockets = []
  const timers = new Map()
  const listeners = new Map()
  const sounds = []
  let nextTimer = 0

  class FakeWebSocket {
    static CLOSING = 2

    constructor(url) {
      if (constructorFailures > 0) {
        constructorFailures--
        throw new Error("connection temporarily unavailable")
      }
      this.url = url
      this.readyState = 0
      this.sent = []
      this.closeCalls = 0
      sockets.push(this)
    }

    send(data) { this.sent.push(JSON.parse(data)) }

    close() {
      this.closeCalls++
      this.readyState = 3
      this.onclose?.()
    }

    open() {
      this.readyState = 1
      this.onopen?.()
    }

    message(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
  }

  const context = vm.createContext({
    WebSocket: FakeWebSocket,
    document: { getElementById: () => ({}) },
    window: { addEventListener: (type, callback) => listeners.set(type, callback) },
    setTimeout(callback, delay) {
      const id = ++nextTimer
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: id => timers.delete(id),
    playEmoteSound: message => sounds.push(JSON.parse(JSON.stringify(message))),
  })
  vm.runInContext(connectionScript, context, { filename: "overlay.html" })

  return {
    sockets, timers, sounds, context,
    unload() { listeners.get("beforeunload")() },
    retry() {
      assert.equal(timers.size, 1, "only one reconnect should be pending")
      const [id, timer] = timers.entries().next().value
      timers.delete(id)
      timer.callback()
      return timer.delay
    },
  }
}

test("overlay opened before Mimiku reconnects and receives emote sounds", () => {
  const overlay = loadOverlay()
  const first = overlay.sockets[0]
  assert.equal(first.url, "ws://127.0.0.1:7778")
  first.close()
  assert.equal(overlay.retry(), 1000)
  const connected = overlay.sockets[1]
  connected.open()
  assert.deepEqual(connected.sent, [{ type: "get_channel" }])
  connected.message({ type: "set_channel", channel: "streamer" })
  connected.message({ type: "emote_sound", url: "/hola.mp3", volume: 80 })
  assert.equal(overlay.context.channel, "streamer")
  assert.deepEqual(overlay.sounds, [{ type: "emote_sound", url: "/hola.mp3", volume: 80 }])
  assert.equal(overlay.timers.size, 0)
})

test("overlay retries with bounded backoff and resets delay after a successful connection", () => {
  const overlay = loadOverlay()
  const delays = []
  for (let attempt = 0; attempt < 7; attempt++) {
    overlay.sockets.at(-1).close()
    delays.push(overlay.retry())
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 10000, 10000, 10000])
  const connected = overlay.sockets.at(-1)
  connected.open()
  connected.close()
  assert.equal(overlay.retry(), 1000)
  const reconnected = overlay.sockets.at(-1)
  reconnected.open()
  assert.deepEqual(reconnected.sent, [{ type: "get_channel" }])
})

test("socket errors and late close events cannot create duplicate reconnects", () => {
  const overlay = loadOverlay()
  const first = overlay.sockets[0]
  const lateClose = first.onclose
  const lateOpen = first.onopen
  first.onerror()
  assert.equal(first.closeCalls, 1)
  lateClose()
  lateOpen()
  assert.equal(overlay.timers.size, 1)
  assert.deepEqual(first.sent, [])
  overlay.retry()
  const current = overlay.sockets[1]
  lateClose()
  overlay.context.connectOverlay()
  assert.equal(overlay.sockets.length, 2)
  assert.equal(overlay.context.ws, current)
  assert.equal(overlay.timers.size, 0)
})

test("constructor errors retry without stopping overlay initialization", () => {
  const overlay = loadOverlay({ constructorFailures: 2 })
  assert.equal(overlay.sockets.length, 0)
  assert.equal(overlay.retry(), 1000)
  assert.equal(overlay.retry(), 2000)
  overlay.sockets[0].open()
  assert.deepEqual(overlay.sockets[0].sent, [{ type: "get_channel" }])
})

test("unloading cancels retries and closes an active socket without reconnecting", () => {
  const disconnected = loadOverlay()
  disconnected.sockets[0].close()
  const queuedRetry = disconnected.timers.values().next().value.callback
  disconnected.unload()
  assert.equal(disconnected.timers.size, 0)
  queuedRetry()
  assert.equal(disconnected.sockets.length, 1)

  const connected = loadOverlay()
  const socket = connected.sockets[0]
  socket.open()
  const lateClose = socket.onclose
  connected.unload()
  lateClose()
  assert.equal(socket.closeCalls, 1)
  assert.equal(connected.context.ws, null)
  assert.equal(connected.timers.size, 0)
})

test("overlay servido por HTTP conecta el WebSocket al mismo host y puerto (ruta /ws)", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/services/overlay.html"), "utf8")
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const start = script.indexOf("function overlaySocketUrl")
  const end = script.indexOf("function connectOverlay")
  const overlaySocketUrl = vm.runInNewContext(`(${script.slice(start, end).trim().replace(/^function overlaySocketUrl/, "function")})`, {
    location: { protocol: "http:", host: "overlay.mimiku.dev" },
  })
  assert.equal(overlaySocketUrl(), "ws://overlay.mimiku.dev/ws")
})

test("safeMediaUrl reubica audio y assets locales en el origen de la página", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/services/overlay.html"), "utf8")
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const start = script.indexOf("function safeMediaUrl")
  const end = script.indexOf("function showChatAvatar")
  const safeMediaUrl = vm.runInNewContext(`(${script.slice(start, end).trim().replace(/^function safeMediaUrl/, "function")})`, {
    location: { protocol: "http:", origin: "http://192.168.1.20:80" }, URL,
  })
  assert.equal(safeMediaUrl("http://127.0.0.1:7777/audio/hola.mp3"), "http://192.168.1.20/audio/hola.mp3")
  assert.equal(safeMediaUrl("http://127.0.0.1:9999/assets/a.png"), "http://192.168.1.20/assets/a.png")
  assert.equal(safeMediaUrl("https://cdn.example.com/x.png"), "https://cdn.example.com/x.png")
  assert.equal(safeMediaUrl("javascript:alert(1)"), "")
})
