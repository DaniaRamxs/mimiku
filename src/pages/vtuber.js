// pages/vtuber.js — configuración de VTube Studio (ruletas de ítem y avatar)
const { ipcRenderer } = require("electron")

let vtsConfig = null

async function initVtuber() {
  vtsConfig = await ipcRenderer.invoke("vts:getConfig")
  const connected = await ipcRenderer.invoke("vts:isConnected")
  updateVtsStatus(connected)
  renderVtsConfig()
}

function updateVtsStatus(connected) {
  const badge = document.getElementById("vts-status")
  if (!badge) return
  badge.textContent = connected ? "Conectado" : "Desconectado"
  badge.className = "afk-status-badge" + (connected ? " active-green" : "")
}

async function connectVts() {
  showToast("Conectando… acepta el popup en VTube Studio")
  const res = await ipcRenderer.invoke("vts:connect")
  if (res.ok) {
    updateVtsStatus(true)
    showToast(res.already ? "Ya estaba conectado ✦" : "¡Conectado a VTube Studio! ✦")
  } else {
    showToast("No se pudo conectar: " + (res.error || "revisa que VTS esté abierto"))
  }
}

function renderVtsConfig() {
  if (!vtsConfig) return
  // ítems
  const itemPool = vtsConfig.itemRoulette?.pool || []
  const itemEl = document.getElementById("vts-item-pool")
  if (itemEl) {
    itemEl.innerHTML = itemPool.length ? itemPool.map((it, i) => `
      <div class="vts-pool-row">
        <input type="text" value="${(it.fileName||'').replace(/"/g,'&quot;')}" onchange="window.vtuberPage.updateItem(${i}, this.value)" placeholder="nombre_archivo.png">
        <button class="btn-icon-sm danger" onclick="window.vtuberPage.removeItem(${i})">✕</button>
      </div>`).join("") : `<p class="empty-small">Sin ítems. Agrega uno o descúbrelos desde VTS.</p>`
  }
  // duración del ítem
  const durEl = document.getElementById("vts-item-duration")
  if (durEl) durEl.value = Math.round((vtsConfig.itemRoulette?.durationMs || 30000) / 1000)

  // modelos
  const modelPool = vtsConfig.avatarRoulette?.pool || []
  const modelEl = document.getElementById("vts-model-pool")
  if (modelEl) {
    modelEl.innerHTML = modelPool.length ? modelPool.map((m, i) => `
      <div class="vts-pool-row">
        <input type="text" value="${(m.name||'').replace(/"/g,'&quot;')}" onchange="window.vtuberPage.updateModelName(${i}, this.value)" placeholder="Nombre visible" style="flex:1">
        <input type="text" value="${(m.modelID||'').replace(/"/g,'&quot;')}" onchange="window.vtuberPage.updateModelID(${i}, this.value)" placeholder="modelID" style="flex:2">
        <button class="btn-icon-sm danger" onclick="window.vtuberPage.removeModel(${i})">✕</button>
      </div>`).join("") : `<p class="empty-small">Sin modelos. Agrega uno o descúbrelos desde VTS.</p>`
  }
}

// ── Editar ítems ──
function addItem() {
  vtsConfig.itemRoulette.pool.push({ fileName: "" })
  renderVtsConfig()
}
function updateItem(i, val) { vtsConfig.itemRoulette.pool[i].fileName = val.trim() }
function removeItem(i) { vtsConfig.itemRoulette.pool.splice(i, 1); renderVtsConfig() }

// ── Editar modelos ──
function addModel() {
  vtsConfig.avatarRoulette.pool.push({ name: "", modelID: "" })
  renderVtsConfig()
}
function updateModelName(i, val) { vtsConfig.avatarRoulette.pool[i].name = val.trim() }
function updateModelID(i, val) { vtsConfig.avatarRoulette.pool[i].modelID = val.trim() }
function removeModel(i) { vtsConfig.avatarRoulette.pool.splice(i, 1); renderVtsConfig() }

async function saveVtsConfig() {
  const dur = parseInt(document.getElementById("vts-item-duration").value) || 30
  vtsConfig.itemRoulette.durationMs = dur * 1000
  await ipcRenderer.invoke("vts:saveConfig", vtsConfig)
  showToast("Configuración guardada ✦")
}

// ── Descubrir desde VTS ──
async function discoverModels() {
  try {
    const res = await ipcRenderer.invoke("vts:discoverModels")
    showToast(`Encontrados ${res.count} modelos. Revisa la lista abajo.`)
    // mostrar los modelos disponibles para copiar
    renderDiscovered("models", res.models || [])
  } catch (e) { showToast("Error: " + e.message) }
}

async function discoverItems() {
  try {
    const res = await ipcRenderer.invoke("vts:discoverItems")
    showToast(`Encontrados ${res.count} ítems. Revisa la lista abajo.`)
    renderDiscovered("items", res.files || [])
  } catch (e) { showToast("Error: " + e.message) }
}

function renderDiscovered(kind, list) {
  const el = document.getElementById("vts-discovered")
  if (!el) return
  if (!list.length) {
    el.innerHTML = `<p class="empty-small" style="margin-top:1rem">VTube Studio no tiene ${kind === "models" ? "modelos" : "ítems/accesorios"} cargados. Agrégalos primero dentro de VTube Studio.</p>`
    return
  }
  if (kind === "models") {
    el.innerHTML = `<p class="section-label" style="margin-top:1rem">MODELOS EN VTS (clic para agregar)</p>` +
      list.map(m => `<button class="vts-discovered-chip" onclick="window.vtuberPage.pickModel('${(m.modelID||'').replace(/'/g,'')}','${(m.modelName||'').replace(/'/g,'')}')">${m.modelName || m.modelID}</button>`).join("")
  } else {
    el.innerHTML = `<p class="section-label" style="margin-top:1rem">ÍTEMS EN VTS (clic para agregar)</p>` +
      list.map(f => `<button class="vts-discovered-chip" onclick="window.vtuberPage.pickItem('${(f.fileName||'').replace(/'/g,'')}')">${f.fileName}</button>`).join("")
  }
}

function pickModel(id, name) {
  vtsConfig.avatarRoulette.pool.push({ modelID: id, name: name || id })
  renderVtsConfig()
  showToast("Modelo agregado — recuerda Guardar")
}
function pickItem(fileName) {
  vtsConfig.itemRoulette.pool.push({ fileName })
  renderVtsConfig()
  showToast("Ítem agregado — recuerda Guardar")
}

// ── Probar ──
async function testItem() {
  try {
    const r = await ipcRenderer.invoke("vts:testItem")
    showToast("🎰 Ítem cargado: " + (r.fileName || "?"))
  } catch (e) {
    showToast("Error ítem: " + (e.message || e).replace("Error invoking remote method 'vts:testItem': ", ""))
  }
}
async function testAvatar() {
  try {
    const r = await ipcRenderer.invoke("vts:testAvatar")
    showToast("🎭 Avatar: " + (r.name || "?"))
  } catch (e) {
    showToast("Error avatar: " + (e.message || e).replace("Error invoking remote method 'vts:testAvatar': ", ""))
  }
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = {
  initVtuber, connectVts, saveVtsConfig,
  addItem, updateItem, removeItem,
  addModel, updateModelName, updateModelID, removeModel,
  discoverModels, discoverItems, pickModel, pickItem,
  testItem, testAvatar,
}
