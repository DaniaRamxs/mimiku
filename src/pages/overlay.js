// pages/overlay.js
const { ipcRenderer } = require("electron")

async function initOverlay() {
  const label = document.getElementById("overlay-url-label")
  if (label) label.textContent = await overlayUrl()
}

async function overlayUrl() {
  const status = await ipcRenderer.invoke("overlay:getStatus")
  return `${status.baseUrl}/overlay`
}

async function copyUrl() {
  navigator.clipboard.writeText(await overlayUrl())
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

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 2500)
}

module.exports = { initOverlay, copyUrl, sendTestAlert, updateTicker }
