// pages/roulette.js — seccion "Ruleta de cofres" dentro de Mimics.
const { ipcRenderer } = require("electron")

const MAX_SEGMENTS = 20

// Segmentos en edicion (se leen del DOM al guardar; esto solo dibuja filas).
let segments = []

async function loadRoulette() {
  if (!document.getElementById("roulette-enabled")) return
  const channel = localStorage.getItem("mimiku_channel")
  const [config, boxes] = await Promise.all([
    ipcRenderer.invoke("roulette:getConfig"),
    ipcRenderer.invoke("mimics:listBoxes", channel).catch(() => []),
  ])
  document.getElementById("roulette-enabled").checked = config.enabled
  document.getElementById("roulette-mode").value = config.mode
  document.getElementById("roulette-cooldown").value = String(config.cooldownSeconds)
  document.getElementById("roulette-sides").value = String(config.diceSides)

  const select = document.getElementById("roulette-box")
  select.replaceChildren()
  const none = document.createElement("option")
  none.value = ""
  none.textContent = boxes.length ? "Elige una caja" : "Crea primero una caja"
  select.append(none)
  for (const box of boxes) {
    const option = document.createElement("option")
    option.value = box.id
    option.textContent = box.name
    select.append(option)
  }
  select.value = config.boxId

  segments = config.segments.map(segment => ({ ...segment }))
  renderSegments()
  updateModeFields()
}

function updateModeFields() {
  const mode = document.getElementById("roulette-mode").value
  document.getElementById("roulette-dice-fields").style.display = mode === "dice" ? "" : "none"
  document.getElementById("roulette-segment-fields").style.display = mode === "segments" ? "" : "none"
}

// Lee los valores actuales de las filas para no perder lo escrito al redibujar.
function readSegmentsFromDom() {
  return [...document.querySelectorAll(".roulette-segment-row")].map(row => ({
    label: row.querySelector(".seg-label").value.trim(),
    chests: Number(row.querySelector(".seg-chests").value),
    weight: Number(row.querySelector(".seg-weight").value),
  }))
}

function renderSegments() {
  const list = document.getElementById("roulette-segments")
  list.replaceChildren()
  const total = segments.reduce((sum, segment) => sum + (Number(segment.weight) > 0 ? Number(segment.weight) : 0), 0)

  if (segments.length) {
    const head = document.createElement("div")
    head.className = "segment-head"
    for (const title of ["Nombre", "Cofres", "Peso", "Prob.", ""]) {
      const cell = document.createElement("span")
      cell.textContent = title
      head.append(cell)
    }
    list.append(head)
  }

  segments.forEach((segment, index) => {
    const row = document.createElement("div")
    row.className = "roulette-segment-row"

    const label = document.createElement("input")
    label.className = "seg-label"
    label.type = "text"
    label.maxLength = 40
    label.placeholder = "Nombre (ej. 3 cofres)"
    label.value = segment.label || ""

    const chests = document.createElement("input")
    chests.className = "seg-chests"
    chests.type = "number"
    chests.min = "1"
    chests.title = "Cofres que entrega"
    chests.value = String(segment.chests || 1)

    const weight = document.createElement("input")
    weight.className = "seg-weight"
    weight.type = "number"
    weight.min = "0.1"
    weight.step = "any"
    weight.title = "Peso: probabilidad relativa"
    weight.value = String(segment.weight || 1)
    weight.addEventListener("input", () => { segments = readSegmentsFromDom(); refreshOdds() })

    const odds = document.createElement("span")
    odds.className = "seg-odds field-hint"
    odds.textContent = total > 0 ? `${((Number(segment.weight) / total) * 100).toFixed(1)}%` : "-"

    const remove = document.createElement("button")
    remove.className = "btn-ghost"
    remove.textContent = "Quitar"
    remove.addEventListener("click", () => { segments = readSegmentsFromDom().filter((_, i) => i !== index); renderSegments() })

    row.append(label, chests, weight, odds, remove)
    list.append(row)
  })
}

// Actualiza solo los porcentajes mientras se escribe, sin redibujar los inputs.
function refreshOdds() {
  const weights = segments.map(segment => (Number(segment.weight) > 0 ? Number(segment.weight) : 0))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  document.querySelectorAll(".seg-odds").forEach((node, index) => {
    node.textContent = total > 0 ? `${((weights[index] / total) * 100).toFixed(1)}%` : "-"
  })
}

function addSegment() {
  segments = readSegmentsFromDom()
  if (segments.length >= MAX_SEGMENTS) { showToast(`Maximo ${MAX_SEGMENTS} segmentos`); return }
  segments.push({ label: "", chests: 1, weight: 1 })
  renderSegments()
}

async function saveRoulette() {
  const updates = {
    enabled: document.getElementById("roulette-enabled").checked,
    mode: document.getElementById("roulette-mode").value,
    boxId: document.getElementById("roulette-box").value,
    cooldownSeconds: Number(document.getElementById("roulette-cooldown").value) || 0,
    diceSides: Number(document.getElementById("roulette-sides").value) || 20,
    segments: readSegmentsFromDom(),
  }
  try {
    await ipcRenderer.invoke("roulette:setConfig", updates)
    showToast("Ruleta guardada")
  } catch (error) {
    // El mensaje del servicio ya esta en espanol y pensado para el streamer.
    showToast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))
    console.error("[roulette] roulette:setConfig:", error.message)
  }
  await loadRoulette()
}

async function previewRoulette() {
  try {
    await ipcRenderer.invoke("roulette:preview")
  } catch (error) {
    showToast("Guarda la ruleta antes de probarla")
    console.error("[roulette] roulette:preview:", error.message)
  }
}

function showToast(message) {
  const toast = document.getElementById("toast")
  if (!toast) return
  toast.textContent = message
  toast.classList.add("show")
  setTimeout(() => toast.classList.remove("show"), 3000)
}

module.exports = { loadRoulette, updateModeFields, addSegment, saveRoulette, previewRoulette }
