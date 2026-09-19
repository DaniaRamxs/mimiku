const test = require("node:test")
const assert = require("node:assert/strict")

const { createAppConfigStore } = require("../src/services/app-config.js")

function fakeDatabase() {
  const values = new Map()
  return {
    values,
    prepare(sql) {
      if (sql.includes("SELECT value")) return { get: key => values.has(key) ? { value: values.get(key) } : undefined }
      if (sql.includes("INSERT INTO settings")) return { run: (key, value) => values.set(key, value) }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
}

test("leer la config de una instalación limpia no genera un token de SSN (sigue sin efectos secundarios)", () => {
  const db = fakeDatabase()
  const store = createAppConfigStore(() => db)
  const config = store.getAppConfig()
  assert.equal(config.integrations.socialStreamNinja.token, "")
  assert.equal(db.values.size, 0)
})

test("getSocialStreamNinjaToken() provisiona una sola vez y persiste el mismo valor entre llamadas", () => {
  const db = fakeDatabase()
  const store = createAppConfigStore(() => db)
  const first = store.getSocialStreamNinjaToken()
  const second = store.getSocialStreamNinjaToken()
  assert.equal(first, second)
  assert.ok(first.length > 0)
  assert.equal(db.values.size, 1)

  // sobrevive a "reiniciar" el proceso (nueva instancia de store, misma DB)
  const restarted = createAppConfigStore(() => db)
  assert.equal(restarted.getSocialStreamNinjaToken(), first)
})

test("guardar enabled/sessionId del transporte nuevo no borra el token del puente postserver (merge, no overwrite)", () => {
  const db = fakeDatabase()
  const store = createAppConfigStore(() => db)
  const token = store.getSocialStreamNinjaToken()

  const saved = store.saveAppConfig({ integrations: { socialStreamNinja: { enabled: true, sessionId: "mi-sesion" } } })

  assert.equal(saved.integrations.socialStreamNinja.token, token) // no se perdió
  assert.equal(saved.integrations.socialStreamNinja.enabled, true)
  assert.equal(saved.integrations.socialStreamNinja.sessionId, "mi-sesion")
})
