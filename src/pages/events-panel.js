// pages/events-panel.js — Panel de Eventos
const { ipcRenderer } = require("electron")

let evStatus = {}

async function initEvents() {
  await refreshStatus()
  setInterval(refreshStatus, 3000)
}

async function refreshStatus() {
  try {
    evStatus = await ipcRenderer.invoke("events:getStatus")
    updateStatusUI()
  } catch {}
}

function updateStatusUI() {
  setEventBadge("ev-mult-badge",   evStatus.multiplier > 1, evStatus.multiplier > 1 ? `x${evStatus.multiplier} ACTIVO` : "Inactivo")
  setEventBadge("ev-eco-badge",    evStatus.economyFrozen,  "CONGELADO", "Normal")
  setEventBadge("ev-bets-badge",   evStatus.betsFrozen,     "CONGELADO", "Normal")
  setEventBadge("ev-shield-badge", evStatus.shieldActive,   "ACTIVO",    "Inactivo")

  const bossBadge = document.getElementById("ev-boss-badge")
  const bossBar   = document.getElementById("ev-boss-bar")
  if (bossBadge) {
    if (evStatus.bossActive) {
      bossBadge.textContent = `HP: ${evStatus.bossActive.hp}/${evStatus.bossActive.maxHp}`
      bossBadge.className   = "event-badge active danger"
      if (bossBar) {
        bossBar.style.display = "block"
        bossBar.querySelector(".event-progress-fill").style.width =
          Math.round((evStatus.bossActive.hp / evStatus.bossActive.maxHp) * 100) + "%"
      }
    } else {
      bossBadge.textContent = "Sin boss"
      bossBadge.className   = "event-badge"
      if (bossBar) bossBar.style.display = "none"
    }
  }

  const lotBadge = document.getElementById("ev-lottery-badge")
  if (lotBadge) {
    if (evStatus.lotteryActive) {
      lotBadge.textContent = `${evStatus.lotteryActive.tickets} boletos`
      lotBadge.className   = "event-badge active"
    } else {
      lotBadge.textContent = "Inactiva"
      lotBadge.className   = "event-badge"
    }
  }
}

function setEventBadge(id, active, activeText, inactiveText = "Inactivo") {
  const el = document.getElementById(id)
  if (!el) return
  el.textContent = active ? activeText : inactiveText
  el.className   = active ? "event-badge active" : "event-badge"
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

async function rainPoints() {
  const amount = parseInt(document.getElementById("ev-rain-amount")?.value) || 100
  await ipcRenderer.invoke("events:rainPoints", amount)
  showToast(`🎉 ¡Lluvia de ${amount} pts activada!`)
  await refreshStatus()
}

async function gift500() {
  await ipcRenderer.invoke("events:gift500")
  showToast("💸 ¡500 pts para todos!")
  await refreshStatus()
}

async function activateMultiplier() {
  const value = parseInt(document.getElementById("ev-mult-value")?.value) || 2
  const mins  = parseInt(document.getElementById("ev-mult-mins")?.value)  || 5
  await ipcRenderer.invoke("events:multiplier", { value, mins })
  showToast(`🔥 Multiplicador x${value} por ${mins} min!`)
  await refreshStatus()
}

async function activateEqualizer() {
  await ipcRenderer.invoke("events:equalizer", 5)
  showToast("🧲 ¡Equilibrador activado!")
  await refreshStatus()
}

async function freezeEconomy() {
  await ipcRenderer.invoke("events:freezeEco", 5)
  showToast("🛑 Economía congelada 5 min")
  await refreshStatus()
}

async function freezeBets() {
  await ipcRenderer.invoke("events:freezeBets", 5)
  showToast("❄ Apuestas congeladas 5 min")
  await refreshStatus()
}

async function activateShield() {
  await ipcRenderer.invoke("events:shield", 5)
  showToast("🛡 Escudo activado 5 min")
  await refreshStatus()
}

async function spawnBoss() {
  const hp = parseInt(document.getElementById("ev-boss-hp")?.value) || 5000
  await ipcRenderer.invoke("events:spawnBoss", hp)
  showToast("👾 ¡Boss invocado!")
  await refreshStatus()
}

async function startLottery() {
  const price = parseInt(document.getElementById("ev-lottery-price")?.value) || 100
  await ipcRenderer.invoke("events:startLottery", price)
  showToast("🎟 ¡Lotería iniciada!")
  await refreshStatus()
}

async function drawLottery() {
  const result = await ipcRenderer.invoke("events:drawLottery")
  if (result?.error) { showToast(result.error); return }
  showToast(`🎟 Ganador: @${result.winner} — ${result.prize} pts!`)
  await refreshStatus()
}

async function randomEvent() {
  await ipcRenderer.invoke("events:random")
  showToast("🌟 ¡Evento aleatorio activado!")
  await refreshStatus()
}

async function collectTax() {
  const percent = parseInt(document.getElementById("ev-tax-percent")?.value) || 10
  const result = await ipcRenderer.invoke("events:tax", percent)
  if (result?.error) { showToast(result.error); return }
  showToast(`🏛 ¡Impuesto del ${percent}% cobrado! ${result.totalCollected} pts recaudados`)
  await refreshStatus()
}

async function chaosMode() {
  await ipcRenderer.invoke("events:chaos")
  showToast("🎭 ¡MODO CAOS!")
  await refreshStatus()
}

module.exports = {
  initEvents,
  rainPoints, gift500, activateMultiplier, activateEqualizer,
  collectTax,
  freezeEconomy, freezeBets, activateShield,
  spawnBoss, startLottery, drawLottery,
  randomEvent, chaosMode,
}
