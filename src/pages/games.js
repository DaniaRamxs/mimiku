// pages/games.js — UI de minijuegos (renderer)
const { ipcRenderer } = require("electron")

let bjOpen = false

async function initGames() {
  const status = await ipcRenderer.invoke("games:bj:status")
  bjOpen = status.open
  updateBjUI()

  // escuchar eventos de juegos desde twitch
  ipcRenderer.on("game:bj", (_, data) => addBjEvent(data))
  ipcRenderer.on("game:roulette", (_, data) => addRouletteEvent(data))
}

// ── BLACKJACK ─────────────────────────────────────────────────────────────────
async function toggleBj() {
  if (bjOpen) {
    await ipcRenderer.invoke("games:bj:close")
    bjOpen = false
  } else {
    await ipcRenderer.invoke("games:bj:open")
    bjOpen = true
  }
  updateBjUI()
  showToast(bjOpen ? "Blackjack abierto ✦ Los viewers pueden usar !bj [apuesta]" : "Blackjack cerrado")
}

function updateBjUI() {
  const btn    = document.getElementById("bj-toggle")
  const badge  = document.getElementById("bj-badge")
  const hint   = document.getElementById("bj-hint")
  if (!btn) return
  if (bjOpen) {
    btn.textContent    = "⏹ Cerrar Blackjack"
    btn.style.background = "var(--danger)"
    if (badge) { badge.textContent = "ACTIVO"; badge.className = "game-badge active" }
    if (hint)  hint.textContent = "Los viewers usan !bj [apuesta] para jugar"
  } else {
    btn.textContent    = "▶ Abrir Blackjack"
    btn.style.background = ""
    if (badge) { badge.textContent = "Cerrado"; badge.className = "game-badge" }
    if (hint)  hint.textContent = "Abre el juego para que los viewers participen"
  }
}

function addBjEvent(data) {
  const feed = document.getElementById("bj-feed")
  if (!feed) return
  const empty = feed.querySelector(".empty")
  if (empty) empty.remove()

  const icons = { join:"🃏", hit:"👆", stand:"✋", blackjack:"🎉", win:"🏆", lose:"💸", push:"🤝", bust:"💥" }
  const icon  = icons[data.result] || icons[data.action] || "🃏"
  const el    = document.createElement("div")
  el.className = "game-event"
  el.innerHTML = `<span class="game-event-icon">${icon}</span><span class="game-event-text">${data.msg || data.text || ""}</span>`
  feed.prepend(el)
  if (feed.children.length > 20) feed.lastChild.remove()
}

// ── RULETA ────────────────────────────────────────────────────────────────────
function addRouletteEvent(data) {
  const feed = document.getElementById("roulette-feed")
  if (!feed) return
  const empty = feed.querySelector(".empty")
  if (empty) empty.remove()

  const colorMap = { rojo: "#ef4444", negro: "#e8e8f0", verde: "#22c55e" }
  const color = colorMap[data.color] || "#e8e8f0"
  const el = document.createElement("div")
  el.className = "game-event"
  el.innerHTML = `
    <span class="roulette-number" style="background:${color === '#e8e8f0' ? '#27272a' : color};color:${color === '#e8e8f0' ? color : '#fff'}">${data.number}</span>
    <span class="game-event-text">${data.msg}</span>`
  feed.prepend(el)
  if (feed.children.length > 20) feed.lastChild.remove()

  // animación de ruleta visual
  animateRoulette(data.number, data.color)
}

function animateRoulette(number, color) {
  const wheel = document.getElementById("roulette-wheel")
  if (!wheel) return
  wheel.classList.add("spinning")
  setTimeout(() => {
    wheel.classList.remove("spinning")
    const colorMap = { rojo:"#ef4444", negro:"#27272a", verde:"#22c55e" }
    wheel.style.background = colorMap[color] || "#27272a"
    wheel.textContent = number
  }, 1500)
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

function addSlotsEvent(data) {
  const feed = document.getElementById("slots-feed")
  if (!feed) return
  const empty = feed.querySelector(".empty")
  if (empty) empty.remove()

  const icons = { jackpot:"🎰", par:"✨", miss:"💸" }
  const colors = { jackpot:"#7c6ef5", par:"#22c55e", miss:"#f87171" }
  const labels = { jackpot:`JACKPOT ${data.multiplier}x`, par:"Par 2x", miss:"Sin suerte" }

  const el = document.createElement("div")
  el.className = "game-event"
  el.innerHTML = `
    <span class="game-event-icon">${icons[data.result]||"🎰"}</span>
    <span style="font-size:11px;color:var(--text-muted)">[${data.s1}|${data.s2}|${data.s3}]</span>
    <span style="flex:1;font-size:12px">${data.display||data.username}</span>
    <span style="color:${colors[data.result]||'#e8e8f0'};font-weight:600;font-size:12px">${labels[data.result]||""}</span>
  `
  feed.prepend(el)
  if (feed.children.length > 20) feed.lastChild.remove()
}

function addCoinEvent(data) {
  const feed = document.getElementById("coin-feed")
  if (!feed) return
  const empty = feed.querySelector(".empty")
  if (empty) empty.remove()
  const el = document.createElement("div")
  el.className = "game-event"
  el.innerHTML = `
    <span class="game-event-icon">${data.win ? "🪙" : "🟤"}</span>
    <span style="flex:1;font-size:12px">${data.display||data.username}</span>
    <span style="font-size:11px;color:var(--text-muted)">${data.side}</span>
    <span style="color:${data.win ? "var(--success)" : "var(--danger)"};font-weight:600;font-size:12px">${data.win ? "+" : "-"}${data.amount}</span>
  `
  feed.prepend(el)
  if (feed.children.length > 20) feed.lastChild.remove()
}

module.exports = { initGames, toggleBj }
