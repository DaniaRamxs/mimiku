// pages/live-stream.js — Ajustes > "Directo en la página de canje" y "Predicciones".
// Las predicciones tambien se manejan desde el chat de Twitch (!prediccion,
// !op1...): cuando cambian por el chat, main avisa con "predictions:update".
const { ipcRenderer } = require("electron")

const STATUS_LABELS = { open: "Abierta: se puede apostar", locked: "Cerrada: elige la respuesta ganadora", resolved: "Terminada", cancelled: "Cancelada (puntos devueltos)" }

let current = null
let ticker = null

function el(id) { return document.getElementById(id) }
function fmt(value) { return Number(value || 0).toLocaleString("es") }
function toast(message) { if (window.showToast) window.showToast(message) }

// ── Directo en la pagina ────────────────────────────────────────────────────
async function refreshLiveConfig() {
  if (!el("live-watch-points")) return
  const config = await ipcRenderer.invoke("liveConfig:get")
  el("live-watch-points").value = config.watchPoints
  el("live-drops-enabled").checked = config.dropsEnabled
  el("live-drop-points").value = config.dropPoints
  el("live-drop-every").value = config.dropEveryMin
  el("live-drop-slots").value = config.dropSlots
  el("live-bonus").value = config.bonusPercent
}

async function saveLiveConfig() {
  try {
    await ipcRenderer.invoke("liveConfig:set", {
      watchPoints: Number(el("live-watch-points").value), dropsEnabled: el("live-drops-enabled").checked,
      dropPoints: Number(el("live-drop-points").value), dropEveryMin: Number(el("live-drop-every").value),
      dropSlots: Number(el("live-drop-slots").value), bonusPercent: Number(el("live-bonus").value),
    })
    toast("Ajustes del directo guardados")
    await refreshLiveConfig()
  } catch (error) {
    toast("No se pudo guardar: " + error.message)
  }
}

// ── Predicciones ────────────────────────────────────────────────────────────
function secondsLeft(prediction) {
  return Math.max(0, Math.ceil((Date.parse(prediction.locksAt) - Date.now()) / 1000))
}

function optionRow(prediction, option, index) {
  const row = document.createElement("div")
  row.className = "doctor-row"
  row.style.marginBottom = "6px"
  const share = prediction.pool ? Math.round((option.total / prediction.pool) * 100) : 0
  const text = document.createElement("span")
  const won = prediction.status === "resolved" && prediction.winner === index
  text.textContent = `${won ? "Ganadora · " : ""}!op${index + 1} ${option.label}: ${fmt(option.total)} pts (${share} %) · ${option.bettors} ${option.bettors === 1 ? "viewer" : "viewers"}`
  row.appendChild(text)
  if (prediction.status === "locked") {
    const button = document.createElement("button")
    button.className = "btn-ghost"
    button.style.cssText = "width:auto;padding:6px 12px"
    button.textContent = "Ganó esta"
    button.addEventListener("click", () => resolvePrediction(index))
    row.appendChild(button)
  }
  return row
}

function renderPrediction(summary) {
  current = summary.prediction
  const box = el("pred-current")
  if (!box) return
  box.textContent = ""
  clearInterval(ticker)
  const active = current && (current.status === "open" || current.status === "locked")
  el("pred-actions").hidden = !active
  el("pred-form").hidden = !!active
  if (!current) { box.textContent = "Todavía no has hecho ninguna predicción."; return }
  const head = document.createElement("p")
  head.className = "desc"
  head.style.margin = "0 0 8px"
  const status = document.createElement("strong")
  status.id = "pred-status"
  head.appendChild(document.createTextNode(`${current.question} · bote: ${fmt(current.pool)} pts · `))
  head.appendChild(status)
  box.appendChild(head)
  current.options.forEach((option, index) => box.appendChild(optionRow(current, option, index)))
  const paint = () => {
    status.textContent = current.status === "open" && secondsLeft(current) > 0 ? `${STATUS_LABELS.open} (${secondsLeft(current)} s)` : STATUS_LABELS[current.status === "open" ? "locked" : current.status]
  }
  paint()
  if (current.status === "open") ticker = setInterval(() => { paint(); if (!secondsLeft(current)) { clearInterval(ticker); refreshPredictions() } }, 1000)
}

async function refreshPredictions() {
  if (!el("pred-current")) return
  renderPrediction(await ipcRenderer.invoke("predictions:summary"))
}

async function run(channel, payload, done) {
  try {
    renderPrediction(await ipcRenderer.invoke(channel, payload))
    if (done) toast(done)
  } catch (error) {
    toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))
  }
}

function createPrediction() {
  const options = ["pred-op1", "pred-op2", "pred-op3", "pred-op4"].map(id => el(id).value.trim()).filter(Boolean)
  return run("predictions:create", { question: el("pred-question").value, options, seconds: Number(el("pred-seconds").value || 120) }, "Predicción creada")
    .then(() => { if (current && current.status === "open") ["pred-question", "pred-op1", "pred-op2", "pred-op3", "pred-op4"].forEach(id => { el(id).value = "" }) })
}

function lockPrediction() { return current && run("predictions:lock", current.id, "Apuestas cerradas") }
function resolvePrediction(index) {
  if (!current || !confirm(`¿Ganó "${current.options[index].label}"? Se reparten los puntos y no se puede deshacer.`)) return
  return run("predictions:resolve", { id: current.id, winner: index }, "Predicción resuelta")
}
function cancelPrediction() {
  if (!current || !confirm("¿Cancelar la predicción? Se devuelven todos los puntos apostados.")) return
  return run("predictions:cancel", current.id, "Predicción cancelada")
}

function refreshLiveStream() {
  return Promise.all([refreshLiveConfig(), refreshPredictions()])
}

// Cambios hechos desde el chat (!prediccion, !op1...).
ipcRenderer.on("predictions:update", () => { refreshPredictions().catch(error => console.error("[Predicciones]", error)) })

module.exports = { refreshLiveStream, saveLiveConfig, createPrediction, lockPrediction, cancelPrediction }
