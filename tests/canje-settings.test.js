const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { createCanje, cleanPublicUrl, cleanPort, cleanClientId } = require("../src/services/canje.js")

function setup({ failWith } = {}) {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
  const servers = []
  const canje = createCanje({
    getDatabase: () => db,
    createServer: getConfig => {
      const server = {
        running: false, getConfig,
        async start(port) { if (failWith) throw failWith; server.running = true; return port },
        async stop() { server.running = false },
      }
      servers.push(server)
      return server
    },
    log: { error() {} },
  })
  return { canje, servers }
}

const VALID = { enabled: true, port: 7780, clientId: "abcdefghij0123456789", publicUrl: "https://gatita.ngrok-free.app" }

test("validaciones: https, puerto fuera del overlay y Client ID con buena forma", () => {
  assert.equal(cleanPublicUrl("gatita.ngrok-free.app/"), "https://gatita.ngrok-free.app")
  assert.equal(cleanPublicUrl(""), "")
  assert.throws(() => cleanPublicUrl("http://gatita.ngrok-free.app"), /https/)
  assert.equal(cleanPort(7780), 7780)
  assert.throws(() => cleanPort(7777), /overlay/)
  assert.throws(() => cleanPort(80), /1024/)
  assert.throws(() => cleanClientId("no vale!"), /Client ID/)
})

test("arranca el servidor al activarlo y lo para al desactivarlo", async () => {
  const { canje, servers } = setup()
  const settings = await canje.saveSettings(VALID)
  assert.equal(settings.status.running, true)
  assert.equal(settings.status.port, 7780)
  await canje.saveSettings({ ...VALID, enabled: false })
  assert.equal(servers[0].running, false)
  assert.equal(canje.getSettings().status.running, false)
})

test("no arranca sin Client ID y lo dice", async () => {
  const { canje, servers } = setup()
  const settings = await canje.saveSettings({ ...VALID, clientId: "" })
  assert.equal(servers.length, 0)
  assert.equal(settings.status.error, "Falta el Client ID de Twitch")
})

test("avisa si el puerto esta ocupado", async () => {
  const { canje } = setup({ failWith: Object.assign(new Error("busy"), { code: "EADDRINUSE" }) })
  const settings = await canje.saveSettings(VALID)
  assert.equal(settings.status.running, false)
  assert.equal(settings.status.error, "El puerto 7780 está ocupado")
})

test("da el link, la URL de redireccion para Twitch y el comando de ngrok", async () => {
  const { canje } = setup()
  const settings = await canje.saveSettings(VALID)
  assert.equal(settings.link, "https://gatita.ngrok-free.app/")
  assert.equal(settings.redirectUrl, "https://gatita.ngrok-free.app/")
  assert.equal(settings.ngrokCommand, "ngrok http --url=gatita.ngrok-free.app 7780")
})
