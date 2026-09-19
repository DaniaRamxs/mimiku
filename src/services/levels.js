// Niveles completamente locales, con identidad estable y SQLite.
const { getLocalPlatform } = require("./local-runtime.js")

let _broadcast = null
let _channel = null
let _config = null
const msgCooldowns = new Map()

function xpForLevel(level) { return getLocalPlatform().levels.xpForLevel(level) }
function levelFromXp(xp) { return getLocalPlatform().levels.levelFromXp(xp) }

function levelProgress(xp) {
  const level = levelFromXp(xp)
  const current = xpForLevel(level)
  const next = xpForLevel(level + 1)
  return { level, into: xp - current, needed: next - current, pct: Math.min(100, Math.round(((xp - current) / (next - current)) * 100)) }
}

function titleForLevel(level, titles) {
  const list = (titles?.length ? titles : getLocalPlatform().levels.getTitles(_channel || "local"))
    .slice().sort((a, b) => b.min_level - a.min_level)
  return list.find(item => level >= item.min_level) || list[list.length - 1]
}

async function init(channel, broadcastFn) {
  _channel = channel.toLowerCase()
  _broadcast = broadcastFn
  _config = getLocalPlatform().levels.getConfig(_channel)
}

async function addXp(username, amount, reason, platformUserId = "", platformName = "twitch") {
  if (!_channel || Number(amount) <= 0) return undefined
  const platform = getLocalPlatform()
  const identity = platform.identities.resolve({ platform: platformName, platformUserId, username })
  const before = platform.levels.getViewer(_channel, identity.id)
  const result = platform.levels.addXp(_channel, identity.id, Number(amount), reason)
  if (result.level > before.level) {
    if ((_config?.level_up_reward || 0) > 0) {
      require("./economy.js").addPoints(username, _config.level_up_reward * (result.level - before.level), "level-up", { platform: platformName, platformUserId })
    }
    if (_config?.announce_overlay && _broadcast) {
      const title = titleForLevel(result.level, await getTitles(_channel))
      _broadcast({ type: "level_up", username, platform: platformName, level: result.level, title: title.title, titleColor: title.color, titleIcon: title.icon })
    }
  }
  return { oldXp: before.xp || 0, newXp: result.xp, oldLevel: before.level || 1, newLevel: result.level }
}

function onMessage(username, platformUserId = "", platformName = "twitch") {
  if (!_config || !_channel) return
  const key = `${platformName}:${platformUserId || "legacy:" + username.toLowerCase()}`
  const now = Date.now()
  if ((now - (msgCooldowns.get(key) || 0)) / 1000 < _config.msg_cooldown_s) return
  msgCooldowns.set(key, now)
  addXp(username, _config.xp_per_message, "mensaje", platformUserId, platformName).catch(error => console.error("[levels]", error.message))
}

function grantWatchXp(usernames) {
  if (!_config || !Array.isArray(usernames)) return
  for (const username of usernames) addXp(username, _config.xp_per_5min, "tiempo").catch(() => {})
}

async function getTitles(channelId = _channel) { return getLocalPlatform().levels.getTitles(channelId || "local") }

async function getViewerLevel(channelId, username, platformUserId = "", platformName = "twitch") {
  const platform = getLocalPlatform()
  const identity = platform.identities.resolve({ platform: platformName, platformUserId, username })
  const row = platform.levels.getViewer(channelId, identity.id)
  return { xp: row.xp || 0, ...levelProgress(row.xp || 0) }
}

async function getLevelConfig(channelId) { return getLocalPlatform().levels.getConfig(channelId) }
async function setLevelConfig(channelId, updates) {
  const result = getLocalPlatform().levels.setConfig(channelId, updates)
  if (channelId.toLowerCase() === _channel) _config = result
  return result
}
async function getLeaderboard(channelId, limit = 20) { return getLocalPlatform().levels.leaderboard(channelId, limit) }
async function saveTitles(channelId, titles) { return getLocalPlatform().levels.saveTitles(channelId, titles) }

module.exports = {
  init, addXp, onMessage, grantWatchXp,
  getViewerLevel, getLevelConfig, setLevelConfig, getLeaderboard, getTitles, saveTitles,
  xpForLevel, levelFromXp, levelProgress, titleForLevel,
}
