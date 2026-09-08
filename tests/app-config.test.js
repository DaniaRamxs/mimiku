const test = require("node:test")
const assert = require("node:assert/strict")

const { createAppConfigStore } = require("../src/services/app-config.js")

function fakeDatabase(initialValue) {
  const values = new Map()
  if (initialValue !== undefined) values.set("app_config_v1", initialValue)
  return {
    values,
    prepare(sql) {
      if (sql.includes("SELECT value")) {
        return { get: key => values.has(key) ? { value: values.get(key) } : undefined }
      }
      if (sql.includes("INSERT INTO settings")) {
        return { run: (key, value) => values.set(key, value) }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
}

test("config store returns neutral defaults for a clean install", () => {
  const db = fakeDatabase()
  const store = createAppConfigStore(() => db)
  const config = store.getAppConfig()
  assert.equal(config.onboarding.completed, false)
  assert.equal(config.streamer.twitchChannel, "")
  assert.equal(db.values.size, 0)
})

test("config store persists normalized onboarding values", () => {
  const db = fakeDatabase()
  const store = createAppConfigStore(() => db)
  store.saveAppConfig({
    onboarding: { completed: true },
    streamer: { displayName: " Luna ", twitchChannel: " @LunaTV " },
  })

  const saved = JSON.parse(db.values.get("app_config_v1"))
  assert.equal(saved.streamer.displayName, "Luna")
  assert.equal(saved.streamer.twitchChannel, "lunatv")
  assert.equal(saved.onboarding.completed, true)
})

test("public store response redacts the legacy cloud key", () => {
  const db = fakeDatabase()
  const store = createAppConfigStore(() => db)
  store.saveAppConfig({
    integrations: {
      legacySupabase: {
        enabled: true,
        url: "https://example.supabase.co",
        anonKey: "private-value",
      },
    },
  })

  assert.equal(JSON.stringify(store.getPublicAppConfig()).includes("private-value"), false)
})

test("malformed stored configuration falls back safely", () => {
  const store = createAppConfigStore(() => fakeDatabase("not-json"))
  assert.equal(store.getAppConfig().onboarding.completed, false)
})
