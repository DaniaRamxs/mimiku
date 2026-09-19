// services/widgets.js — módulo de widgets visuales para el overlay (avatares de chat, etc.)
const fs   = require("fs")
const path = require("path")
const { app } = require("electron")

const DATA_FILE = path.join(app.getPath("userData"), "widgets-config.json")

const DEFAULT_CONFIG = {
  avatars: {
    enabled: true,
    position: "bottom-left",   // bottom-left | bottom-right | top-left | top-right
    duration_s: 6,
    cooldown_s: 15,             // por usuario, evita spam en chats grandes
    show_level: true,
    max_stack: 5,
  },
}

let _config    = null
let _broadcast = null
let _channel   = null
// Clave de cooldown namespaced por identidad (Fase 1.5) — antes era solo
// `username`, así que un Twitch "luna" y un YouTube "luna" hablando a la vez
// habrían compartido el mismo cooldown de 15s del widget de avatar.
const cooldowns    = {}   // "platform:platformUserId|legacy:username" -> último timestamp mostrado

// ── Config persistida en un JSON local (mismo patrón que emoteSounds.js) ─────
function load() {
  if (_config) return _config
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
      _config = { avatars: { ...DEFAULT_CONFIG.avatars, ...(data.avatars || {}) } }
    }
  } catch (e) {}
  if (!_config) _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  return _config
}

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(_config, null, 2)) } catch (e) {}
}

function publicAvatarsConfig(a) { return a }

function init(channel, broadcastFn) {
  _channel   = channel.toLowerCase()
  _broadcast = broadcastFn
  load()
  if (_broadcast) _broadcast({ type: "avatars_config", ...publicAvatarsConfig(_config.avatars) })
}

function setBroadcast(fn) { _broadcast = fn }

function getConfig() { return load() }

function setConfig(updates) {
  load()
  if (updates.avatars) _config.avatars = { ..._config.avatars, ...updates.avatars }
  save()
  if (_broadcast) _broadcast({ type: "avatars_config", ...publicAvatarsConfig(_config.avatars) })
  return _config
}

function getAvatarsConfig() { return load().avatars }

function localAvatarUrl(username, platformName = "twitch") {
  return require("./local-runtime.js").getLocalPlatform().identities.byUsername(username, platformName)?.avatar_url || null
}

// ── Avatar al hablar en el chat ───────────────────────────────────────────────
// platformName/platformUserId (Fase 1.5): identidad completa para que
// Twitch:luna y YouTube:luna no comparta cooldown, avatar ni nivel.
async function onChatMessage(username, display, color, platformName = "twitch", platformUserId = "") {
  const cfg = getAvatarsConfig()
  if (!cfg.enabled) return
  const key = `${platformName}:${platformUserId || "legacy:" + username.toLowerCase()}`
  const now = Date.now()
  if ((now - (cooldowns[key] || 0)) / 1000 < cfg.cooldown_s) return
  cooldowns[key] = now

  const levels = require("./levels.js")
  const [avatar, levelInfo, titles] = await Promise.all([
    Promise.resolve(localAvatarUrl(username, platformName)),
    _channel ? levels.getViewerLevel(_channel, username, platformUserId, platformName).catch(() => null) : null,
    cfg.show_level && _channel ? levels.getTitles(_channel).catch(() => null) : null,
  ])
  const title = levelInfo && titles ? levels.titleForLevel(levelInfo.level, titles) : null

  if (_broadcast) {
    _broadcast({
      type: "chat_avatar",
      username, display: display || username, platform: platformName,
      avatar: avatar || null,
      color: color || "#7c6ef5",
      level: cfg.show_level ? (levelInfo?.level ?? null) : null,
      titleIcon: title?.icon || "⭐",
    })
  }
}

// ── Probar desde el panel (sin necesitar chat conectado) ─────────────────────
function testAvatar() {
  const cfg = getAvatarsConfig()
  if (_broadcast) {
    _broadcast({
      type: "chat_avatar",
      username: "viewer_demo", display: "ViewerDemo",
      avatar: null,
      color: "#7c6ef5",
      level: cfg.show_level ? 12 : null,
      titleIcon: "⭐",
    })
  }
  return { ok: true }
}

module.exports = {
  init, setBroadcast, getConfig, setConfig,
  onChatMessage, testAvatar,
}
