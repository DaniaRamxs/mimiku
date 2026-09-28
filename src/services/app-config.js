const { randomUUID } = require("node:crypto")
const { DEFAULT_APP_CONFIG, normalizeAppConfig, publicAppConfig } = require("../core/config-schema.js")

const CONFIG_KEY = "app_config_v1"

function database() {
  return require("./db.js").getDb()
}

function createAppConfigStore(getDatabase, options = {}) {
  const createId = options.randomUUID || randomUUID
  let cached = null

  function loadRaw() {
    const row = getDatabase().prepare("SELECT value FROM settings WHERE key = ?").get(CONFIG_KEY)
    if (!row) return normalizeAppConfig(DEFAULT_APP_CONFIG)
    try { return normalizeAppConfig(JSON.parse(row.value)) } catch { return normalizeAppConfig(DEFAULT_APP_CONFIG) }
  }

  function persist(config) {
    getDatabase().prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(CONFIG_KEY, JSON.stringify(config))
  }

  function getAppConfig() {
    if (cached) return cached
    cached = loadRaw()
    return cached
  }

  function saveAppConfig(updates) {
    const current = getAppConfig()
    const merged = {
      ...current,
      ...updates,
      overlay: { ...current.overlay, ...(updates?.overlay || {}) },
      onboarding: { ...current.onboarding, ...(updates?.onboarding || {}) },
      workspace: { ...current.workspace, ...(updates?.workspace || {}) },
      streamer: { ...current.streamer, ...(updates?.streamer || {}) },
      integrations: {
        ...current.integrations,
        ...(updates?.integrations || {}),
        twitch: { ...current.integrations.twitch, ...(updates?.integrations?.twitch || {}) },
        legacySupabase: {
          ...current.integrations.legacySupabase,
          ...(updates?.integrations?.legacySupabase || {}),
        },
        // Merge explícito, igual que twitch/legacySupabase arriba — sin
        // esto, guardar solo {enabled, sessionId} desde el nuevo transporte
        // de SSN borraría el `token` del puente heredado de postserver.
        socialStreamNinja: {
          ...current.integrations.socialStreamNinja,
          ...(updates?.integrations?.socialStreamNinja || {}),
        },
        tiktok: {
          ...current.integrations.tiktok,
          ...(updates?.integrations?.tiktok || {}),
        },
      },
    }
    cached = normalizeAppConfig(merged)
    persist(cached)
    return cached
  }

  function getPublicAppConfig() {
    return publicAppConfig(getAppConfig())
  }

  function isLegacySupabaseConfigured() {
    const legacy = getAppConfig().integrations.legacySupabase
    return legacy.enabled && !!legacy.url && !!legacy.anonKey
  }

  function ensureWorkspace() {
    const current = getAppConfig()
    if (current.workspace.id) return current.workspace
    const id = current.streamer.twitchChannel || `local-${createId()}`
    const updated = saveAppConfig({
      workspace: {
        id,
        name: current.workspace.name || current.streamer.displayName || "Mi comunidad",
      },
    })
    return updated.workspace
  }

  // A diferencia de getAppConfig() (deliberadamente sin efectos secundarios:
  // una instalación limpia no escribe nada solo por leer su configuración),
  // esta función SÍ puede provisionar y persistir la primera vez que se
  // necesita: el token debe ser estable entre reinicios porque el streamer
  // lo pega una sola vez en Social Stream Ninja.
  function getSocialStreamNinjaToken() {
    const current = getAppConfig()
    if (current.integrations.socialStreamNinja.token) return current.integrations.socialStreamNinja.token
    const withToken = normalizeAppConfig({
      ...current,
      integrations: { ...current.integrations, socialStreamNinja: { token: randomUUID().replace(/-/g, "") } },
    })
    cached = withToken
    persist(withToken)
    return withToken.integrations.socialStreamNinja.token
  }

  return { getAppConfig, saveAppConfig, getPublicAppConfig, ensureWorkspace, isLegacySupabaseConfigured, getSocialStreamNinjaToken }
}

const defaultStore = createAppConfigStore(database)

module.exports = {
  createAppConfigStore,
  getAppConfig: defaultStore.getAppConfig,
  saveAppConfig: defaultStore.saveAppConfig,
  getPublicAppConfig: defaultStore.getPublicAppConfig,
  ensureWorkspace: defaultStore.ensureWorkspace,
  isLegacySupabaseConfigured: defaultStore.isLegacySupabaseConfigured,
  getSocialStreamNinjaToken: defaultStore.getSocialStreamNinjaToken,
}
