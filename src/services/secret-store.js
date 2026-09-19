// Almacen de secretos: cifra con safeStorage de Electron (DPAPI en Windows).
// Si el cifrado no esta disponible, el secreto vive SOLO en memoria durante la
// sesion y nunca se escribe en disco en claro.
//
// Los secretos se identifican por nombre; la clave en la tabla settings es
// `secret_<nombre>_v1`. El token de Twitch conserva su clave historica.
const TWITCH_TOKEN_KEY = "secret_twitch_token_v1"

const TWITCH_TOKEN = "twitch_token"
const TIKTOK_SIGN_API_KEY = "tiktok_sign_api_key"
const TIKTOK_SESSION_ID = "tiktok_session_id"
const TIKTOK_TARGET_IDC = "tiktok_target_idc"
const TIKTOK_SECRETS = [TIKTOK_SIGN_API_KEY, TIKTOK_SESSION_ID, TIKTOK_TARGET_IDC]

const MAX_SECRET_LENGTH = 4096

function storageKey(name) {
  return `secret_${name}_v1`
}

function createSecretStore(getDatabase, safeStorage) {
  const volatile = new Map()

  function readStored(name) {
    return getDatabase().prepare("SELECT value FROM settings WHERE key = ?").get(storageKey(name))?.value || ""
  }

  function setStored(name, value) {
    getDatabase().prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(storageKey(name), value)
  }

  function clearStored(name) {
    getDatabase().prepare("DELETE FROM settings WHERE key = ?").run(storageKey(name))
  }

  function encryptionAvailable() {
    return !!safeStorage?.isEncryptionAvailable?.()
  }

  function setSecret(name, rawValue) {
    const value = typeof rawValue === "string" ? rawValue.trim().slice(0, MAX_SECRET_LENGTH) : ""
    if (!value) {
      volatile.delete(name)
      clearStored(name)
      return
    }
    if (!encryptionAvailable()) {
      volatile.set(name, value)
      clearStored(name)
      return
    }
    volatile.delete(name)
    setStored(name, safeStorage.encryptString(value).toString("base64"))
  }

  function getSecret(name) {
    if (volatile.has(name)) return volatile.get(name)
    const stored = readStored(name)
    if (!stored || !encryptionAvailable()) return ""
    try { return safeStorage.decryptString(Buffer.from(stored, "base64")) } catch { return "" }
  }

  function secretStatus(name) {
    return { configured: !!getSecret(name), protected: encryptionAvailable() && !!readStored(name) }
  }

  // ── Twitch ────────────────────────────────────────────────────────────────
  function setTwitchToken(rawToken) {
    setSecret(TWITCH_TOKEN, rawToken)
    return getTwitchStatus()
  }
  function getTwitchToken() { return getSecret(TWITCH_TOKEN) }
  function getTwitchStatus() { return secretStatus(TWITCH_TOKEN) }

  // ── TikTok: credenciales para ENVIAR chat (opcional) ─────────────────────
  // `sessionid` da acceso a la cuenta de TikTok: nunca se devuelve al
  // renderer, solo el estado. Un valor vacio no borra el ya guardado, para
  // poder actualizar una sola pieza sin volver a escribir las demas.
  function setTikTokCredentials({ signApiKey, sessionId, ttTargetIdc } = {}) {
    if (signApiKey) setSecret(TIKTOK_SIGN_API_KEY, signApiKey)
    if (sessionId) setSecret(TIKTOK_SESSION_ID, sessionId)
    if (ttTargetIdc) setSecret(TIKTOK_TARGET_IDC, ttTargetIdc)
    return getTikTokStatus()
  }

  function clearTikTokCredentials() {
    for (const name of TIKTOK_SECRETS) setSecret(name, "")
    return getTikTokStatus()
  }

  // Devuelve las tres piezas o null si falta alguna.
  function getTikTokCredentials() {
    const credentials = {
      signApiKey: getSecret(TIKTOK_SIGN_API_KEY),
      sessionId: getSecret(TIKTOK_SESSION_ID),
      ttTargetIdc: getSecret(TIKTOK_TARGET_IDC),
    }
    return credentials.signApiKey && credentials.sessionId && credentials.ttTargetIdc ? credentials : null
  }

  function getTikTokStatus() {
    const parts = TIKTOK_SECRETS.map(secretStatus)
    return {
      configured: parts.every(part => part.configured),
      protected: parts.every(part => part.protected),
      missing: TIKTOK_SECRETS.filter((name, index) => !parts[index].configured)
        .map(name => ({ [TIKTOK_SIGN_API_KEY]: "clave de API", [TIKTOK_SESSION_ID]: "sessionid", [TIKTOK_TARGET_IDC]: "tt-target-idc" }[name])),
    }
  }

  return {
    setTwitchToken, getTwitchToken, getTwitchStatus,
    setTikTokCredentials, clearTikTokCredentials, getTikTokCredentials, getTikTokStatus,
  }
}

let defaultStore = null
function getDefaultSecretStore() {
  if (!defaultStore) {
    const { safeStorage } = require("electron")
    defaultStore = createSecretStore(() => require("./db.js").getDb(), safeStorage)
  }
  return defaultStore
}

module.exports = { createSecretStore, getDefaultSecretStore, TWITCH_TOKEN_KEY }
