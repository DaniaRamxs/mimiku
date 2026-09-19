const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const crypto = require("node:crypto")

const { discoverSocialStreamNinjaConfig } = require("../src/integrations/social-stream-ninja/social-stream-ninja-discovery.js")

function fakeFs(files) {
  return {
    readFileSync(filePath) {
      const key = path.normalize(filePath)
      if (!files.has(key)) {
        const error = new Error(`missing: ${key}`)
        error.code = "ENOENT"
        throw error
      }
      return files.get(key)
    },
  }
}

test("descubre automáticamente streamID y server2 en la sesión activa de SSApp", () => {
  const appDataDir = path.normalize("C:/Users/test/AppData/Roaming")
  const ssnDir = path.join(appDataDir, "SocialStream")
  const files = new Map([
    [path.join(ssnDir, "config.json"), JSON.stringify({ currentSession: "default", wsServer: true, localWebSocket: { port: 3003 } })],
    [path.join(ssnDir, "savedSync.json"), JSON.stringify({ streamID: "fake-room-123", settings: { server2: {} } })],
  ])

  const result = discoverSocialStreamNinjaConfig({ appDataDir, fs: fakeFs(files) })
  assert.equal(result.found, true)
  assert.equal(result.roomId, "fake-room-123")
  assert.equal(result.chatRelayEnabled, true)
  assert.equal(result.port, 3003)
})

test("respeta la sesión SSApp activa sin asumir rutas o IDs del desarrollador", () => {
  const appDataDir = path.normalize("D:/Profiles/streamer/AppData/Roaming")
  const ssnDir = path.join(appDataDir, "SocialStream")
  const sessionName = "tour-session"
  const scope = `session-${crypto.createHash("sha256").update(sessionName).digest("hex").slice(0, 24)}`
  const files = new Map([
    [path.join(ssnDir, "config.json"), JSON.stringify({ currentSession: sessionName })],
    [path.join(ssnDir, `savedSync.${scope}.json`), JSON.stringify({ streamID: "fake-room-456", settings: {} })],
  ])

  const result = discoverSocialStreamNinjaConfig({ appDataDir, fs: fakeFs(files) })
  assert.equal(result.roomId, "fake-room-456")
  assert.equal(result.chatRelayEnabled, false)
})

test("un archivo ausente o inválido no inventa una sala", () => {
  const missing = discoverSocialStreamNinjaConfig({ appDataDir: "C:/missing", fs: fakeFs(new Map()) })
  assert.equal(missing.found, false)
  assert.equal(missing.roomId, null)

  const appDataDir = path.normalize("C:/invalid")
  const ssnDir = path.join(appDataDir, "SocialStream")
  const invalid = discoverSocialStreamNinjaConfig({
    appDataDir,
    fs: fakeFs(new Map([
      [path.join(ssnDir, "config.json"), "{}"],
      [path.join(ssnDir, "savedSync.json"), JSON.stringify({ streamID: "default", settings: {} })],
    ])),
  })
  assert.equal(invalid.found, false)
})
