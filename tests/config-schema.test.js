const test = require("node:test")
const assert = require("node:assert/strict")

const {
  DEFAULT_APP_CONFIG,
  normalizeAppConfig,
  publicAppConfig,
} = require("../src/core/config-schema.js")

test("clean-install defaults are neutral and onboarding is incomplete", () => {
  assert.equal(DEFAULT_APP_CONFIG.onboarding.completed, false)
  assert.equal(DEFAULT_APP_CONFIG.streamer.displayName, "")
  assert.equal(DEFAULT_APP_CONFIG.streamer.twitchChannel, "")
  assert.equal(DEFAULT_APP_CONFIG.integrations.twitch.clientId, "")
  assert.equal(DEFAULT_APP_CONFIG.integrations.legacySupabase.enabled, false)
  assert.equal(DEFAULT_APP_CONFIG.integrations.legacySupabase.url, "")
  assert.equal(DEFAULT_APP_CONFIG.integrations.legacySupabase.anonKey, "")
})

test("normalization trims and validates streamer-provided configuration", () => {
  const config = normalizeAppConfig({
    onboarding: { completed: true },
    streamer: { displayName: "  Luna  ", twitchChannel: " @LunaTV " },
    integrations: {
      twitch: { clientId: " client-id " },
      legacySupabase: { enabled: true, url: "https://example.supabase.co", anonKey: " anon-key " },
    },
  })

  assert.equal(config.streamer.displayName, "Luna")
  assert.equal(config.streamer.twitchChannel, "lunatv")
  assert.equal(config.integrations.twitch.clientId, "client-id")
  assert.equal(config.integrations.legacySupabase.enabled, true)
})

test("public configuration never exposes credentials", () => {
  const config = normalizeAppConfig({
    streamer: { displayName: "Luna", twitchChannel: "luna" },
    integrations: {
      twitch: { clientId: "public-client-id" },
      legacySupabase: { enabled: true, url: "https://example.supabase.co", anonKey: "secret-value" },
    },
  })

  const exposed = JSON.stringify(publicAppConfig(config))
  assert.equal(exposed.includes("secret-value"), false)
  assert.equal(exposed.includes("anonKey"), false)
})
