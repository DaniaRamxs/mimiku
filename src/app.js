// src/app.js — renderer bootstrap y router
const { ipcRenderer } = require("electron")

const dashboard  = require("./pages/dashboard.js")
const economy    = require("./pages/economy.js")
const settings   = require("./pages/settings.js")
const overlay    = require("./pages/overlay.js")
const modsPage   = require("./pages/mods.js")
const afkPage    = require("./pages/afk.js")
const gamesPage  = require("./pages/games.js")
const arenaPage  = require("./pages/arena.js")
const cardsPage  = require("./pages/cards.js")
const eventsPage = require("./pages/events-panel.js")
const mimicsPage = require("./pages/mimics.js")
const levelsPage = require("./pages/levels.js")
const emotesPage = require("./pages/emotes.js")
const vtuberPage = require("./pages/vtuber.js")
const widgetsPage = require("./pages/widgets.js")

window.economyPage  = economy
window.overlayPage  = overlay
window.settingsPage = settings
window.modsPage     = modsPage
window.afkPage      = afkPage
window.gamesPage    = gamesPage
window.arenaPage    = arenaPage
window.cardsPage    = cardsPage
window.deleteCard   = (id) => cardsPage.deleteCard(id)
window.uploadCardImage = (file) => cardsPage.uploadCardImage(file)
window.eventsPage   = eventsPage
window.mimicsPage   = mimicsPage
window.levelsPage   = levelsPage
window.emotesPage   = emotesPage
window.vtuberPage   = vtuberPage
window.widgetsPage  = widgetsPage

window.minimize = () => ipcRenderer.invoke("app:minimize")
window.maximize = () => ipcRenderer.invoke("app:maximize")
window.quit     = () => ipcRenderer.invoke("app:quit")

const pages    = {}
const navItems = {}
let activePage = "dashboard"

function showPage(id) {
  if (pages[activePage])    pages[activePage].classList.remove("active")
  if (navItems[activePage]) navItems[activePage].classList.remove("active")
  activePage = id
  if (pages[id])    pages[id].classList.add("active")
  if (navItems[id]) navItems[id].classList.add("active")

  if (id === "economy") { economy.renderRanking(); economy.renderLog() }
  if (id === "mods")    modsPage.refreshModList()
  if (id === "cards")   { cardsPage.loadCards(); cardsPage.loadPacks() }
  if (id === "mimics")  { mimicsPage.loadMimics(); mimicsPage.loadBoxes() }
  if (id === "levels")  { levelsPage.initLevels() }
  if (id === "emotes")  { emotesPage.initEmotes() }
  if (id === "vtuber")  { vtuberPage.initVtuber() }
  if (id === "arena")   { arenaPage.initArena() }
  if (id === "events")  eventsPage.refreshStatus()
  if (id === "widgets") widgetsPage.initWidgets()
}
window.showPage = showPage
window.showToast = function(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".page").forEach(p  => { pages[p.id] = p })
  document.querySelectorAll(".nav-item").forEach(b => {
    const id = b.dataset.page
    if (id) { navItems[id] = b; b.addEventListener("click", () => showPage(id)) }
  })

  dashboard.initDashboard()
  const appConfig = await settings.initSettings()
  overlay.initOverlay()
  economy.initEconomy()
  modsPage.initMods()
  afkPage.initAfk()
  gamesPage.initGames()
  cardsPage.initCards()
  eventsPage.initEvents()
  mimicsPage.initMimics()  // Panel Director del Caos

  const ch  = appConfig.streamer.twitchChannel || localStorage.getItem("mimiku_channel")
  const tok = localStorage.getItem("mimiku_token")
  if (ch) ipcRenderer.invoke("twitch:connect", { channel: ch, token: tok || "" })

  if (!appConfig.onboarding.completed) {
    document.getElementById("onboarding-display-name").value = appConfig.streamer.displayName || ""
    document.getElementById("onboarding-twitch-channel").value = ch || ""
    document.getElementById("onboarding-modal").style.display = "flex"
  }

  ipcRenderer.on("mods:command", (_, cmd) => modsPage.onModCommand(cmd))
})
