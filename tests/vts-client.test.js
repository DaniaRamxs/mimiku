const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { WebSocketServer } = require("ws")

const VTSClient = require("../src/services/vts/vtsClient.cjs")

// VTube Studio falso: acepta solo `validToken`; AuthenticationTokenRequest
// entrega `newToken` (o un error 50 si `deny`).
async function fakeVts(t, { validToken, newToken = "nuevo", deny = false }) {
  const seen = []
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" })
  await new Promise(resolve => server.once("listening", resolve))
  server.on("connection", socket => socket.on("message", raw => {
    const msg = JSON.parse(raw)
    seen.push(msg.messageType)
    const reply = (messageType, data) => socket.send(JSON.stringify({ requestID: msg.requestID, messageType, data }))
    if (msg.messageType === "AuthenticationTokenRequest") {
      if (deny) reply("APIError", { errorID: 50, message: "User has denied API access for your plugin." })
      else { validToken = newToken; reply("AuthenticationTokenResponse", { authenticationToken: newToken }) }
    } else if (msg.messageType === "AuthenticationRequest") {
      reply("AuthenticationResponse", { authenticated: msg.data.authenticationToken === validToken })
    }
  }))
  t.after(() => new Promise(resolve => { for (const c of server.clients) c.terminate(); server.close(resolve) }))
  return { url: `ws://127.0.0.1:${server.address().port}`, seen }
}

function clientFor(t, url, savedToken) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vts-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({ connection: { url, pluginName: "Mimiku", pluginDeveloper: "test", tokenPath: "./token.json" } }))
  if (savedToken) fs.writeFileSync(path.join(dir, "token.json"), JSON.stringify({ authenticationToken: savedToken }))
  const client = new VTSClient(configPath)
  client.on("error", () => {})
  t.after(() => client.disconnect())
  return { client, tokenFile: path.join(dir, "token.json") }
}

test("con un token guardado valido conecta sin pedir permiso otra vez", async t => {
  const vts = await fakeVts(t, { validToken: "viejo" })
  const { client } = clientFor(t, vts.url, "viejo")
  await client.connect()
  assert.equal(client.authenticated, true)
  assert.deepEqual(vts.seen, ["AuthenticationRequest"])
})

test("si VTube Studio revoco el token guardado, pide uno nuevo y lo guarda", async t => {
  const vts = await fakeVts(t, { validToken: "otro", newToken: "nuevo" })
  const { client, tokenFile } = clientFor(t, vts.url, "revocado")
  await client.connect()
  assert.equal(client.authenticated, true)
  assert.deepEqual(vts.seen, ["AuthenticationRequest", "AuthenticationTokenRequest", "AuthenticationRequest"])
  assert.equal(JSON.parse(fs.readFileSync(tokenFile, "utf8")).authenticationToken, "nuevo")
})

test("sin token guardado pide permiso la primera vez", async t => {
  const vts = await fakeVts(t, { validToken: null, newToken: "primero" })
  const { client } = clientFor(t, vts.url, null)
  await client.connect()
  assert.equal(client.authenticated, true)
  assert.deepEqual(vts.seen, ["AuthenticationTokenRequest", "AuthenticationRequest"])
})

test("si el streamer rechaza el permiso, el error lo explica y no queda token", async t => {
  const vts = await fakeVts(t, { validToken: "otro", deny: true })
  const { client, tokenFile } = clientFor(t, vts.url, "revocado")
  await assert.rejects(client.connect(), /Rechazaste el permiso/)
  assert.equal(client.authenticated, false)
  assert.equal(fs.existsSync(tokenFile), false)
})
