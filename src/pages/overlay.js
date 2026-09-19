// pages/overlay.js
const { ipcRenderer } = require("electron")

let kingVisible = false

function initOverlay() {}

function copyUrl() {
  navigator.clipboard.writeText("http://127.0.0.1:7777/overlay")
  showToast("URL copiada al portapapeles")
}

async function sendTestAlert() {
  await ipcRenderer.invoke("overlay:send", {
    type: "alert",
    text: "✦ Mimiku Overlay Test ✦",
    duration: 4000,
  })
  showToast("Alerta enviada al overlay")
}

async function updateTicker() {
  const text = document.getElementById("ticker-text").value.trim()
  if (!text) return
  await ipcRenderer.invoke("overlay:send", { type: "ticker", text })
  showToast("Ticker actualizado")
}

async function toggleKing() {
  kingVisible = !kingVisible
  await ipcRenderer.invoke("king:toggle", kingVisible)
  const btn   = document.getElementById("btn-king-toggle")
  const badge = document.getElementById("king-badge-status")
  if (btn)   btn.textContent = kingVisible ? "👁 Ocultar del overlay" : "👁 Mostrar en overlay"
  if (badge) {
    badge.textContent = kingVisible ? "Activo" : "Oculto"
    badge.className   = kingVisible ? "game-badge active" : "game-badge"
  }
  showToast(kingVisible ? "👑 Rey del Chat activado" : "👑 Rey del Chat oculto")
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 2500)
}

module.exports = { initOverlay, copyUrl, sendTestAlert, updateTicker, toggleKing }
