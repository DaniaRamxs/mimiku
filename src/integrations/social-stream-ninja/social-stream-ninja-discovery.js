// Read-only discovery of the active SSApp relay configuration. SSApp stores
// its current Social Stream room in savedSync*.json under Electron's standard
// appData directory. No developer path or streamer identifier is embedded.
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")

const RESERVED_ROOM_IDS = new Set([
  "undefined", "null", "false", "true", "nan", "default", "room",
  "lobby", "test", "nothing", "0", "1", "none",
])

function normalizeRoomId(value) {
  if (typeof value !== "string") return null
  const roomId = value.trim()
  if (!roomId || roomId.length > 200 || RESERVED_ROOM_IDS.has(roomId.toLowerCase())) return null
  return roomId
}

function readJson(fsImpl, filePath) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(filePath, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch (_) {
    return null
  }
}

function sessionStateFileName(sessionName) {
  if (!sessionName || sessionName === "default") return "savedSync.json"
  const digest = crypto.createHash("sha256").update(sessionName).digest("hex").slice(0, 24)
  return `savedSync.session-${digest}.json`
}

function discoverSocialStreamNinjaConfig(options = {}) {
  const fsImpl = options.fs || fs
  const appDataDir = options.appDataDir || process.env.APPDATA
  if (!appDataDir) return { found: false, roomId: null, chatRelayEnabled: null, port: null }

  const ssnDir = path.join(appDataDir, "SocialStream")
  const electronConfig = readJson(fsImpl, path.join(ssnDir, "config.json")) || {}
  const currentSession = typeof electronConfig.currentSession === "string" ? electronConfig.currentSession : "default"
  const state = readJson(fsImpl, path.join(ssnDir, sessionStateFileName(currentSession)))
  const roomId = normalizeRoomId(state?.streamID)
  const settings = state?.settings && typeof state.settings === "object" ? state.settings : {}
  const configuredPort = Number(electronConfig.localWebSocket?.port)
  const port = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535
    ? configuredPort
    : 3003

  return {
    found: !!roomId,
    roomId,
    chatRelayEnabled: Object.prototype.hasOwnProperty.call(settings, "server2"),
    port,
    localServerEnabled: electronConfig.wsServer === true,
  }
}

module.exports = { discoverSocialStreamNinjaConfig, normalizeRoomId, sessionStateFileName }
