// pages/dashboard.js
const { ipcRenderer } = require("electron")

const PLATFORM_LABEL = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", kick: "Kick", unknown: "?" }

let feedEl, viewersEl, pointsEl, eventsEl, statusEl, serverStatusEl

function initDashboard() {
  feedEl        = document.getElementById("feed")
  viewersEl     = document.getElementById("stat-viewers")
  pointsEl      = document.getElementById("stat-points")
  eventsEl      = document.getElementById("stat-events")
  statusEl      = document.getElementById("stat-status")
  serverStatusEl = document.getElementById("stat-server")

  refreshStats()
  refreshServerStatus()

  // Fuente única para el feed de chat, sin importar la plataforma de origen
  // (Twitch Native o Social Stream Ninja) — ver docs/multiplatform-architecture.md.
  // "twitch:event" (subs/cheers/raids) sigue siendo Twitch-only a propósito.
  ipcRenderer.on("chat:message", (_, d) => {
    const label = PLATFORM_LABEL[d.platform] || d.platform
    addFeedItem("chat", `[${label}] ${d.displayName}: ${d.text}`, platformColor(d.platform))
    refreshStats()
  })

  ipcRenderer.on("chat:response", (_, d) => {
    const label = PLATFORM_LABEL[d.platform] || d.platform
    addFeedItem("respuesta", `[${label}] Mimiku → ${d.username || "viewer"}: ${d.text}`, platformColor(d.platform))
  })

  ipcRenderer.on("twitch:event", (_, d) => {
    addFeedItem(d.type, d.text, "#7c6ef5")
    refreshStats()
    ipcRenderer.invoke("overlay:send", { type: "alert", text: d.text })
  })

  ipcRenderer.on("twitch:status", (_, d) => {
    if (!statusEl) return
    if (d.connected) {
      statusEl.textContent = `🟢 ${d.channel}`
      statusEl.style.color = "#4ade80"
    } else if (d.error) {
      statusEl.textContent = `🔴 Error: ${d.error}`
      statusEl.style.color = "#f87171"
      statusEl.title = d.error
    } else {
      statusEl.textContent = "🔴 Offline"
      statusEl.style.color = "#f87171"
      statusEl.title = ""
    }
  })
}

function platformColor(platform) {
  return { twitch: "#9147ff", youtube: "#ff0000", tiktok: "#00f2ea" }[platform] || "#7c6ef5"
}

async function refreshServerStatus() {
  if (!serverStatusEl) return
  const status = await ipcRenderer.invoke("overlay:getStatus")
  if (status.running) {
    serverStatusEl.textContent = "🟢 127.0.0.1:7777"
    serverStatusEl.style.color = "#4ade80"
    serverStatusEl.title = ""
  } else {
    serverStatusEl.textContent = "🔴 Error"
    serverStatusEl.style.color = "#f87171"
    serverStatusEl.title = status.error || "El servidor local no arrancó."
  }
}

function addFeedItem(type, text, color = "#7c6ef5") {
  if (!feedEl) return
  const empty = feedEl.querySelector(".empty")
  if (empty) empty.remove()

  const el = document.createElement("div")
  el.className = "event"
  const badge = document.createElement("span")
  badge.className = "event-type"
  badge.style.background = `${platformColorValue(color)}22`
  badge.style.color = platformColorValue(color)
  badge.textContent = String(type || "event")
  const content = document.createElement("span")
  content.textContent = String(text || "")
  el.append(badge, content)
  feedEl.prepend(el)

  // máximo 60 eventos en pantalla
  const items = feedEl.querySelectorAll(".event")
  if (items.length > 60) items[items.length - 1].remove()
}

function platformColorValue(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#7c6ef5"
}

async function refreshStats() {
  const stats = await ipcRenderer.invoke("economy:stats")
  if (viewersEl) viewersEl.textContent = stats.total_viewers
  if (pointsEl)  pointsEl.textContent  = stats.total_points.toLocaleString()
  if (eventsEl)  eventsEl.textContent  = stats.total_events
}

module.exports = { initDashboard, addFeedItem }
