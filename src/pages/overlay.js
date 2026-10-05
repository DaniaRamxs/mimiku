// pages/overlay.js
const { ipcRenderer } = require("electron")

async function initOverlay() {
  const label = document.getElementById("overlay-url-label")
  if (label) label.textContent = await overlayUrl()
  const label2 = document.getElementById("overlay2-url-label")
  if (label2) label2.textContent = `${await overlayUrl()}2`
  const label3 = document.getElementById("overlay3-url-label")
  if (label3) label3.textContent = `${await overlayUrl()}3`
}

async function overlayUrl() {
  const status = await ipcRenderer.invoke("overlay:getStatus")
  return `${status.baseUrl}/overlay`
}

async function copyUrl() {
  navigator.clipboard.writeText(await overlayUrl())
  showToast("URL copiada al portapapeles")
}

async function copyUrl2() {
  navigator.clipboard.writeText(`${await overlayUrl()}2`)
  showToast("URL del Overlay 2 copiada")
}

async function copyUrl3() {
  navigator.clipboard.writeText(`${await overlayUrl()}3`)
  showToast("URL del Overlay 3 copiada")
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

module.exports = { initOverlay, copyUrl, copyUrl2, copyUrl3, sendTestAlert, updateTicker }
