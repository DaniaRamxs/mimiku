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
const roulettePage = require("./pages/roulette.js")
const chestsPage = require("./pages/chests.js")
const levelsPage = require("./pages/levels.js")
const emotesPage = require("./pages/emotes.js")
const vipsPage = require("./pages/vips.js")
const vtuberPage = require("./pages/vtuber.js")
const widgetsPage = require("./pages/widgets.js")
const commandsPage = require("./pages/commands.js")

const windowControls = {
  minimize: () => ipcRenderer.invoke("app:minimize"),
  maximize: () => ipcRenderer.invoke("app:maximize"),
  quit: () => ipcRenderer.invoke("app:quit"),
}

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
  if (id === "mimics")  { mimicsPage.loadMimics(); mimicsPage.loadBoxes(); roulettePage.loadRoulette(); chestsPage.loadChestInventory() }
  if (id === "levels")  { levelsPage.initLevels() }
  if (id === "emotes")  { emotesPage.initEmotes() }
  if (id === "vips")    { vipsPage.initVips() }
  if (id === "vtuber")  { vtuberPage.initVtuber() }
  if (id === "arena")   { arenaPage.initArena() }
  if (id === "events")  eventsPage.refreshStatus()
  if (id === "widgets") widgetsPage.initWidgets()
  if (id === "commands") commandsPage.initCommands()
}
function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

const cardsFacade = {
  ...cardsPage,
  uploadCardImage: () => cardsPage.uploadCardImage(document.getElementById("card-img-file")?.files?.[0]),
}

const rendererApi = {
  economyPage: economy,
  overlayPage: overlay,
  settingsPage: settings,
  modsPage,
  afkPage,
  gamesPage,
  arenaPage,
  cardsPage: cardsFacade,
  deleteCard: id => cardsPage.deleteCard(id),
  uploadCardImage: cardsFacade.uploadCardImage,
  eventsPage,
  mimicsPage,
  roulettePage,
  chestsPage,
  levelsPage,
  emotesPage,
  vipsPage,
  vtuberPage,
  widgetsPage,
  commandsPage,
  ...windowControls,
  showPage,
  showToast,
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll(".page").forEach(p  => { pages[p.id] = p })
  document.querySelectorAll(".nav-item").forEach(b => {
    const id = b.dataset.page
    if (id) { navItems[id] = b; b.addEventListener("click", () => showPage(id)) }
  })

  dashboard.initDashboard()
  const appConfig = await settings.initSettings()
  const version = await ipcRenderer.invoke("app:getVersion")
  const versionLabel = document.getElementById("app-version")
  if (versionLabel) versionLabel.textContent = `Mimiku v${version}`
  overlay.initOverlay()
  economy.initEconomy()
  modsPage.initMods()
  afkPage.initAfk()
  gamesPage.initGames()
  cardsPage.initCards()
  eventsPage.initEvents()
  mimicsPage.initMimics()  // Panel Director del Caos

  const workspaceId = appConfig.workspace?.id || localStorage.getItem("mimiku_channel") || ""
  if (workspaceId) localStorage.setItem("mimiku_channel", workspaceId)
  const twitchChannel = appConfig.streamer.twitchChannel || ""
  if (twitchChannel) ipcRenderer.invoke("twitch:connect", { channel: twitchChannel })

  if (!appConfig.onboarding.completed) {
    document.getElementById("onboarding-display-name").value = appConfig.streamer.displayName || ""
    document.getElementById("onboarding-twitch-channel").value = twitchChannel
    document.getElementById("onboarding-modal").style.display = "flex"
  }

  ipcRenderer.on("mods:command", (_, cmd) => modsPage.onModCommand(cmd))
})

module.exports = rendererApi
