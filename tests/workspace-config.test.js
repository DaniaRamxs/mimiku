const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeAppConfig } = require("../src/core/config-schema.js")
const { createAppConfigStore } = require("../src/services/app-config.js")

function fakeDatabase(initialValue) {
  const values = new Map()
  if (initialValue !== undefined) values.set("app_config_v1", initialValue)
  return {
    values,
    prepare(sql) {
      if (sql.includes("SELECT value")) return { get: key => values.has(key) ? { value: values.get(key) } : undefined }
      if (sql.includes("INSERT INTO settings")) return { run: (key, value) => values.set(key, value) }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
}

test("onboarding can complete without configuring Twitch", () => {
  const config = normalizeAppConfig({
    onboarding: { completed: true },
    streamer: { displayName: "Kira", twitchChannel: "" },
  })
  assert.equal(config.onboarding.completed, true)
})

test("workspace id remains stable and is provisioned explicitly", () => {
  const db = fakeDatabase()
  const store = createAppConfigStore(() => db, { randomUUID: () => "fake-workspace-uuid" })
  assert.equal(store.getAppConfig().workspace.id, "")
  const first = store.ensureWorkspace()
  const second = store.ensureWorkspace()
  assert.equal(first.id, "local-fake-workspace-uuid")
  assert.equal(second.id, first.id)
})

test("existing Twitch channel becomes the compatible workspace id", () => {
  const db = fakeDatabase(JSON.stringify({
    onboarding: { completed: true },
    streamer: { displayName: "Kira", twitchChannel: "kira_channel" },
  }))
  const store = createAppConfigStore(() => db, { randomUUID: () => "unused" })
  assert.equal(store.ensureWorkspace().id, "kira_channel")
})

