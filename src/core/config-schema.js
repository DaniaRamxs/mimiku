// Servidor local del overlay. allowLan=true escucha en 0.0.0.0 (accesible por la
// IP de red local); false limita el servidor a loopback (127.0.0.1).
const DEFAULT_OVERLAY_CONFIG = Object.freeze({
  httpPort: 7777,
  wsPort: 7778,
  allowLan: true,
  customHostname: "",
})

const MIN_PORT = 1
const MAX_PORT = 65535
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/

const DEFAULT_APP_CONFIG = Object.freeze({
  version: 2,
  overlay: { ...DEFAULT_OVERLAY_CONFIG },
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
    tiktok: { enabled: false, username: "", autoReconnect: true, sendReplies: false },
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

function cleanPort(value, fallback, min = MIN_PORT) {
  const port = Number(value)
  return Number.isInteger(port) && port >= min && port <= MAX_PORT ? port : fallback
}

// Acepta lo que un usuario pegaría (con esquema, puerto o ruta) y devuelve solo
// el hostname en minúsculas; "" si no es un hostname válido.
function cleanHostname(value) {
  const host = cleanText(value, 300).toLowerCase()
    .replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "")
  return HOSTNAME_PATTERN.test(host) ? host : ""
}

// wsPort 0 desactiva el puerto WebSocket heredado (el overlay también conecta
// por el puerto HTTP, ruta /ws).
function normalizeOverlayConfig(input = {}) {
  const httpPort = cleanPort(input.httpPort, DEFAULT_OVERLAY_CONFIG.httpPort)
  const wsPort = Number(input.wsPort) === 0 ? 0 : cleanPort(input.wsPort, DEFAULT_OVERLAY_CONFIG.wsPort)
  return {
    httpPort,
    wsPort: wsPort === httpPort ? 0 : wsPort,
    allowLan: input.allowLan !== false,
    customHostname: cleanHostname(input.customHostname),
  }
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
    overlay: normalizeOverlayConfig(input.overlay),
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
        // Responder en el chat de TikTok: opt-in, necesita credenciales (secret-store).
        sendReplies: tiktok.sendReplies === true,
      },
    },
  }
}

function publicAppConfig(config) {
  const normalized = normalizeAppConfig(config)
  return {
    version: normalized.version,
    overlay: normalized.overlay,
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

module.exports = {
  DEFAULT_APP_CONFIG, DEFAULT_OVERLAY_CONFIG, MIN_PORT, MAX_PORT,
  normalizeAppConfig, normalizeOverlayConfig, publicAppConfig, cleanHostname,
}
