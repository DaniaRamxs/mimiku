// pages/dashboard.js
const { ipcRenderer } = require("electron")

let feedEl, viewersEl, pointsEl, eventsEl, statusEl

function initDashboard() {
  feedEl    = document.getElementById("feed")
  viewersEl = document.getElementById("stat-viewers")
  pointsEl  = document.getElementById("stat-points")
  eventsEl  = document.getElementById("stat-events")
  statusEl  = document.getElementById("stat-status")

  refreshStats()

  ipcRenderer.on("twitch:message", (_, d) => {
    addFeedItem("chat", `${d.display}: ${d.message}`, d.color)
    refreshStats()
  })

  ipcRenderer.on("twitch:event", (_, d) => {
    addFeedItem(d.type, d.text, "#7c6ef5")
    refreshStats()
    ipcRenderer.invoke("overlay:send", { type: "alert", text: d.text })
  })

  ipcRenderer.on("twitch:status", (_, d) => {
    if (statusEl) {
      statusEl.textContent = d.connected ? `🟢 ${d.channel}` : "🔴 Offline"
      statusEl.style.color = d.connected ? "#4ade80" : "#f87171"
    }
  })
}

function addFeedItem(type, text, color = "#7c6ef5") {
  if (!feedEl) return
  const empty = feedEl.querySelector(".empty")
  if (empty) empty.remove()

  const el = document.createElement("div")
  el.className = "event"
  el.innerHTML = `<span class="event-type" style="background:${color}22;color:${color}">${type}</span><span>${text}</span>`
  feedEl.prepend(el)

  // máximo 60 eventos en pantalla
  const items = feedEl.querySelectorAll(".event")
  if (items.length > 60) items[items.length - 1].remove()
}

async function refreshStats() {
  const stats = await ipcRenderer.invoke("economy:stats")
  if (viewersEl) viewersEl.textContent = stats.total_viewers
  if (pointsEl)  pointsEl.textContent  = stats.total_points.toLocaleString()
  if (eventsEl)  eventsEl.textContent  = stats.total_events
}

module.exports = { initDashboard }
