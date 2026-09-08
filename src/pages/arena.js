// pages/arena.js — Control de partidas Arena desde Mimiku Desktop
const { ipcRenderer } = require("electron")

let currentRoom = null
let lobbyPoll = null

const CATEGORIES = [
  { id: "libre",       label: "Libre" },
  { id: "animales",    label: "Animales" },
  { id: "paises",      label: "Países" },
  { id: "comida",      label: "Comida" },
  { id: "videojuegos", label: "Videojuegos" },
  { id: "anime",       label: "Anime" },
  { id: "peliculas",   label: "Películas" },
  { id: "musica",      label: "Música" },
  { id: "tecnologia",  label: "Tecnología" },
  { id: "ciencia",     label: "Ciencia" },
]

async function initArena() {
  // ver si ya hay sala activa
  currentRoom = await ipcRenderer.invoke("arena:getRoom")
  renderArena()
  if (currentRoom && currentRoom.status !== "finished") startLobbyPoll()
}

function renderArena() {
  const setup  = document.getElementById("arena-setup")
  const lobby  = document.getElementById("arena-lobby")
  if (!setup || !lobby) return

  if (!currentRoom || currentRoom.status === "finished") {
    setup.style.display = "block"
    lobby.style.display = "none"
    return
  }
  setup.style.display = "none"
  lobby.style.display = "block"
  renderLobby()
}

function renderLobby() {
  if (!currentRoom) return
  const codeEl = document.getElementById("arena-room-code")
  if (codeEl) codeEl.textContent = currentRoom.code
  const linkEl = document.getElementById("arena-room-link")
  if (linkEl) linkEl.textContent = "El chat entra a la sección Arena del panel y escribe el código " + currentRoom.code

  const players = currentRoom.players || []
  const grid = document.getElementById("arena-players-grid")
  const countEl = document.getElementById("arena-player-count")
  if (countEl) countEl.textContent = players.length
  if (grid) {
    grid.innerHTML = players.length ? players.map(p => `
      <div class="arena-player-chip ${p.is_ready ? "ready" : ""}">
        <div class="arena-player-av">${p.avatar ? `<img src="${p.avatar}">` : (p.display||"?")[0].toUpperCase()}</div>
        <div class="arena-player-name">${p.display}</div>
        ${p.is_ready ? `<span class="arena-ready-tag">Listo</span>` : ""}
      </div>`).join("") : `<p class="empty">Esperando jugadores… comparte el código ${currentRoom.code}</p>`
  }

  const statusEl = document.getElementById("arena-status-label")
  if (statusEl) statusEl.textContent = currentRoom.status === "playing" ? "EN JUEGO" : "EN LOBBY"
}

async function createArenaRoom() {
  const category   = document.getElementById("arena-category").value
  const startTime  = parseInt(document.getElementById("arena-start-time").value) || 15
  const reduction  = parseInt(document.getElementById("arena-reduction").value) || 1
  const minTime    = parseInt(document.getElementById("arena-min-time").value) || 3
  const rewardType = document.getElementById("arena-reward-type").value
  const rewardValue= document.getElementById("arena-reward-value").value.trim()

  const config = {
    category,
    difficulty: { startTime, reduction, minTime },
    lives: parseInt(document.getElementById("arena-lives").value) || 2,
    syllableLevel: document.getElementById("arena-syllable-level").value || "medio",
    reward: { type: rewardType, value: rewardValue },
  }
  try {
    currentRoom = await ipcRenderer.invoke("arena:createRoom", { game: "palabra_bomba", config })
    renderArena()
    startLobbyPoll()
    showToast("¡Sala creada! Código: " + currentRoom.code)
  } catch (e) {
    showToast("Error: " + e.message)
  }
}

async function startArenaGame() {
  try {
    currentRoom = await ipcRenderer.invoke("arena:start")
    renderArena()
    showToast("¡Partida iniciada!")
  } catch (e) {
    showToast("Error: " + e.message)
  }
}

async function finishArenaGame() {
  await ipcRenderer.invoke("arena:finish")
  currentRoom = null
  stopLobbyPoll()
  renderArena()
  showToast("Partida finalizada")
}

// poll del lobby (refresca jugadores cada 2s mientras hay sala)
function startLobbyPoll() {
  stopLobbyPoll()
  lobbyPoll = setInterval(async () => {
    await ipcRenderer.invoke("arena:refresh")
    currentRoom = await ipcRenderer.invoke("arena:getRoom")
    if (currentRoom) renderLobby()
  }, 2000)
}
function stopLobbyPoll() { if (lobbyPoll) { clearInterval(lobbyPoll); lobbyPoll = null } }

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = {
  initArena, createArenaRoom, startArenaGame, finishArenaGame,
}
