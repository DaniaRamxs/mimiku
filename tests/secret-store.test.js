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

test("Twitch token is encrypted at rest and never returned by status", () => {
  const db = fakeDb()
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: value => value.toString().replace(/^encrypted:/, ""),
  }
  const store = createSecretStore(() => db, crypto)
  store.setTwitchToken("oauth:fake-token")
  assert.equal(db.values.get("secret_twitch_token_v1").includes("oauth:fake-token"), false)
  assert.equal(store.getTwitchToken(), "oauth:fake-token")
  assert.deepEqual(store.getTwitchStatus(), { configured: true, protected: true })
})

test("empty token clears the stored credential", () => {
  const db = fakeDb()
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value),
    decryptString: value => value.toString(),
  }
  const store = createSecretStore(() => db, crypto)
  store.setTwitchToken("oauth:one")
  store.setTwitchToken("")
  assert.equal(store.getTwitchToken(), "")
  assert.equal(store.getTwitchStatus().configured, false)
})

