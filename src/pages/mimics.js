// pages/mimics.js — Editor de Mimics con secuencia de bloques
const { ipcRenderer } = require("electron")
const { escapeHtml, inlineJson, safeColor } = require("../core/html.js")

let currentSequence = []   // bloques del Mimic en edición
let editingMimicId  = null

const BLOCK_TYPES = {
  image:        { icon: "🎞", label: "GIF / Imagen", color: "#3b82f6" },
  video:        { icon: "🎬", label: "Video",        color: "#ef4444" },
  sound:        { icon: "🔊", label: "Sonido",       color: "#a855f7" },
  message:      { icon: "💬", label: "Mensaje",      color: "#22c55e" },
  effect:       { icon: "✨", label: "Efecto",       color: "#f59e0b" },
  emoji_rain:   { icon: "🌧", label: "Lluvia emoji", color: "#06b6d4" },
  shake:        { icon: "📳", label: "Sacudir",      color: "#f97316" },
  flash:        { icon: "⚡", label: "Flash",        color: "#eab308" },
  rain_points:  { icon: "💰", label: "Lluvia puntos",color: "#10b981" },
  mini_challenge:{ icon: "🎯", label: "Mini-reto",   color: "#8b5cf6" },
  streamer_challenge:{ icon: "🏆", label: "Reto streamer", color: "#6366f1" },
  economy_event:{ icon: "📊", label: "Evento economía", color: "#0ea5e9" },
  vts_item:     { icon: "🎰", label: "Ruleta ítem VTS", color: "#e11d48" },
  vts_avatar:   { icon: "🎭", label: "Ruleta avatar VTS", color: "#c026d3" },
  subathon_time:{ icon: "±", label: "Tiempo subathon", color: "#7c3aed" },
  xp:           { icon: "⭐", label: "XP",           color: "#ec4899" },
  points:      { icon: "🪙", label: "Puntos",       color: "#14b8a6" },
  wait:         { icon: "⏱", label: "Esperar",      color: "#64748b" },
}
const RARITY_CLASSES = new Set(["comun", "raro", "epico", "legendario", "evento"])

function initMimics() {
  loadMimics()
  loadBoxes()
}

// ── Cargar Mimics ───────────────────────────────────────────────────────────
async function loadMimics() {
  const ch = localStorage.getItem("mimiku_channel")
  if (!ch) return
  const mimics = await ipcRenderer.invoke("mimics:list", ch)
  const grid = document.getElementById("mimics-grid")
  if (!grid) return
  if (!mimics.length) { grid.innerHTML = `<p class="empty">No hay Mimics aún. ¡Crea el primero!</p>`; return }
  grid.innerHTML = mimics.map(m => `
    <div class="mimic-card ${RARITY_CLASSES.has(m.rarity) ? m.rarity : "comun"}">
      <div class="mimic-card-icon">${escapeHtml(m.icon)}</div>
      <div class="mimic-card-body">
        <div class="mimic-card-name">${escapeHtml(m.name)}</div>
        <div class="mimic-card-rarity">${escapeHtml(rarityLabel(m.rarity))}</div>
        <div class="mimic-card-seq">${(m.sequence||[]).length} acciones</div>
      </div>
      <div class="mimic-card-actions">
        <button class="btn-icon" onclick="window.mimicsPage.editMimic(${inlineJson(m.id)})" title="Editar">✏</button>
        <button class="btn-icon danger" onclick="window.mimicsPage.removeMimic(${inlineJson(m.id)})" title="Eliminar">🗑</button>
      </div>
    </div>`).join("")
}

function rarityLabel(r) {
  const map = { comun:"Común", raro:"Raro", epico:"Épico", legendario:"Legendario", evento:"Evento" }
  return map[r] || r
}

// ── Editor de secuencia ─────────────────────────────────────────────────────
function openMimicEditor(mimic) {
  editingMimicId  = mimic?.id || null
  currentSequence = mimic?.sequence ? JSON.parse(JSON.stringify(mimic.sequence)) : []
  document.getElementById("mimic-editor-modal").style.display = "flex"
  document.getElementById("mimic-name").value        = mimic?.name || ""
  document.getElementById("mimic-desc").value        = mimic?.description || ""
  document.getElementById("mimic-icon").value        = mimic?.icon || "✨"
  document.getElementById("mimic-rarity").value      = mimic?.rarity || "comun"
  document.getElementById("mimic-cooldown").value    = mimic?.cooldown_s || 30
  document.getElementById("mimic-editor-title").textContent = mimic ? "Editar Mimic" : "Nuevo Mimic"
  renderSequence()
}

function closeMimicEditor() {
  document.getElementById("mimic-editor-modal").style.display = "none"
  currentSequence = []
  editingMimicId  = null
}

function addBlock(type) {
  const defaults = {
    image:        { type:"image",   url:"",        duration:3000 },
    video:        { type:"video",   url:"",        duration:5000, volume:0.8 },
    sound:        { type:"sound",   url:"",        volume:0.8 },
    message:      { type:"message", text:"¡{user} activó esto!", duration:4000 },
    effect:       { type:"effect",  effect:"confetti", duration:5000 },
    emoji_rain:   { type:"emoji_rain", emoji:"🔥", duration:5000 },
    shake:        { type:"shake",   intensity:"medium", duration:800 },
    flash:        { type:"flash",   color:"#ffffff", duration:400 },
    rain_points:  { type:"rain_points", amount:50 },
    mini_challenge:{ type:"mini_challenge", word:"🔥", seconds:30, reward:100 },
    streamer_challenge:{ type:"streamer_challenge", text:"¡Haz 10 flexiones!", seconds:30 },
    economy_event:{ type:"economy_event", event:"rain", amount:100, duration_min:5, percent:10 },
    vts_item:     { type:"vts_item" },
    vts_avatar:   { type:"vts_avatar" },
    subathon_time:{ type:"subathon_time", mode:"remove", min:10, max:30 },
    xp:          { type:"xp",      amount:50 },
    points:       { type:"points",  amount:50 },
    wait:         { type:"wait",    ms:2000 },
  }
  currentSequence.push(defaults[type])
  renderSequence()
}

function removeBlock(index) {
  currentSequence.splice(index, 1)
  renderSequence()
}

function moveBlock(index, dir) {
  const newIndex = index + dir
  if (newIndex < 0 || newIndex >= currentSequence.length) return
  const tmp = currentSequence[index]
  currentSequence[index] = currentSequence[newIndex]
  currentSequence[newIndex] = tmp
  renderSequence()
}

function updateBlockField(index, field, value) {
  if (["duration","ms","amount","seconds","reward","min","max"].includes(field)) value = parseInt(value) || 0
  if (field === "volume") value = parseFloat(value) || 0
  currentSequence[index][field] = value
}

// ── Guardar asset en el almacenamiento local de Mimiku ─────────────────────
async function uploadBlockFile(index, file) {
  if (!file) return
  const maxMB = 50
  if (file.size > maxMB * 1024 * 1024) { showToast("El archivo supera " + maxMB + "MB"); return }

  showToast("Guardando archivo…")
  let saved
  try {
    saved = await ipcRenderer.invoke("assets:save", {
      kind: "mimic", name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
    })
  } catch (error) { showToast("Error al guardar: " + error.message); return }
  currentSequence[index].url = `${(await ipcRenderer.invoke("overlay:getStatus")).baseUrl}${saved.url}`
  renderSequence()
  showToast("Archivo guardado localmente ✦")
}

function pickBlockFile(index, accept) {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = accept
  input.onchange = () => { if (input.files[0]) uploadBlockFile(index, input.files[0]) }
  input.click()
}

// ── Probar un bloque individual en el overlay ───────────────────────────────
function testBlock(index) {
  const block = currentSequence[index]
  if (!block) return
  ipcRenderer.invoke("mimics:testBlock", block)
  showToast("Probando en overlay…")
}

function renderSequence() {
  const el = document.getElementById("sequence-list")
  if (!el) return
  if (!currentSequence.length) {
    el.innerHTML = `<p class="empty-small">Agrega bloques para construir la secuencia →</p>`
    return
  }
  el.innerHTML = currentSequence.map((block, i) => {
    const meta = BLOCK_TYPES[block.type] || { icon:"📦", label:block.type, color:"#666" }
    let fields = ""
    if (block.type === "image") {
      fields = `
        <div class="block-url-row">
          <input type="url" placeholder="URL del GIF/imagen" value="${escapeHtml(block.url)}" onchange="window.mimicsPage.updateBlockField(${i},'url',this.value)">
          <button class="block-upload-btn" onclick="window.mimicsPage.pickBlockFile(${i},'image/*')">📁</button>
        </div>
        <label class="block-inline">Duración (ms): <input type="number" value="${block.duration}" onchange="window.mimicsPage.updateBlockField(${i},'duration',this.value)"></label>`
    } else if (block.type === "video") {
      fields = `
        <div class="block-url-row">
          <input type="url" placeholder="URL del video (mp4)" value="${escapeHtml(block.url)}" onchange="window.mimicsPage.updateBlockField(${i},'url',this.value)">
          <button class="block-upload-btn" onclick="window.mimicsPage.pickBlockFile(${i},'video/*')">📁</button>
        </div>
        <label class="block-inline">Duración (ms): <input type="number" value="${block.duration}" onchange="window.mimicsPage.updateBlockField(${i},'duration',this.value)"></label>
        <label class="block-inline">Volumen: <input type="number" step="0.1" min="0" max="1" value="${block.volume}" onchange="window.mimicsPage.updateBlockField(${i},'volume',this.value)"></label>`
    } else if (block.type === "sound") {
      fields = `
        <div class="block-url-row">
          <input type="url" placeholder="URL del sonido (mp3)" value="${escapeHtml(block.url)}" onchange="window.mimicsPage.updateBlockField(${i},'url',this.value)">
          <button class="block-upload-btn" onclick="window.mimicsPage.pickBlockFile(${i},'audio/*')">📁</button>
        </div>
        <label class="block-inline">Volumen: <input type="number" step="0.1" min="0" max="1" value="${block.volume}" onchange="window.mimicsPage.updateBlockField(${i},'volume',this.value)"></label>`
    } else if (block.type === "message") {
      fields = `
        <input type="text" placeholder="Texto (usa {user} para el nombre)" value="${escapeHtml(block.text)}" onchange="window.mimicsPage.updateBlockField(${i},'text',this.value)">
        <label class="block-inline">Duración (ms): <input type="number" value="${block.duration}" onchange="window.mimicsPage.updateBlockField(${i},'duration',this.value)"></label>`
    } else if (block.type === "effect") {
      fields = `
        <select onchange="window.mimicsPage.updateBlockField(${i},'effect',this.value)">
          <option value="confetti" ${block.effect==="confetti"?"selected":""}>🎉 Confeti</option>
          <option value="rainbow" ${block.effect==="rainbow"?"selected":""}>🌈 Arcoíris</option>
        </select>`
    } else if (block.type === "emoji_rain") {
      fields = `
        <label class="block-inline">Emoji: <input type="text" maxlength="4" value="${escapeHtml(block.emoji || "🔥")}" onchange="window.mimicsPage.updateBlockField(${i},'emoji',this.value)" style="width:60px"></label>
        <label class="block-inline">Duración (ms): <input type="number" value="${block.duration}" onchange="window.mimicsPage.updateBlockField(${i},'duration',this.value)"></label>`
    } else if (block.type === "shake") {
      fields = `
        <select onchange="window.mimicsPage.updateBlockField(${i},'intensity',this.value)">
          <option value="light" ${block.intensity==="light"?"selected":""}>Suave</option>
          <option value="medium" ${block.intensity==="medium"?"selected":""}>Medio</option>
          <option value="strong" ${block.intensity==="strong"?"selected":""}>Fuerte</option>
        </select>
        <label class="block-inline">Duración (ms): <input type="number" value="${block.duration}" onchange="window.mimicsPage.updateBlockField(${i},'duration',this.value)"></label>`
    } else if (block.type === "flash") {
      fields = `
        <label class="block-inline">Color: <input type="color" value="${safeColor(block.color, "#ffffff")}" onchange="window.mimicsPage.updateBlockField(${i},'color',this.value)"></label>
        <label class="block-inline">Duración (ms): <input type="number" value="${block.duration}" onchange="window.mimicsPage.updateBlockField(${i},'duration',this.value)"></label>`
    } else if (block.type === "rain_points") {
      fields = `<label class="block-inline">Puntos a cada viewer activo: <input type="number" value="${block.amount}" onchange="window.mimicsPage.updateBlockField(${i},'amount',this.value)"></label>`
    } else if (block.type === "mini_challenge") {
      fields = `
        <label class="block-inline">Palabra/emoji: <input type="text" value="${escapeHtml(block.word || "🔥")}" onchange="window.mimicsPage.updateBlockField(${i},'word',this.value)" style="width:80px"></label>
        <label class="block-inline">Segundos: <input type="number" value="${block.seconds}" onchange="window.mimicsPage.updateBlockField(${i},'seconds',this.value)"></label>
        <label class="block-inline">Recompensa: <input type="number" value="${block.reward}" onchange="window.mimicsPage.updateBlockField(${i},'reward',this.value)"></label>`
    } else if (block.type === "streamer_challenge") {
      fields = `
        <input type="text" placeholder="El reto (ej: ¡Haz 10 flexiones!)" value="${escapeHtml(block.text)}" onchange="window.mimicsPage.updateBlockField(${i},'text',this.value)">
        <label class="block-inline">Cuenta regresiva (seg): <input type="number" value="${block.seconds}" onchange="window.mimicsPage.updateBlockField(${i},'seconds',this.value)"></label>`
    } else if (block.type === "economy_event") {
      fields = `
        <select onchange="window.mimicsPage.updateBlockField(${i},'event',this.value)">
          <option value="rain" ${block.event==="rain"?"selected":""}>💰 Lluvia de puntos</option>
          <option value="double" ${block.event==="double"?"selected":""}>✖️ Multiplicador x2</option>
          <option value="triple" ${block.event==="triple"?"selected":""}>✖️ Multiplicador x3</option>
          <option value="gift" ${block.event==="gift"?"selected":""}>🎁 Regalo 500 a todos</option>
          <option value="tax" ${block.event==="tax"?"selected":""}>🏦 Impuesto %</option>
        </select>
        <label class="block-inline">Cantidad/min/%: <input type="number" value="${block.amount}" onchange="window.mimicsPage.updateBlockField(${i},'amount',this.value)"></label>`
    } else if (block.type === "vts_item") {
      fields = `<span class="block-note">🎰 Pone un accesorio aleatorio sobre tu VTuber (temporal). Configura el pool en la página VTuber.</span>`
    } else if (block.type === "vts_avatar") {
      fields = `<span class="block-note">🎭 Cambia tu modelo VTuber completo al azar. Configura los modelos en la página VTuber.</span>`
    } else if (block.type === "subathon_time") {
      fields = `
        <select onchange="window.mimicsPage.updateBlockField(${i},'mode',this.value)">
          <option value="remove" ${block.mode!=="add"?"selected":""}>Quitar tiempo</option>
          <option value="add" ${block.mode==="add"?"selected":""}>Sumar tiempo</option>
        </select>
        <label class="block-inline">Min (minutos): <input type="number" min="0" value="${block.min}" onchange="window.mimicsPage.updateBlockField(${i},'min',this.value)"></label>
        <label class="block-inline">Max (minutos): <input type="number" min="0" value="${block.max}" onchange="window.mimicsPage.updateBlockField(${i},'max',this.value)"></label>
        <span class="block-note">Minutos al azar entre min y max. Solo con el subathon en marcha o en pausa; nunca baja de 1 minuto.</span>`
    } else if (block.type === "xp") {
      fields = `<label class="block-inline">Cantidad: <input type="number" value="${block.amount}" onchange="window.mimicsPage.updateBlockField(${i},'amount',this.value)"></label>`
    } else if (block.type === "points") {
      fields = `<label class="block-inline">Puntos a quien activa: <input type="number" value="${block.amount}" onchange="window.mimicsPage.updateBlockField(${i},'amount',this.value)"></label>`
    } else if (block.type === "wait") {
      fields = `<label class="block-inline">Esperar (ms): <input type="number" value="${block.ms}" onchange="window.mimicsPage.updateBlockField(${i},'ms',this.value)"></label>`
    }
    return `
      <div class="seq-block" style="border-left:3px solid ${safeColor(meta.color, "#666666")}">
        <div class="seq-block-header">
          <span class="seq-block-num">${i+1}</span>
          <span class="seq-block-icon">${escapeHtml(meta.icon)}</span>
          <span class="seq-block-label">${escapeHtml(meta.label)}</span>
          <div class="seq-block-controls">
            <button class="btn-icon-sm test" onclick="window.mimicsPage.testBlock(${i})" title="Probar">▶</button>
            <button class="btn-icon-sm" onclick="window.mimicsPage.moveBlock(${i},-1)" ${i===0?"disabled":""}>↑</button>
            <button class="btn-icon-sm" onclick="window.mimicsPage.moveBlock(${i},1)" ${i===currentSequence.length-1?"disabled":""}>↓</button>
            <button class="btn-icon-sm danger" onclick="window.mimicsPage.removeBlock(${i})">✕</button>
          </div>
        </div>
        <div class="seq-block-fields">${fields}</div>
      </div>`
  }).join("")
}

async function saveMimic() {
  const name = document.getElementById("mimic-name").value.trim()
  if (!name) { showToast("Ponle un nombre al Mimic"); return }
  if (!currentSequence.length) { showToast("Agrega al menos un bloque"); return }

  const ch = localStorage.getItem("mimiku_channel")
  const mimic = {
    name,
    description: document.getElementById("mimic-desc").value.trim(),
    icon:        document.getElementById("mimic-icon").value.trim() || "✨",
    rarity:      document.getElementById("mimic-rarity").value,
    cooldown_s:  parseInt(document.getElementById("mimic-cooldown").value) || 30,
    sequence:    currentSequence,
    is_event:    document.getElementById("mimic-rarity").value === "evento",
  }

  try {
    if (editingMimicId) {
      await ipcRenderer.invoke("mimics:update", { id: editingMimicId, u: mimic })
      showToast("Mimic actualizado ✦")
    } else {
      await ipcRenderer.invoke("mimics:create", { ch, m: mimic })
      showToast("Mimic creado ✦")
    }
    closeMimicEditor()
    loadMimics()
  } catch (e) {
    showToast("Error: " + e.message)
  }
}

async function editMimic(id) {
  const ch = localStorage.getItem("mimiku_channel")
  const mimics = await ipcRenderer.invoke("mimics:list", ch)
  const mimic = mimics.find(m => m.id === id)
  if (mimic) openMimicEditor(mimic)
}

async function removeMimic(id) {
  try {
    const removed = await ipcRenderer.invoke("mimics:delete", id)
    showToast(removed === false ? "Ese Mimic ya no existía" : "Mimic eliminado")
  } catch (error) {
    console.error("[Mimics] no se pudo eliminar:", error.message)
    showToast("No se pudo eliminar el Mimic: " + error.message.replace(/^Error invoking remote method '[^']+': /, ""))
  }
  loadMimics()
}

// ── Cajas ───────────────────────────────────────────────────────────────────
async function loadBoxes() {
  const ch = localStorage.getItem("mimiku_channel")
  if (!ch) return
  const boxes = await ipcRenderer.invoke("mimics:listBoxes", ch)
  const grid = document.getElementById("boxes-grid")
  if (!grid) return
  if (!boxes.length) { grid.innerHTML = `<p class="empty">No hay cajas aún.</p>`; return }
  grid.innerHTML = boxes.map(b => `
    <div class="box-card">
      <div class="box-card-icon">${escapeHtml(b.icon)}</div>
      <div class="box-card-name">${escapeHtml(b.name)}</div>
      <div class="box-card-desc">${escapeHtml(b.description)}</div>
      <div class="box-card-price">${b.price_points ? Number(b.price_points) + " pts" : ""}${b.price_real ? " $" + Number(b.price_real) : ""}</div>
      <div class="box-card-count">${Number(b.mimic_count) || 0} Mimics por caja</div>
      <button class="btn-icon danger" onclick="window.mimicsPage.removeBox(${inlineJson(b.id)})" style="margin-top:8px">🗑 Eliminar</button>
    </div>`).join("")
}

function openBoxEditor() {
  document.getElementById("box-editor-modal").style.display = "flex"
  document.getElementById("box-name").value     = ""
  document.getElementById("box-desc").value     = ""
  document.getElementById("box-icon").value     = "🎁"
  document.getElementById("box-price").value    = 500
  document.getElementById("box-count").value    = 3
  // odds por defecto
  setOdds({ comun: 60, raro: 25, epico: 12, legendario: 3 })
  refreshBoxRarityInfo()
}

// ── Probabilidades (loot table) ─────────────────────────────────────────────
function setOdds(odds) {
  document.getElementById("odds-comun").value      = odds.comun
  document.getElementById("odds-raro").value       = odds.raro
  document.getElementById("odds-epico").value      = odds.epico
  document.getElementById("odds-legendario").value = odds.legendario
  updateOddsTotal()
}

function getOdds() {
  return {
    comun:      parseInt(document.getElementById("odds-comun").value) || 0,
    raro:       parseInt(document.getElementById("odds-raro").value) || 0,
    epico:      parseInt(document.getElementById("odds-epico").value) || 0,
    legendario: parseInt(document.getElementById("odds-legendario").value) || 0,
  }
}

function updateOddsTotal() {
  const o = getOdds()
  const total = o.comun + o.raro + o.epico + o.legendario
  const el = document.getElementById("odds-total")
  if (el) {
    el.textContent = total + "%"
    el.style.color = total === 100 ? "var(--success)" : "var(--danger)"
  }
}

function applyOddsPreset(preset) {
  const presets = {
    normal:    { comun: 60, raro: 25, epico: 12, legendario: 3 },
    generosa:  { comun: 40, raro: 30, epico: 22, legendario: 8 },
    premium:   { comun: 20, raro: 30, epico: 35, legendario: 15 },
    legendaria:{ comun: 10, raro: 25, epico: 35, legendario: 30 },
  }
  if (presets[preset]) setOdds(presets[preset])
}

// muestra cuántos mimics hay de cada rareza en el canal (para avisar si falta alguna)
async function refreshBoxRarityInfo() {
  const ch = localStorage.getItem("mimiku_channel")
  const mimics = await ipcRenderer.invoke("mimics:list", ch)
  const counts = { comun: 0, raro: 0, epico: 0, legendario: 0 }
  ;(mimics || []).forEach(m => { if (counts[m.rarity] !== undefined) counts[m.rarity]++ })
  const el = document.getElementById("box-rarity-info")
  if (el) {
    el.innerHTML = `En tu canal: ${counts.comun} común · ${counts.raro} raro · ${counts.epico} épico · ${counts.legendario} legendario` +
      ((counts.epico === 0 || counts.legendario === 0) ? `<br><span style="color:var(--danger)">⚠ Si una rareza tiene 0 Mimics, su % se reparte a las demás al abrir.</span>` : "")
  }
}

function closeBoxEditor() {
  document.getElementById("box-editor-modal").style.display = "none"
}

async function saveBox() {
  const name = document.getElementById("box-name").value.trim()
  if (!name) { showToast("Ponle un nombre a la caja"); return }
  const odds = getOdds()
  const total = odds.comun + odds.raro + odds.epico + odds.legendario
  if (total !== 100) { showToast(`Las probabilidades deben sumar 100% (van ${total}%)`); return }
  const ch = localStorage.getItem("mimiku_channel")
  const box = {
    name,
    description:  document.getElementById("box-desc").value.trim(),
    icon:         document.getElementById("box-icon").value.trim() || "🎁",
    price_points: parseInt(document.getElementById("box-price").value) || 500,
    mimic_count:  parseInt(document.getElementById("box-count").value) || 3,
    odds,
  }
  try {
    await ipcRenderer.invoke("mimics:createBox", { ch, b: box })
    showToast("Caja creada ✦")
    closeBoxEditor()
    loadBoxes()
  } catch (e) {
    showToast("Error: " + e.message)
  }
}

async function removeBox(id) {
  await ipcRenderer.invoke("mimics:deleteBox", id)
  showToast("Caja eliminada")
  loadBoxes()
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

// ── Regalos del streamer ────────────────────────────────────────────────────
async function openGiftModal() {
  const ch = localStorage.getItem("mimiku_channel")
  const mimics = await ipcRenderer.invoke("mimics:list", ch)
  const sel = document.getElementById("gift-mimic-select")
  if (sel) {
    sel.replaceChildren(...mimics.map(m => {
      const option = document.createElement("option")
      option.value = String(m.id)
      option.textContent = `${m.icon || "✨"} ${m.name || "Mimic"} (${rarityLabel(m.rarity)})`
      return option
    }))
  }
  document.getElementById("gift-modal").style.display = "flex"
  updateGiftTarget()
}

function closeGiftModal() {
  document.getElementById("gift-modal").style.display = "none"
}

const PLATFORM_LABEL = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", kick: "Kick" }

async function updateGiftTarget() {
  const target = document.getElementById("gift-target").value
  document.getElementById("gift-firstn-row").style.display = target === "first_n" ? "flex" : "none"
  document.getElementById("gift-user-row").style.display   = target === "user" ? "flex" : "none"
  if (target === "user") await populateGiftUserSelect()
}

// Selecciona de la lista de viewers ACTIVOS con identidad completa
// (platform + platformUserId) en vez de un username de texto libre — así el
// regalo nunca puede terminar en la identidad de la plataforma equivocada.
async function populateGiftUserSelect() {
  const sel = document.getElementById("gift-user")
  if (!sel) return
  const active = await ipcRenderer.invoke("activity:getActiveViewers")
  if (!active.length) {
    sel.replaceChildren(new Option("Sin viewers activos todavía", ""))
    return
  }
  const placeholder = new Option("Elige un viewer activo…", "")
  const options = active.map((viewer, index) => {
    const option = new Option(`[${PLATFORM_LABEL[viewer.platform] || viewer.platform}] ${viewer.displayName || viewer.username}`, String(index))
    option.dataset.platform = viewer.platform
    option.dataset.platformUserId = viewer.platformUserId || ""
    option.dataset.username = viewer.username
    return option
  })
  sel.replaceChildren(placeholder, ...options)
}

async function sendStreamerGift() {
  const ch = localStorage.getItem("mimiku_channel")
  const mimicId = document.getElementById("gift-mimic-select").value
  const target  = document.getElementById("gift-target").value
  if (!mimicId) { showToast("Elige un Mimic"); return }
  const gift = { mimicId, target }
  if (target === "first_n") gift.targetN = parseInt(document.getElementById("gift-firstn").value) || 10
  if (target === "user") {
    const opt = document.getElementById("gift-user").selectedOptions[0]
    if (!opt || !opt.value) { showToast("Elige un viewer activo"); return }
    gift.toIdentity = {
      platform: opt.dataset.platform,
      platformUserId: opt.dataset.platformUserId,
      username: opt.dataset.username,
    }
  }

  try {
    const res = await ipcRenderer.invoke("mimics:streamerGift", { ch, gift })
    showToast(`🎁 Regalo enviado a ${res.count} viewer${res.count !== 1 ? "s" : ""} ✦`)
    closeGiftModal()
  } catch (e) {
    showToast("Error: " + e.message)
  }
}

module.exports = {
  initMimics, loadMimics, loadBoxes,
  openMimicEditor, closeMimicEditor, addBlock, removeBlock, moveBlock,
  updateBlockField, saveMimic, editMimic, removeMimic,
  openBoxEditor, closeBoxEditor, saveBox, removeBox,
  applyOddsPreset, updateOddsTotal,
  uploadBlockFile, pickBlockFile, testBlock,
  openGiftModal, closeGiftModal, updateGiftTarget, sendStreamerGift,
}
