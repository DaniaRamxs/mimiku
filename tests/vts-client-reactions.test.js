const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { WebSocketServer } = require("ws")

const VTSClient = require("../src/services/vts/vtsClient.cjs")

// VTube Studio falso que acepta cualquier token y apunta lo que recibe.
async function connectedClient(t, replies = {}) {
  const seen = []
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" })
  await new Promise(resolve => server.once("listening", resolve))
  server.on("connection", socket => socket.on("message", raw => {
    const msg = JSON.parse(raw)
    seen.push({ type: msg.messageType, data: msg.data })
    const data = msg.messageType === "AuthenticationRequest" ? { authenticated: true } : (replies[msg.messageType] || {})
    socket.send(JSON.stringify({ requestID: msg.requestID, messageType: msg.messageType.replace("Request", "Response"), data }))
  }))
  t.after(() => new Promise(resolve => { for (const c of server.clients) c.terminate(); server.close(resolve) }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vts-r-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const configPath = path.join(dir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({ connection: { url: `ws://127.0.0.1:${server.address().port}`, pluginName: "Mimiku", pluginDeveloper: "test", tokenPath: "./token.json" } }))
  fs.writeFileSync(path.join(dir, "token.json"), JSON.stringify({ authenticationToken: "ok" }))
  const client = new VTSClient(configPath)
  client.on("error", () => {})
  t.after(() => client.disconnect())
  await client.connect()
  return { client, last: () => seen[seen.length - 1] }
}

test("lista los atajos del modelo con id, nombre y tipo", async t => {
  const { client } = await connectedClient(t, {
    HotkeysInCurrentModelRequest: { availableHotkeys: [{ hotkeyID: "h1", name: "Sonrisa", type: "ToggleExpression" }, { hotkeyID: "h2", name: "", type: "TriggerAnimation" }] },
  })
  assert.deepEqual(await client.getHotkeys(), [
    { id: "h1", name: "Sonrisa", type: "ToggleExpression" },
    { id: "h2", name: "h2", type: "TriggerAnimation" },
  ])
})

test("el tinte se aplica a todo el modelo", async t => {
  const { client, last } = await connectedClient(t)
  await client.tintModel({ r: 255, g: 0, b: 128, rainbow: true })
  assert.deepEqual(last(), {
    type: "ColorTintRequest",
    data: { colorTint: { colorR: 255, colorG: 0, colorB: 128, colorA: 255, jeb_: true }, artMeshMatcher: { tintAll: true } },
  })
})

test("mover el modelo solo manda los ejes que cambian", async t => {
  const { client, last } = await connectedClient(t)
  await client.moveModel({ seconds: 0.2, y: 0.3 })
  assert.deepEqual(last(), { type: "MoveModelRequest", data: { timeInSeconds: 0.2, valuesAreRelativeToModel: true, positionY: 0.3 } })
})

test("inyecta parametros en modo set", async t => {
  const { client, last } = await connectedClient(t)
  await client.injectParameters([{ id: "MouthOpen", value: 0.7, extra: 1 }])
  assert.deepEqual(last(), { type: "InjectParameterDataRequest", data: { faceFound: false, mode: "set", parameterValues: [{ id: "MouthOpen", value: 0.7 }] } })
})

test("lista expresiones y las activa con su archivo", async t => {
  const { client, last } = await connectedClient(t, {
    ExpressionStateRequest: { expressions: [{ name: "Mareo", file: "Mareo.exp3.json", active: false }] },
  })
  assert.deepEqual(await client.getExpressions(), [{ file: "Mareo.exp3.json", name: "Mareo" }])
  await client.setExpression("Mareo.exp3.json", true)
  assert.deepEqual(last(), { type: "ExpressionActivationRequest", data: { expressionFile: "Mareo.exp3.json", active: true, fadeTime: 0.25 } })
})

test("carga una imagen propia como item y devuelve su instancia", async t => {
  const { client, last } = await connectedClient(t, { ItemLoadRequest: { instanceID: "inst-1" } })
  const id = await client.loadCustomItem({ fileName: "mimiku-hat.png", base64: "AAAA", size: 0.3, order: 20 })
  assert.equal(id, "inst-1")
  const sent = last()
  assert.equal(sent.type, "ItemLoadRequest")
  assert.equal(sent.data.customDataBase64, "AAAA")
  assert.equal(sent.data.customDataAskUserFirst, false)
  assert.equal(sent.data.unloadWhenPluginDisconnects, true)
})

test("pega un item a un punto aleatorio del modelo", async t => {
  const { client, last } = await connectedClient(t)
  await client.pinItem({ instanceID: "inst-1", size: 0.2 })
  assert.deepEqual(last().data, {
    pin: true, itemInstanceID: "inst-1", angleRelativeTo: "RelativeToModel", sizeRelativeTo: "RelativeToWorld",
    vertexPinType: "Random", pinInfo: { modelID: "", artMeshID: "", angle: 0, size: 0.2 },
  })
})

test("quita items por instancia sin tocar los del streamer", async t => {
  const { client, last } = await connectedClient(t)
  await client.unloadItems(["a", "b"])
  assert.deepEqual(last(), { type: "ItemUnloadRequest", data: { instanceIDs: ["a", "b"], allowUnloadingItemsLoadedByUserOrOtherPlugins: false } })
})

test("la fisica exagerada fija fuerza y viento base", async t => {
  const { client, last } = await connectedClient(t)
  await client.setPhysics({ strength: 100, wind: 70, seconds: 5 })
  assert.deepEqual(last().data, {
    strengthOverrides: [{ id: "", value: 100, setBaseValue: true, overrideSeconds: 5 }],
    windOverrides: [{ id: "", value: 70, setBaseValue: true, overrideSeconds: 5 }],
  })
})
