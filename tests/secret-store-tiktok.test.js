const test = require("node:test")
const assert = require("node:assert/strict")

const { createSecretStore } = require("../src/services/secret-store.js")

function fakeDb() {
  const values = new Map()
  return {
    values,
    prepare(sql) {
      if (sql.includes("SELECT value")) return { get: key => values.has(key) ? { value: values.get(key) } : undefined }
      if (sql.includes("INSERT INTO settings")) return { run: (key, value) => values.set(key, value) }
      if (sql.includes("DELETE FROM settings")) return { run: key => ({ changes: values.delete(key) ? 1 : 0 }) }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
}

// Una sola base por test: getDatabase debe devolver siempre la misma instancia.
function sharedDb() {
  const db = fakeDb()
  return () => db
}

const encrypting = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`enc:${value}`),
  decryptString: value => value.toString().replace(/^enc:/, ""),
}
const CREDENTIALS = { signApiKey: "euler-key-123", sessionId: "session-abc-456", ttTargetIdc: "useast1a" }

test("las credenciales de TikTok se cifran en disco y se recuperan completas", () => {
  const db = fakeDb()
  const store = createSecretStore(() => db, encrypting)
  store.setTikTokCredentials(CREDENTIALS)
  for (const stored of db.values.values()) {
    for (const secret of Object.values(CREDENTIALS)) assert.equal(stored.includes(secret), false)
  }
  assert.deepEqual(store.getTikTokCredentials(), CREDENTIALS)
  assert.deepEqual(store.getTikTokStatus(), { configured: true, protected: true, missing: [] })
})

test("el estado nunca incluye los valores", () => {
  const store = createSecretStore(sharedDb(), encrypting)
  store.setTikTokCredentials(CREDENTIALS)
  const serialized = JSON.stringify(store.getTikTokStatus())
  for (const secret of Object.values(CREDENTIALS)) assert.equal(serialized.includes(secret), false)
})

test("con credenciales incompletas getTikTokCredentials devuelve null y el estado dice que falta", () => {
  const store = createSecretStore(sharedDb(), encrypting)
  store.setTikTokCredentials({ sessionId: "solo-sesion" })
  assert.equal(store.getTikTokCredentials(), null)
  const status = store.getTikTokStatus()
  assert.equal(status.configured, false)
  assert.deepEqual(status.missing, ["clave de API", "tt-target-idc"])
})

test("actualizar una pieza no borra las demas", () => {
  const store = createSecretStore(sharedDb(), encrypting)
  store.setTikTokCredentials(CREDENTIALS)
  store.setTikTokCredentials({ sessionId: "nueva-sesion" })
  assert.deepEqual(store.getTikTokCredentials(), { ...CREDENTIALS, sessionId: "nueva-sesion" })
})

test("borrar elimina todo, incluido el disco", () => {
  const db = fakeDb()
  const store = createSecretStore(() => db, encrypting)
  store.setTikTokCredentials(CREDENTIALS)
  store.clearTikTokCredentials()
  assert.equal(store.getTikTokCredentials(), null)
  assert.equal(db.values.size, 0)
})

test("sin cifrado disponible las credenciales viven solo en memoria y no tocan el disco", () => {
  const db = fakeDb()
  const store = createSecretStore(() => db, { isEncryptionAvailable: () => false })
  store.setTikTokCredentials(CREDENTIALS)
  assert.deepEqual(store.getTikTokCredentials(), CREDENTIALS)
  assert.equal(db.values.size, 0)
  assert.equal(store.getTikTokStatus().protected, false)
})

test("los secretos de TikTok no interfieren con el token de Twitch", () => {
  const db = fakeDb()
  const store = createSecretStore(() => db, encrypting)
  store.setTwitchToken("oauth:token")
  store.setTikTokCredentials(CREDENTIALS)
  store.clearTikTokCredentials()
  assert.equal(store.getTwitchToken(), "oauth:token")
  assert.ok(db.values.has("secret_twitch_token_v1"))
})
