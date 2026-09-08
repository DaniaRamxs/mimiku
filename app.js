// app.js — renderer bootstrap y router
// Este archivo corre en el renderer process (browser)
// Los services (db, economy, twitch) corren en main process via IPC
const { ipcRenderer } = require("electron")

// Pages — solo lógica de UI, se comunican via ipcRenderer
const dashboard = require("./src/pages/dashboard.js")
const economy   = require("./src/pages/economy.js")
const settings  = require("./src/pages/settings.js")
const overlay   = require("./src/pages/overlay.js")

// ── Titlebar ──────────────────────────────────────────────────────────────────
function minimize() { ipcRenderer.invoke("app:minimize") }
function maximize() { ipcRenderer.invoke("app:maximize") }
function quit()     { ipcRenderer.invoke("app:quit") }

// ── Router ────────────────────────────────────────────────────────────────────
const pages    = {}
const navItems = {}
let activePage = "dashboard"

function showPage(id) {
  if (pages[activePage])   pages[activePage].classList.remove("active")
  if (navItems[activePage]) navItems[activePage].classList.remove("active")

  activePage = id
  if (pages[id])   pages[id].classList.add("active")
  if (navItems[id]) navItems[id].classList.add("active")

  if (id === "economy") {
    economy.renderRanking()
    economy.renderLog()
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".page").forEach(p => { pages[p.id] = p })
  document.querySelectorAll(".nav-item").forEach(b => {
    const id = b.dataset.page
    if (id) {
      navItems[id] = b
      b.addEventListener("click", () => showPage(id))
    }
  })

  dashboard.initDashboard()
  settings.initSettings()
  overlay.initOverlay()
  economy.initEconomy()

  // auto-conectar si hay credenciales guardadas
  const ch  = localStorage.getItem("mimiku_channel")
  const tok = localStorage.getItem("mimiku_token")
  if (ch) ipcRenderer.invoke("twitch:connect", { channel: ch, token: tok || "" })
})

// ── Globales para onclick en HTML ─────────────────────────────────────────────
window.minimize         = minimize
window.maximize         = maximize
window.quit             = quit
window.showPage         = showPage
window.saveSettings     = settings.saveSettings
window.disconnectTwitch = settings.disconnectTwitch
window.copyUrl          = overlay.copyUrl
window.sendTestAlert    = overlay.sendTestAlert
window.updateTicker     = overlay.updateTicker
window.grantPoints      = economy.grantPoints
window.economy          = economy
