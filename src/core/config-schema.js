const DEFAULT_APP_CONFIG = Object.freeze({
  version: 1,
  onboarding: { completed: false },
  streamer: {
    displayName: "",
    twitchChannel: "",
  },
  integrations: {
    twitch: { clientId: "" },
    legacySupabase: {
      enabled: false,
      url: "",
      anonKey: "",
    },
  },
})

function cleanText(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function cleanChannel(value) {
  return cleanText(value, 25).replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "")
}

function normalizeAppConfig(input = {}) {
  const streamer = input.streamer || {}
  const integrations = input.integrations || {}
  const twitch = integrations.twitch || {}
  const legacySupabase = integrations.legacySupabase || {}

  const displayName = cleanText(streamer.displayName, 80)
  const twitchChannel = cleanChannel(streamer.twitchChannel)
  const completed = input.onboarding?.completed === true && !!displayName && !!twitchChannel

  return {
    version: 1,
    onboarding: { completed },
    streamer: { displayName, twitchChannel },
    integrations: {
      twitch: { clientId: cleanText(twitch.clientId, 100) },
      legacySupabase: {
        enabled: legacySupabase.enabled === true,
        url: cleanText(legacySupabase.url, 500),
        anonKey: cleanText(legacySupabase.anonKey, 4096),
      },
    },
  }
}

function publicAppConfig(config) {
  const normalized = normalizeAppConfig(config)
  return {
    version: normalized.version,
    onboarding: normalized.onboarding,
    streamer: normalized.streamer,
    integrations: {
      twitch: normalized.integrations.twitch,
      legacySupabase: {
        enabled: normalized.integrations.legacySupabase.enabled,
        url: normalized.integrations.legacySupabase.url,
        configured: !!(
          normalized.integrations.legacySupabase.url &&
          normalized.integrations.legacySupabase.anonKey
        ),
      },
    },
  }
}

module.exports = { DEFAULT_APP_CONFIG, normalizeAppConfig, publicAppConfig }
