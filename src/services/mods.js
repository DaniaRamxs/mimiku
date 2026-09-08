// Configuración y widgets de moderación locales.
const { getLocalPlatform } = require("./local-runtime.js")

const watchers = new Set()

async function registerChannel(channelId, display, avatarUrl = "") {
  return getLocalPlatform().moderation.setConfig(channelId, "channel", { display, avatarUrl })
}

async function getActiveMods(channelId) { return getLocalPlatform().moderation.activeSessions(channelId) }

function subscribeToOverlay(_channelId, onCommand) {
  const watcher = { type: "command", callback: onCommand }
  watchers.add(watcher)
  return { unsubscribe: () => watchers.delete(watcher) }
}

function subscribeToWidgets(_channelId, onWidget) {
  const watcher = { type: "widget", callback: onWidget }
  watchers.add(watcher)
  return { unsubscribe: () => watchers.delete(watcher) }
}

function emitCommand(command) {
  for (const watcher of watchers) if (watcher.type === "command") watcher.callback(command)
}

function saveWidget(channelId, widget) {
  const saved = getLocalPlatform().moderation.saveWidget(channelId, widget)
  for (const watcher of watchers) if (watcher.type === "widget") watcher.callback(saved, widget.id ? "UPDATE" : "INSERT")
  return saved
}

async function loadWidgets(channelId) {
  return getLocalPlatform().moderation.listWidgets(channelId).filter(widget => widget.visible)
}

async function setAfk(channelId, active, message = "AFK — Volvemos pronto ✦") {
  return getLocalPlatform().moderation.setConfig(channelId, "afk", {
    is_active: !!active, message,
    started_at: active ? new Date().toISOString() : null,
    ended_at: active ? null : new Date().toISOString(),
  })
}

async function getAfkStatus(channelId) { return getLocalPlatform().moderation.getConfig(channelId, "afk") }

module.exports = {
  registerChannel, getActiveMods,
  subscribeToOverlay, subscribeToWidgets, loadWidgets,
  emitCommand, saveWidget, setAfk, getAfkStatus,
}
