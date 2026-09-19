const DEFAULT_APP_CONFIG = Object.freeze({
  version: 2,
  onboarding: { completed: false },
  workspace: {
    id: "",
    name: "",
  },
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
    socialStreamNinja: {
      token: "",
      enabled: false,
      sessionId: "",
    },
    tiktok: { enabled: false, username: "", autoReconnect: true },
  },
})

function cleanText(value, maxLength = 200) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function cleanChannel(value) {
  return cleanText(value, 25).replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "")
}

function cleanTikTokUser(value) {
  return cleanText(value, 40).replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_.]/g, "")
}

function cleanWorkspaceId(value) {
  return cleanText(value, 80).toLowerCase().replace(/[^a-z0-9_:-]/g, "")
}

function normalizeAppConfig(input = {}) {
  const streamer = input.streamer || {}
  const workspace = input.workspace || {}
  const integrations = input.integrations || {}
  const twitch = integrations.twitch || {}
  const legacySupabase = integrations.legacySupabase || {}
  const socialStreamNinja = integrations.socialStreamNinja || {}
  const tiktok = integrations.tiktok || {}

  const displayName = cleanText(streamer.displayName, 80)
  const twitchChannel = cleanChannel(streamer.twitchChannel)
  const completed = input.onboarding?.completed === true && !!displayName

  return {
    version: 2,
    onboarding: { completed },
    workspace: {
      id: cleanWorkspaceId(workspace.id),
      name: cleanText(workspace.name, 80),
    },
    streamer: { displayName, twitchChannel },
    integrations: {
      twitch: { clientId: cleanText(twitch.clientId, 100) },
      legacySupabase: {
        enabled: legacySupabase.enabled === true,
        url: cleanText(legacySupabase.url, 500),
        anonKey: cleanText(legacySupabase.anonKey, 4096),
      },
      socialStreamNinja: {
        token: cleanText(socialStreamNinja.token, 100),
        // Config del transporte nuevo (WebSocket local a SSApp) — genérico
        // por instalación, nunca un valor de desarrollo. sessionId es del
        // streamer, no de Mimiku ni del autor del código.
        enabled: socialStreamNinja.enabled === true,
        sessionId: cleanText(socialStreamNinja.sessionId, 200),
      },
      tiktok: {
        enabled: tiktok.enabled === true,
        username: cleanTikTokUser(tiktok.username),
        autoReconnect: tiktok.autoReconnect !== false,
      },
    },
  }
}

function publicAppConfig(config) {
  const normalized = normalizeAppConfig(config)
  return {
    version: normalized.version,
    onboarding: normalized.onboarding,
    workspace: normalized.workspace,
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
      // El token de SSN no es un secreto frente al propio streamer — lo
      // necesita para copiar la URL de `postserver` — solo frente a la red.
      socialStreamNinja: normalized.integrations.socialStreamNinja,
      tiktok: normalized.integrations.tiktok,
    },
  }
}

module.exports = { DEFAULT_APP_CONFIG, normalizeAppConfig, publicAppConfig }
