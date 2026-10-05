// pages/vtuber-reactions.js — Pestaña "Reacciones" de la página VTuber:
// lista de reacciones, editor de nodos (con los ajustes dentro de cada nodo),
// asistente y ajuste de la cabeza del modelo para el overlay /vtuber. Guarda
// solo (con un pequeño retraso) para que el overlay de OBS se actualice en vivo.
const { ipcRenderer } = require("electron")
const { buildWizardFlow } = require("../core/vtuber/reaction-presets.js")
const { createNodeEditor } = require("./vtuber/node-editor.js")
const { openWizard } = require("./vtuber/reaction-wizard.js")
const { openTemplateGallery } = require("./vtuber/template-gallery.js")
const { buildTemplateFlow } = require("../core/vtuber/reaction-templates.js")
const speech = require("./vtuber/speech.js")

const SAVE_DELAY_MS = 600
const STAGE_SAVE_DELAY_MS = 150
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const ADVANCED_KEY = "mimiku.reactions.advanced"

let config = null
let currentId = null
let editor = null
let saveTimer = null
let saving = Promise.resolve()
let hotkeys = []
let expressions = []
let bound = false
let loaded = false

const $ = id => document.getElementById(id)

function toast(message) {
  const t = $("toast")
  if (!t) return
  t.textContent = message
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function currentFlow() {
  return config?.flows.find(flow => flow.id === currentId) || null
}

function setSaveState(text) {
  const state = $("rx-save-state")
  if (state) state.textContent = text
}

// ── Guardado ────────────────────────────────────────────────────────────────
function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = null
  const snapshot = config
  setSaveState("Guardando...")
  saving = saving.then(() => ipcRenderer.invoke("reactions:save", snapshot)).then(() => {
    if (!saveTimer) setSaveState("Guardado")
  }, error => {
    setSaveState("Sin guardar")
    toast("No se pudo guardar: " + error.message)
  })
  return saving
}

function scheduleSave(delay = SAVE_DELAY_MS) {
  setSaveState("Cambios sin guardar")
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, delay)
}

function replaceFlow(next) {
  config = { ...config, flows: config.flows.map(flow => (flow.id === next.id ? next : flow)) }
  scheduleSave()
}

// ── Lista de reacciones ─────────────────────────────────────────────────────
function confirmButton(label, onConfirm) {
  const button = el("button", "btn-ghost rx-btn-sm", label)
  button.type = "button"
  let armed = false
  button.addEventListener("click", event => {
    event.stopPropagation()
    if (!armed) {
      armed = true
      button.textContent = "Confirmar"
      button.classList.add("rx-danger")
      setTimeout(() => { armed = false; button.textContent = label; button.classList.remove("rx-danger") }, 3000)
      return
    }
    onConfirm()
  })
  return button
}

function renderList() {
  const list = $("rx-flow-list")
  list.textContent = ""
  if (!config.flows.length) {
    list.appendChild(el("p", "rx-muted", "Todavía no hay reacciones."))
    return
  }
  for (const flow of config.flows) {
    const row = el("div", "rx-flow" + (flow.id === currentId ? " is-current" : "") + (flow.enabled ? "" : " is-off"))
    row.tabIndex = 0
    row.setAttribute("role", "button")
    row.setAttribute("aria-current", String(flow.id === currentId))
    row.addEventListener("click", () => selectFlow(flow.id))
    row.addEventListener("keydown", event => { if (event.key === "Enter") selectFlow(flow.id) })
    const info = el("div", "rx-flow-info")
    info.appendChild(el("strong", "", flow.name))
    info.appendChild(el("span", "", `${flow.nodes.length} nodos`))
    row.appendChild(info)
    const toggle = el("input", "rx-toggle")
    toggle.type = "checkbox"
    toggle.checked = flow.enabled
    toggle.title = flow.enabled ? "Activa" : "Apagada"
    toggle.setAttribute("aria-label", `Activar ${flow.name}`)
    toggle.addEventListener("click", event => event.stopPropagation())
    toggle.addEventListener("change", () => {
      config = { ...config, flows: config.flows.map(f => (f.id === flow.id ? { ...f, enabled: toggle.checked } : f)) }
      renderList()
      saveNow()
    })
    row.appendChild(toggle)
    row.appendChild(confirmButton("Borrar", () => deleteFlow(flow.id)))
    list.appendChild(row)
  }
}

function selectFlow(id) {
  currentId = id
  const flow = currentFlow()
  $("rx-empty").hidden = !!flow
  $("rx-editor-tools").hidden = !flow
  $("rx-hint").hidden = !flow
  $("rx-flow-name").value = flow?.name || ""
  editor.setFlow(flow)
  renderList()
}

function addFlow(flow) {
  config = { ...config, flows: [...config.flows, flow] }
  selectFlow(flow.id)
  saveNow()
}

function newId() {
  return `flow-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
}

function newBlankFlow() {
  addFlow({
    id: newId(), name: `Reacción ${config.flows.length + 1}`, enabled: true, links: [],
    nodes: [{ id: "n1", type: "on_follow", x: 60, y: 80, params: {} }],
  })
}

function deleteFlow(id) {
  config = { ...config, flows: config.flows.filter(flow => flow.id !== id) }
  if (currentId === id) selectFlow(config.flows[0]?.id || null)
  else renderList()
  saveNow()
}

// Sin nodeId: todo el flujo desde sus disparadores. Con nodeId: desde ese nodo.
async function testFlow(nodeId) {
  const flow = currentFlow()
  if (!flow) return
  await saveNow()
  try {
    await ipcRenderer.invoke("reactions:test", flow.id, nodeId)
    toast(nodeId ? "Probando desde este nodo con un viewer de ejemplo" : `Probando "${flow.name}" con un viewer de ejemplo`)
  } catch (error) {
    toast("Error al probar: " + error.message)
  }
}

function readAdvanced() {
  try { return localStorage.getItem(ADVANCED_KEY) === "1" } catch { return false }
}

function saveAdvanced(on) {
  try { localStorage.setItem(ADVANCED_KEY, on ? "1" : "0") } catch (error) {
    console.error("[ReaccionesVTuber] no se pudo recordar el modo avanzado:", error.message)
  }
}

// ── Archivos y listas de VTube Studio (los usan los controles de los nodos) ──
async function uploadAsset(accept) {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = accept || ""
  const file = await new Promise(resolve => {
    input.onchange = () => resolve(input.files[0] || null)
    input.click()
  })
  if (!file) return ""
  if (file.size > MAX_UPLOAD_BYTES) { toast("El archivo supera 50 MB"); return "" }
  try {
    const saved = await ipcRenderer.invoke("assets:save", {
      kind: "vtuber", name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    })
    toast("Archivo listo")
    return saved.url
  } catch (error) {
    toast("No se pudo guardar el archivo: " + error.message)
    return ""
  }
}

async function loadHotkeys() {
  try {
    hotkeys = await ipcRenderer.invoke("reactions:hotkeys")
    toast(hotkeys.length ? `${hotkeys.length} atajos encontrados en VTube Studio` : "El modelo no tiene atajos. Créalos en VTube Studio.")
  } catch (error) {
    toast("Conecta VTube Studio en la pestaña VTube Studio")
  }
  return hotkeys
}

async function loadExpressions() {
  try {
    expressions = await ipcRenderer.invoke("reactions:expressions")
    toast(expressions.length ? `${expressions.length} expresiones encontradas` : "El modelo no tiene expresiones. Créalas en VTube Studio.")
  } catch (error) {
    toast("Conecta VTube Studio en la pestaña VTube Studio")
  }
  return expressions
}


// ── Escena (cabeza del modelo en el overlay) ───────────────────────────────
const STAGE_FIELDS = [["rx-head-x", "headX"], ["rx-head-y", "headY"], ["rx-head-size", "headSize"]]

function renderStage() {
  for (const [id, key] of STAGE_FIELDS) {
    $(id).value = config.stage[key]
    $(`${id}-value`).textContent = `${config.stage[key]}%`
  }
  $("rx-show-target").checked = config.stage.showTarget
  $("rx-show-counter").checked = config.stage.showCounter
  $("rx-counter-corner").value = config.stage.counterCorner
  $("rx-show-top").checked = config.stage.showTopAttackers
  $("rx-head-meshes").value = config.stage.headMeshes
}

async function refreshHits(snapshot) {
  try {
    const hits = snapshot || await ipcRenderer.invoke("reactions:hits")
    $("rx-hits-summary").textContent = `Hoy: ${hits.today} golpes · Récord: ${hits.record} · Total: ${hits.total}`
  } catch (error) {
    console.error("[ReaccionesVTuber] no se pudo leer el contador:", error.message)
  }
}

function setStage(patch, delay = 0) {
  config = { ...config, stage: { ...config.stage, ...patch } }
  if (delay) scheduleSave(delay)
  else saveNow()
}

function bindStage() {
  for (const [id, key] of STAGE_FIELDS) {
    $(id).addEventListener("input", () => {
      config = { ...config, stage: { ...config.stage, [key]: Number($(id).value) } }
      $(`${id}-value`).textContent = `${config.stage[key]}%`
      scheduleSave(STAGE_SAVE_DELAY_MS)
    })
  }
  $("rx-show-target").addEventListener("change", () => {
    config = { ...config, stage: { ...config.stage, showTarget: $("rx-show-target").checked } }
    saveNow()
  })
  $("rx-show-counter").addEventListener("change", () => setStage({ showCounter: $("rx-show-counter").checked }))
  $("rx-counter-corner").addEventListener("change", () => setStage({ counterCorner: $("rx-counter-corner").value }))
  $("rx-show-top").addEventListener("change", () => setStage({ showTopAttackers: $("rx-show-top").checked }))
  $("rx-head-meshes").addEventListener("input", () => setStage({ headMeshes: $("rx-head-meshes").value }, SAVE_DELAY_MS))
  $("rx-reset-hits").addEventListener("click", async () => {
    try { await refreshHits(await ipcRenderer.invoke("reactions:resetHits")); toast("Contador de hoy a cero") } catch (error) { toast("No se pudo reiniciar: " + error.message) }
  })
  $("rx-clear-items").addEventListener("click", async () => {
    try { await ipcRenderer.invoke("reactions:clearItems"); toast("Se quitó todo lo que Mimiku pegó al modelo") } catch (error) { toast("No se pudo: " + error.message) }
  })
  // Al cerrar el ajuste, la diana se oculta en OBS.
  $("rx-stage").addEventListener("toggle", () => {
    if (!$("rx-stage").open && config.stage.showTarget) {
      config = { ...config, stage: { ...config.stage, showTarget: false } }
      renderStage()
      saveNow()
    }
  })
}

// ── Montaje ─────────────────────────────────────────────────────────────────
function showTab(name) {
  for (const button of document.querySelectorAll(".vt-tab-btn")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name))
  }
  $("vt-tab-reactions").hidden = name !== "reactions"
  $("vt-tab-studio").hidden = name !== "studio"
}

async function refreshObsUrl() {
  try {
    const status = await ipcRenderer.invoke("overlay:getStatus")
    if (status?.baseUrl) $("rx-obs-url").textContent = `${status.baseUrl}/vtuber`
  } catch (error) {
    console.error("[ReaccionesVTuber] no se pudo leer la URL del overlay:", error.message)
  }
}

function bindOnce() {
  const advanced = readAdvanced()
  $("rx-advanced").checked = advanced
  editor = createNodeEditor($("rx-canvas"), {
    onChange: next => { replaceFlow(next); renderList() },
    onTest: nodeId => testFlow(nodeId),
    advanced,
    helpers: {
      uploadAsset, loadHotkeys, cachedHotkeys: () => hotkeys, loadExpressions, cachedExpressions: () => expressions,
      listVoices: speech.listVoices,
    },
  })
  bindStage()
  $("rx-advanced").addEventListener("change", () => {
    saveAdvanced($("rx-advanced").checked)
    editor.setAdvanced($("rx-advanced").checked)
  })
  $("rx-flow-name").addEventListener("input", () => {
    const flow = currentFlow()
    const name = $("rx-flow-name").value.trim().slice(0, 60)
    if (!flow || !name) return
    replaceFlow({ ...flow, name })
    renderList()
  })
  $("rx-zoom-in").addEventListener("click", () => editor.zoomBy(1.2))
  $("rx-zoom-out").addEventListener("click", () => editor.zoomBy(1 / 1.2))
  $("rx-fit").addEventListener("click", () => editor.fit())
  $("rx-arrange").addEventListener("click", () => editor.arrange())
  for (const button of document.querySelectorAll(".vt-tab-btn")) {
    button.addEventListener("click", () => showTab(button.dataset.tab))
  }
  $("rx-add-node").addEventListener("click", () => editor.openAddMenu())
  $("rx-test").addEventListener("click", () => testFlow())
  $("rx-new-blank").addEventListener("click", newBlankFlow)
  $("rx-empty-blank").addEventListener("click", newBlankFlow)
  const wizard = () => openWizard({ onCreate: answers => addFlow(buildWizardFlow({ ...answers, id: newId() })) })
  $("rx-new-wizard").addEventListener("click", wizard)
  const gallery = () => openTemplateGallery({ onPick: templateId => addFlow(buildTemplateFlow(templateId, newId())) })
  $("rx-templates").addEventListener("click", gallery)
  $("rx-empty-templates").addEventListener("click", gallery)
  $("rx-empty-wizard").addEventListener("click", wizard)
  $("rx-copy-url").addEventListener("click", () => {
    navigator.clipboard.writeText($("rx-obs-url").textContent).then(() => toast("URL copiada"), () => toast("No se pudo copiar"))
  })
  // Las voces de Windows llegan tarde la primera vez.
  if (typeof speechSynthesis !== "undefined") speechSynthesis.addEventListener("voiceschanged", () => editor.replaceFlow(currentFlow()))
}

async function initReactions() {
  if (!bound) { bound = true; bindOnce() }
  refreshObsUrl()
  refreshHits()
  if (loaded) return
  try {
    config = await ipcRenderer.invoke("reactions:get")
  } catch (error) {
    toast("No se pudieron cargar las reacciones: " + error.message)
    return
  }
  loaded = true
  renderStage()
  selectFlow(config.flows[0]?.id || null)
  setSaveState("")
}

module.exports = { initReactions, initSpeech: speech.initSpeech, showTab }
