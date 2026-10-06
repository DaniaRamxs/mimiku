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

// Experiencia por tiempo viendo: cada 5 min de directo, a quien escribio en
// el chat en los ultimos 10 min (ver watch-time.js).
let _watch = null
function watchTime() {
  if (!_watch) {
    _watch = require("./watch-time.js").createWatchTime({
      grant: grantWatchXp,
      isLive: () => {
        const state = require("./twitch-live-status.js").getDefaultLiveStatus().get()
        return state ? state.live : null
      },
    })
  }
  return _watch
}

async function init(channel, broadcastFn) {
  _channel = channel.toLowerCase()
  _broadcast = broadcastFn
  _config = getLocalPlatform().levels.getConfig(_channel)
  watchTime().start()
}

async function addXp(username, amount, reason, platformUserId = "", platformName = "twitch") {
  if (!_channel || Number(amount) <= 0) return undefined
  const platform = getLocalPlatform()
  const identity = platform.identities.resolve({ platform: platformName, platformUserId, username })
  const before = platform.levels.getViewer(_channel, identity.id)
  const result = platform.levels.addXp(_channel, identity.id, Number(amount), reason)
  // La misma experiencia cuenta para el pase de batalla de la temporada activa.
  try { require("./battle-pass.js").getDefaultBattlePass().addXp(identity.id, Number(amount), reason) } catch (error) { console.error("[pase]", error.message) }
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
  watchTime().note(username, platformUserId, platformName)
  const key = `${platformName}:${platformUserId || "legacy:" + username.toLowerCase()}`
  const now = Date.now()
  if ((now - (msgCooldowns.get(key) || 0)) / 1000 < _config.msg_cooldown_s) return
  msgCooldowns.set(key, now)
  addXp(username, _config.xp_per_message, "mensaje", platformUserId, platformName).catch(error => console.error("[levels]", error.message))
}

// `viewers`: [{ username, platformUserId, platform }] (o nombres sueltos, como antes).
function grantWatchXp(viewers) {
  if (!_config || !Array.isArray(viewers)) return
  for (const viewer of viewers) {
    const who = typeof viewer === "string" ? { username: viewer } : viewer
    addXp(who.username, _config.xp_per_5min, "tiempo", who.platformUserId || "", who.platform || "twitch").catch(error => console.error("[levels]", error.message))
  }
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

// Quien ve el directo desde la pagina de canje (live-watch.js): cuenta para la
// experiencia por tiempo como si hubiera escrito en el chat.
function noteWatcher(username, platformUserId = "", platformName = "twitch") {
  if (username) watchTime().note(username, platformUserId, platformName)
}

// Quien ha escrito en el chat hace poco (Comunidad: "Ahora en el canal").
function activeChatters() { return _watch ? _watch.active() : [] }

module.exports = {
  init, addXp, onMessage, noteWatcher, grantWatchXp, activeChatters,
  getViewerLevel, getLevelConfig, setLevelConfig, getLeaderboard, getTitles, saveTitles,
  xpForLevel, levelFromXp, levelProgress, titleForLevel,
}
