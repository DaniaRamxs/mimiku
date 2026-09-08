const { DEFAULT_APP_CONFIG, normalizeAppConfig, publicAppConfig } = require("../core/config-schema.js")

const CONFIG_KEY = "app_config_v1"

function database() {
  return require("./db.js").getDb()
}

function createAppConfigStore(getDatabase) {
  let cached = null

  function getAppConfig() {
    if (cached) return cached
    const row = getDatabase().prepare("SELECT value FROM settings WHERE key = ?").get(CONFIG_KEY)
    if (!row) {
      cached = normalizeAppConfig(DEFAULT_APP_CONFIG)
      return cached
    }

    try {
      cached = normalizeAppConfig(JSON.parse(row.value))
    } catch {
      cached = normalizeAppConfig(DEFAULT_APP_CONFIG)
    }
    return cached
  }

  function saveAppConfig(updates) {
    const current = getAppConfig()
    const merged = {
      ...current,
      ...updates,
      onboarding: { ...current.onboarding, ...(updates?.onboarding || {}) },
      streamer: { ...current.streamer, ...(updates?.streamer || {}) },
      integrations: {
        ...current.integrations,
        ...(updates?.integrations || {}),
        twitch: { ...current.integrations.twitch, ...(updates?.integrations?.twitch || {}) },
        legacySupabase: {
          ...current.integrations.legacySupabase,
          ...(updates?.integrations?.legacySupabase || {}),
        },
      },
    }
    cached = normalizeAppConfig(merged)
    getDatabase().prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(CONFIG_KEY, JSON.stringify(cached))
    return cached
  }

  function getPublicAppConfig() {
    return publicAppConfig(getAppConfig())
  }

  function isLegacySupabaseConfigured() {
    const legacy = getAppConfig().integrations.legacySupabase
    return legacy.enabled && !!legacy.url && !!legacy.anonKey
  }

  return { getAppConfig, saveAppConfig, getPublicAppConfig, isLegacySupabaseConfigured }
}

const defaultStore = createAppConfigStore(database)

module.exports = {
  createAppConfigStore,
  getAppConfig: defaultStore.getAppConfig,
  saveAppConfig: defaultStore.saveAppConfig,
  getPublicAppConfig: defaultStore.getPublicAppConfig,
  isLegacySupabaseConfigured: defaultStore.isLegacySupabaseConfigured,
}
