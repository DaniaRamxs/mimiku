const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")

const network = require("../src/services/overlay-network.js")
const schema = require("../src/core/config-schema.js")
const validate = require("../src/core/ipc-validation.js")

const interfaces = {
  Ethernet: [
    { family: "IPv6", address: "fe80::1", internal: false },
    { family: "IPv4", address: "192.168.1.20", internal: false },
  ],
  Loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  Sinsenal: [{ family: "IPv4", address: "169.254.10.2", internal: false }],
  Wifi: [{ family: 4, address: "10.0.0.5", internal: false }],
}

test("listLanAddresses conserva solo IPv4 alcanzables desde la red local", () => {
  assert.deepEqual(network.listLanAddresses(interfaces), [
    { name: "Ethernet", address: "192.168.1.20" },
    { name: "Wifi", address: "10.0.0.5" },
  ])
})

test("buildOverlayUrls lista localhost, loopback, IP LAN y hostname personalizado", () => {
  const urls = network.buildOverlayUrls(
    { httpPort: 7777, allowLan: true, customHostname: "overlay.mimiku.dev" },
    [{ name: "Ethernet", address: "192.168.1.20" }],
  )
  assert.deepEqual(urls.map(entry => entry.url), [
    "http://localhost:7777/overlay",
    "http://127.0.0.1:7777/overlay",
    "http://192.168.1.20:7777/overlay",
    "http://overlay.mimiku.dev:7777/overlay",
  ])
})

test("buildOverlayUrls omite el puerto 80 y las IP LAN cuando allowLan es false", () => {
  const urls = network.buildOverlayUrls(
    { httpPort: 80, allowLan: false, customHostname: "overlay.mimiku.dev" },
    [{ name: "Ethernet", address: "192.168.1.20" }],
  )
  assert.deepEqual(urls.map(entry => entry.url), [
    "http://localhost/overlay",
    "http://127.0.0.1/overlay",
    "http://overlay.mimiku.dev/overlay",
  ])
})

test("probeUrl marca como funcional una URL que responde 200", async () => {
  const server = http.createServer((req, res) => res.end("ok"))
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  try {
    const result = await network.probeUrl(`http://127.0.0.1:${server.address().port}/overlay`)
    assert.equal(result.ok, true)
    assert.equal(result.status, 200)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test("probeUrl explica una conexión rechazada y un nombre que no resuelve", async () => {
  const closed = http.createServer()
  await new Promise(resolve => closed.listen(0, "127.0.0.1", resolve))
  const { port } = closed.address()
  await new Promise(resolve => closed.close(resolve))

  const refused = await network.probeUrl(`http://127.0.0.1:${port}/overlay`)
  assert.equal(refused.ok, false)
  assert.equal(refused.error, "Conexión rechazada")

  const unresolved = await network.probeUrl("http://nombre-que-no-existe.invalid/overlay")
  assert.equal(unresolved.ok, false)
  assert.match(unresolved.error, /no resuelve|Error de red|getaddrinfo/i)
})

test("probeUrl reporta el estado HTTP cuando no es 2xx y respeta el timeout", async () => {
  const fake404 = async () => ({ ok: false, status: 404, body: null })
  assert.equal((await network.probeUrl("http://x/overlay", { fetchImpl: fake404 })).error, "HTTP 404")

  const hanging = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
  })
  const result = await network.probeUrl("http://x/overlay", { fetchImpl: hanging, timeoutMs: 20 })
  assert.equal(result.error, "Tiempo de espera agotado")
})

test("describeListenError da mensajes accionables para puerto ocupado y sin permisos", () => {
  const target = { host: "0.0.0.0", port: 80 }
  assert.match(network.describeListenError({ code: "EADDRINUSE" }, target), /puerto 80 ya está en uso/)
  assert.match(network.describeListenError({ code: "EACCES" }, target), /no permite usar el puerto 80/)
  assert.match(network.describeListenError({ code: "EOTHER", message: "boom" }, target), /boom/)
})

test("la configuración del overlay por defecto conserva 7777/7778 y escucha en la red local", () => {
  assert.deepEqual(schema.normalizeAppConfig({}).overlay, {
    httpPort: 7777, wsPort: 7778, allowLan: true, customHostname: "",
  })
})

test("normalizeOverlayConfig descarta puertos inválidos y limpia el hostname", () => {
  assert.deepEqual(
    schema.normalizeOverlayConfig({ httpPort: 99999, wsPort: "abc", allowLan: false, customHostname: "HTTP://Overlay.Mimiku.dev:80/overlay" }),
    { httpPort: 7777, wsPort: 7778, allowLan: false, customHostname: "overlay.mimiku.dev" },
  )
  assert.equal(schema.normalizeOverlayConfig({ customHostname: "no valido!" }).customHostname, "")
  assert.equal(schema.normalizeOverlayConfig({ httpPort: 80, wsPort: 80 }).wsPort, 0)
})

test("overlayConfig valida con errores claros en lugar de corregir en silencio", () => {
  assert.deepEqual(
    validate.overlayConfig({ httpPort: "80", wsPort: "0", allowLan: true, customHostname: "overlay.mimiku.dev" }),
    { httpPort: 80, wsPort: 0, allowLan: true, customHostname: "overlay.mimiku.dev" },
  )
  assert.throws(() => validate.overlayConfig({ httpPort: 0, wsPort: 7778 }), /Puerto del overlay inválido/)
  assert.throws(() => validate.overlayConfig({ httpPort: 70000, wsPort: 7778 }), /Puerto del overlay inválido/)
  assert.throws(() => validate.overlayConfig({ httpPort: 8080, wsPort: 8080 }), /distinto/)
  assert.throws(() => validate.overlayConfig({ httpPort: 8080, wsPort: 7778, customHostname: "no valido!" }), /Hostname/)
})
