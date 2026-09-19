// Transporte nuevo de Social Stream Ninja: WebSocket local a SSApp (sin
// postserver, sin Dock, sin cloud). Se prueba contra un servidor WebSocket
// local real (misma librería `ws` que ya usa overlay-server.js) que simula
// el relay de SSApp — no un mock de red inventado.
const test = require("node:test")
const assert = require("node:assert/strict")
const { WebSocketServer } = require("ws")

const { createSocialStreamNinjaTransport, probeSocialStreamNinjaRelay } = require("../src/integrations/social-stream-ninja/social-stream-ninja-transport.js")
const { createSocialStreamNinjaAdapter } = require("../src/integrations/social-stream-ninja/social-stream-ninja-adapter.js")
const { createEventEngine } = require("../src/core/events/event-engine.js")
const { registerCommandEngine } = require("../src/core/interactions/command-engine.js")
const { registerSoundTriggerEngine } = require("../src/core/interactions/sound-trigger-engine.js")

const TEST_PORT = 34003 // puerto de prueba dedicado, no el 3003/3000 reales
const TEST_PORT_2 = 34004 // segundo puerto para simular que SSApp "vuelve a abrirse" sin depender del tiempo de liberación del SO al reusar el mismo puerto
const FAST_BACKOFF = [10, 15, 20] // ms — solo para no esperar segundos reales en tests

function startFakeRelay(onMessage, port = TEST_PORT) {
  const wss = new WebSocketServer({ port, host: "127.0.0.1" })
  const sockets = []
  wss.on("connection", ws => {
    sockets.push(ws)
    ws.on("message", raw => {
      let parsed; try { parsed = JSON.parse(raw.toString()) } catch { return }
      onMessage && onMessage(parsed, ws)
    })
  })
  return {
    wss,
    sockets,
    broadcastChat: (payload) => sockets.forEach(s => s.readyState === 1 && s.send(JSON.stringify(payload))),
    // wss.close() por sí solo NO corta los sockets de cliente ya abiertos
    // (solo deja de aceptar conexiones nuevas) — para simular de verdad que
    // "SSApp se cierra" hay que terminar también cada conexión existente,
    // si no el cliente nunca se entera y el test cuelga esperando un cierre
    // que nunca llega desde su lado.
    close: () => new Promise(resolve => {
      sockets.forEach(s => { try { s.terminate() } catch (e) {} })
      wss.close(resolve)
    }),
  }
}

function waitFor(fn, { timeout = 2000, interval = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      let result
      try { result = fn() } catch (e) { result = false }
      if (result) return resolve(result)
      if (Date.now() - start > timeout) return reject(new Error("waitFor: tiempo agotado"))
      setTimeout(tick, interval)
    }
    tick()
  })
}

function startProtocolRelay(port = TEST_PORT) {
  const wss = new WebSocketServer({ port, host: "127.0.0.1" })
  wss.on("connection", ws => {
    ws.on("message", raw => {
      const msg = JSON.parse(raw.toString())
      if (!ws.room) {
        if (msg.join) { ws.room = String(msg.join); ws.inn = msg.in; ws.out = msg.out }
        return
      }
      const out = msg.out || ws.out
      for (const client of wss.clients) {
        if (client !== ws && client.room === ws.room && client.inn === out) client.send(raw.toString())
      }
    })
  })
  return { close: () => new Promise(resolve => { for (const ws of wss.clients) ws.terminate(); wss.close(resolve) }) }
}

test("0: detectar exige una prueba activa del protocolo SSN, no solo un puerto WebSocket abierto", async () => {
  const plain = startFakeRelay(null, TEST_PORT)
  const falsePositive = await probeSocialStreamNinjaRelay({ ports: [TEST_PORT], timeoutMs: 150 })
  assert.equal(falsePositive.detected, false)
  await plain.close()

  const ssn = startProtocolRelay(TEST_PORT)
  const detected = await probeSocialStreamNinjaRelay({ ports: [TEST_PORT], timeoutMs: 500 })
  assert.equal(detected.detected, true)
  assert.equal(detected.port, TEST_PORT)
  await ssn.close()
})

test("1: conexión correcta — el transporte llega a 'connected' contra un relay real", async () => {
  const relay = startFakeRelay()
  const statuses = []
  const transport = createSocialStreamNinjaTransport({
    ports: [TEST_PORT], sessionId: "sess-123", backoffSteps: FAST_BACKOFF,
    onStatusChange: s => statuses.push(s.state),
  })
  transport.connect()
  await waitFor(() => transport.getStatus().state === "connected")
  assert.ok(statuses.includes("connecting"))
  assert.ok(statuses.includes("connected"))
  transport.disconnect()
  await relay.close()
})

test("2: SSN no instalado/no abierto — sin servidor escuchando, el transporte pasa a error/reconnecting sin crashear", async () => {
  const transport = createSocialStreamNinjaTransport({
    ports: [34999], sessionId: "s", backoffSteps: FAST_BACKOFF, // puerto sin nada escuchando
  })
  assert.doesNotThrow(() => transport.connect())
  await waitFor(() => ["error", "reconnecting"].includes(transport.getStatus().state))
  transport.disconnect()
})

test("3: el join enviado refleja el Session ID configurado (para diagnosticar un Session ID inválido)", async () => {
  const joins = []
  const relay = startFakeRelay(msg => { if (msg.join !== undefined) joins.push(msg) })
  const transport = createSocialStreamNinjaTransport({ ports: [TEST_PORT], sessionId: "mi-session-real", backoffSteps: FAST_BACKOFF })
  transport.connect()
  await waitFor(() => joins.length > 0)
  assert.equal(joins[0].join, "mi-session-real")
  assert.equal(joins[0].in, 4) // canal de chat documentado
  transport.disconnect()
  await relay.close()
})

test("4: desconexión explícita deja el estado en 'not_connected' y cierra el socket", async () => {
  const relay = startFakeRelay()
  const transport = createSocialStreamNinjaTransport({ ports: [TEST_PORT], sessionId: "s", backoffSteps: FAST_BACKOFF })
  transport.connect()
  await waitFor(() => transport.getStatus().state === "connected")
  transport.disconnect()
  assert.equal(transport.getStatus().state, "not_connected")
  await relay.close()
})

test("5: reconexión — si el relay cae y vuelve (en otro puerto candidato), el transporte se reconecta solo", async () => {
  let relay = startFakeRelay(null, TEST_PORT)
  const transport = createSocialStreamNinjaTransport({ ports: [TEST_PORT, TEST_PORT_2], sessionId: "s", backoffSteps: FAST_BACKOFF })
  transport.connect()
  await waitFor(() => transport.getStatus().state === "connected")

  await relay.close() // SSApp "se cierra"
  await waitFor(() => transport.getStatus().state === "reconnecting" || transport.getStatus().state === "error")

  const relay2 = startFakeRelay(null, TEST_PORT_2) // SSApp "vuelve a abrirse" (puerto candidato siguiente)
  await waitFor(() => transport.getStatus().state === "connected", { timeout: 3000 })

  transport.disconnect()
  await relay2.close()
})

test("6: no se duplican listeners/mensajes tras reconectar", async () => {
  let relay = startFakeRelay(null, TEST_PORT)
  const received = []
  const transport = createSocialStreamNinjaTransport({
    ports: [TEST_PORT, TEST_PORT_2], sessionId: "s", backoffSteps: FAST_BACKOFF,
    onPayload: p => received.push(p),
  })
  transport.connect()
  await waitFor(() => transport.getStatus().state === "connected")

  await relay.close()
  await waitFor(() => transport.getStatus().state !== "connected")
  const relay2 = startFakeRelay(null, TEST_PORT_2)
  await waitFor(() => transport.getStatus().state === "connected", { timeout: 3000 })

  relay2.broadcastChat({ chatname: "luna", chatmessage: "hola", type: "twitch", userid: "tw-1", id: "x1" })
  await waitFor(() => received.length > 0)
  await new Promise(r => setTimeout(r, 50)) // margen para descartar un segundo disparo fantasma
  assert.equal(received.length, 1) // no dos entregas del mismo mensaje por un listener viejo

  transport.disconnect()
  await relay2.close()
})

// ── 7-9: mensajes por plataforma llegan al Event Engine a través del transporte + adapter existente ──
function bootPipeline() {
  const engine = createEventEngine()
  registerCommandEngine(engine, {
    economy: { getViewer: () => ({ points: 5 }), addPoints: () => ({}) },
    games: {}, events: {}, shop: { checkCooldown: () => 0, setCooldown: () => {} },
    afk: { getIdleCommandReply: () => null },
  })
  const soundCalls = []
  registerSoundTriggerEngine(engine, { onMessage: (text, platform) => soundCalls.push({ text, platform }) })
  const adapter = createSocialStreamNinjaAdapter({ eventEngine: engine })
  return { engine, adapter, soundCalls }
}

for (const platform of ["youtube", "tiktok", "twitch"]) {
  test(`7-9 (${platform}): un mensaje de ${platform} recibido por el transporte llega normalizado al Event Engine`, async () => {
    const relay = startFakeRelay()
    const { adapter, soundCalls } = bootPipeline()
    const transport = createSocialStreamNinjaTransport({
      ports: [TEST_PORT], sessionId: "s", backoffSteps: FAST_BACKOFF,
      onPayload: payload => adapter.handlePayload(payload),
    })
    transport.connect()
    await waitFor(() => transport.getStatus().state === "connected")

    relay.broadcastChat({ chatname: "kira", chatmessage: "jajaja", type: platform, userid: `${platform}-1`, id: "m1" })
    await waitFor(() => soundCalls.length > 0)
    assert.deepEqual(soundCalls[0], { text: "jajaja", platform })

    transport.disconnect()
    await relay.close()
  })
}

test("10: Twitch Native + el mismo mensaje por el transporte SSN → una sola ejecución (dedup)", async () => {
  const relay = startFakeRelay()
  const { engine, adapter } = bootPipeline()
  const replies = []
  const { normalizeTwitchChatMessage } = require("../src/integrations/twitch/twitch-adapter.js")

  const transport = createSocialStreamNinjaTransport({
    ports: [TEST_PORT], sessionId: "s", backoffSteps: FAST_BACKOFF,
    onPayload: payload => adapter.handlePayload(payload),
  })
  transport.connect()
  await waitFor(() => transport.getStatus().state === "connected")

  const twitchEvent = normalizeTwitchChatMessage({
    tags: { username: "luna", "display-name": "Luna", "user-id": "tw-1", id: "tw-irc-1" },
    message: "!puntos", channel: "canal", replyFn: m => replies.push(m),
  })
  engine.emit(twitchEvent)
  relay.broadcastChat({ chatname: "luna", chatmessage: "!puntos", type: "twitch", userid: "tw-1", id: "ssn-otro-id" })
  await new Promise(r => setTimeout(r, 80))

  assert.equal(replies.length, 1) // el segundo (mismo platformUserId+texto) se deduplicó

  transport.disconnect()
  await relay.close()
})

test("13: Mimiku puede construir el transporte sin conectarlo (arranca sin SSN)", () => {
  assert.doesNotThrow(() => createSocialStreamNinjaTransport({ sessionId: "" }))
})

test("14-15: configuración limpia no trae Session ID, y el default nunca es un valor de desarrollo", () => {
  const { DEFAULT_APP_CONFIG, normalizeAppConfig } = require("../src/core/config-schema.js")
  assert.equal(DEFAULT_APP_CONFIG.integrations.socialStreamNinja.sessionId, "")
  assert.equal(DEFAULT_APP_CONFIG.integrations.socialStreamNinja.enabled, false)
  const normalized = normalizeAppConfig({})
  assert.equal(normalized.integrations.socialStreamNinja.sessionId, "")
  assert.equal(normalized.integrations.socialStreamNinja.enabled, false)
})

test("16: getStatus() expone el puerto REALMENTE conectado (3003 o el candidato que corresponda) — para que la UI no mienta", async () => {
  const relay = startFakeRelay(null, TEST_PORT_2)
  const transport = createSocialStreamNinjaTransport({ ports: [TEST_PORT_2], sessionId: "s", backoffSteps: FAST_BACKOFF })
  assert.equal(transport.getStatus().port, null) // antes de conectar no hay puerto activo
  transport.connect()
  await waitFor(() => transport.getStatus().state === "connected")
  assert.equal(transport.getStatus().port, TEST_PORT_2)
  transport.disconnect()
  assert.equal(transport.getStatus().port, null) // al desconectar, ya no hay puerto activo que mostrar
  await relay.close()
})

test("maskSessionId nunca imprime el Session ID completo", () => {
  const { maskSessionId } = require("../src/integrations/social-stream-ninja/social-stream-ninja-transport.js")
  const real = "abcdefghijklmnop-secreto-real"
  const masked = maskSessionId(real)
  assert.equal(masked.includes(real), false)
})

test("17: las trazas cubren apertura, join, primer frame, mensajes y cierre con código/motivo sin revelar la sala", async () => {
  const relay = startFakeRelay(null, TEST_PORT)
  const logs = []
  const roomId = "fake-room-private-123"
  const transport = createSocialStreamNinjaTransport({
    ports: [TEST_PORT], sessionId: roomId, backoffSteps: FAST_BACKOFF,
    log: line => logs.push(line),
  })
  transport.connect()
  await waitFor(() => transport.getStatus().state === "connected")
  relay.broadcastChat({ chatname: "viewer-test", chatmessage: "hola", type: "youtube" })
  await waitFor(() => logs.some(line => line.includes("first frame received")))
  relay.sockets[0].close(4001, "test-close")
  await waitFor(() => logs.some(line => line.includes("code=4001") && line.includes("reason=test-close")))

  assert.ok(logs.some(line => line.includes("socket opening")))
  assert.ok(logs.some(line => line.includes("socket open")))
  assert.ok(logs.some(line => line.includes("frame sent")))
  assert.ok(logs.some(line => line.includes("message received")))
  assert.equal(logs.some(line => line.includes(roomId)), false)
  transport.disconnect()
  await relay.close()
})
