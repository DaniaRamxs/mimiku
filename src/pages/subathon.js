// pages/subathon.js — panel del subathon: contador extensible y metas de subs/bits.
const { ipcRenderer } = require("electron")
const { escapeHtml } = require("../core/html.js")

const PALETTES = [
  ["neon-aqua", "Neon Aqua"], ["toxic-green", "Toxic Green"], ["purple-haze", "Purple Haze"],
  ["sunset", "Sunset"], ["ocean", "Ocean"], ["hot-pink", "Hot Pink"], ["custom", "Personalizado"],
]
const POSITIONS = [
  ["top-left", "Arriba izq."], ["top-center", "Arriba centro"], ["top-right", "Arriba der."],
  ["middle-left", "Centro izq."], null, ["middle-right", "Centro der."],
  ["bottom-left", "Abajo izq."], ["bottom-center", "Abajo centro"], ["bottom-right", "Abajo der."],
]
const SHAPES = [["bars", "Barras"], ["dots", "Puntos"], ["wave", "Onda de sonido"]]
const ANIMATIONS = [
  ["steady", "Fija"], ["pulse", "Pulso"], ["sweep-right", "Barrido a la derecha"],
  ["sweep-left", "Barrido a la izquierda"], ["twinkle", "Destellos"], ["flicker", "Parpadeo neón"],
]
const GOALS = [
  { type: "subs", label: "Meta de subs", unit: "subs", quick: [1, 5] },
  { type: "bits", label: "Meta de bits", unit: "bits", quick: [100, 1000] },
]
const STATUS_LABEL = { idle: "Sin empezar", running: "En marcha", paused: "En pausa", ended: "Terminado" }
const MINUTE_MS = 60_000

let state = null
let clockTimer = null
let listening = false
let offset = 0

// ── Utilidades ───────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id) }
function options(list, selected) {
  return list.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("")
}
function positionGrid(container, selected) {
  container.innerHTML = POSITIONS.map(item => item
    ? `<button type="button" data-pos="${item[0]}" class="${item[0] === selected ? "active" : ""}">${item[1]}</button>`
    : "<span></span>").join("")
  container.querySelectorAll("button").forEach(button => {
    button.onclick = () => container.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button))
  })
}
function selectedPosition(container, fallback) {
  const active = container.querySelector("button.active")
  return active ? active.dataset.pos : fallback
}
function hoursMinutes(hId, mId) {
  const hours = Math.max(0, parseInt($(hId).value, 10) || 0)
  const minutes = Math.max(0, parseInt($(mId).value, 10) || 0)
  return (hours * 60 + minutes) * MINUTE_MS
}
function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const pad = n => String(n).padStart(2, "0")
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total % 3600 / 60))}:${pad(total % 60)}`
}
function formatDelta(ms) {
  const minutes = Math.round(Math.abs(ms) / MINUTE_MS)
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
  return (ms < 0 ? "-" : "+") + text
}
function errorText(error) {
  return String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}
async function call(channel, ...args) {
  try {
    state = await ipcRenderer.invoke(channel, ...args)
    render()
    return true
  } catch (error) {
    showToast(errorText(error))
    return false
  }
}

// ── Carga ────────────────────────────────────────────────────────────────────
async function initSubathon() {
  buildGoalPanels()
  state = await ipcRenderer.invoke("subathon:state")
  fillTimerForm()
  GOALS.forEach(goal => fillGoalForm(goal.type))
  render()
  if (!clockTimer) clockTimer = setInterval(renderClock, 500)
  if (!listening) {
    listening = true
    ipcRenderer.on("subathon:timer", (_, timer) => { if (state) { state.timer = timer; render() } })
    ipcRenderer.on("subathon:goal", (_, goal) => { if (state) { state.goals[goal.goal] = goal; render() } })
  }
}

function buildGoalPanels() {
  const host = $("sa-goal-panels")
  if (!host || host.childElementCount) return
  host.innerHTML = GOALS.map(goal => `
    <div class="panel" style="max-width:760px;margin-top:1rem">
      <div class="panel-header">
        <span class="panel-title">${goal.label}</span>
        <span style="display:flex;gap:6px">
          <button class="btn-ghost" data-preview="${goal.type}">Probar</button>
          <button class="btn-ghost" data-preview-done="${goal.type}">Probar meta cumplida</button>
        </span>
      </div>
      <label class="lvl-check"><input type="checkbox" id="sa-g-${goal.type}-enabled"> Visible en el overlay y contando desde Twitch</label>
      <div class="sa-goal-count-row">
        <span class="sa-big" id="sa-g-${goal.type}-count">0</span>
        <small id="sa-g-${goal.type}-next"></small>
        <span style="flex:1"></span>
        ${goal.quick.map(n => `<button class="btn-ghost" data-add="${goal.type}" data-n="-${n}">-${n}</button>`).join("")}
        ${goal.quick.map(n => `<button class="btn-ghost" data-add="${goal.type}" data-n="${n}">+${n}</button>`).join("")}
        <input id="sa-g-${goal.type}-set" type="number" min="0" style="width:90px" placeholder="Fijar">
        <button class="btn-ghost" data-set="${goal.type}">Fijar</button>
      </div>
      <div class="sa-hm">
        <label style="flex:2">Título<input id="sa-g-${goal.type}-title" type="text" maxlength="30"></label>
        <label>Forma<select id="sa-g-${goal.type}-shape" class="event-select">${options(SHAPES)}</select></label>
        <label>Animación<select id="sa-g-${goal.type}-anim" class="event-select">${options(ANIMATIONS)}</select></label>
      </div>
      <label class="sa-label" for="sa-g-${goal.type}-milestones">Metas (una por línea: cantidad y premio). Al cumplir una, pasa sola a la siguiente.</label>
      <textarea id="sa-g-${goal.type}-milestones" class="sa-milestones" placeholder="${goal.type === "subs" ? "10: Cosplay\n25: Karaoke\n50: Stream de 24 h" : "1000: Reto\n5000: Cosplay"}"></textarea>
      <div class="sa-hm" style="margin-top:8px">
        <label>Colores<select id="sa-g-${goal.type}-palette" class="event-select">${options(PALETTES)}</select></label>
        <label>Color 1<input id="sa-g-${goal.type}-c1" type="color"></label>
        <label>Color 2<input id="sa-g-${goal.type}-c2" type="color"></label>
        <label>Segmentos<input id="sa-g-${goal.type}-segments" type="number" min="8" max="40"></label>
      </div>
      <div class="sa-hm" style="align-items:flex-start">
        <div><div class="sa-label">Posición</div><div id="sa-g-${goal.type}-position" class="wg-pos-grid sa-pos"></div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:10px">
          <label>Brillo <span id="sa-g-${goal.type}-glow-v"></span><input id="sa-g-${goal.type}-glow" type="range" min="0" max="100" step="5"></label>
          <label>Tamaño <span id="sa-g-${goal.type}-size-v"></span><input id="sa-g-${goal.type}-size" type="range" min="50" max="200" step="5"></label>
        </div>
      </div>
      <button class="btn-primary" style="margin-top:12px" data-save="${goal.type}">Guardar ${goal.label.toLowerCase()}</button>
    </div>`).join("")

  host.querySelectorAll("[data-preview]").forEach(b => { b.onclick = () => previewGoal(b.dataset.preview, false) })
  host.querySelectorAll("[data-preview-done]").forEach(b => { b.onclick = () => previewGoal(b.dataset.previewDone, true) })
  host.querySelectorAll("[data-add]").forEach(b => { b.onclick = () => call("subathon:goalAdd", b.dataset.add, Number(b.dataset.n)) })
  host.querySelectorAll("[data-set]").forEach(b => {
    b.onclick = () => {
      const value = parseInt($(`sa-g-${b.dataset.set}-set`).value, 10)
      if (Number.isNaN(value) || value < 0) { showToast("Escribe una cantidad válida"); return }
      call("subathon:goalSet", b.dataset.set, value)
    }
  })
  host.querySelectorAll("[data-save]").forEach(b => { b.onclick = () => saveGoal(b.dataset.save) })
  for (const goal of GOALS) {
    for (const key of ["glow", "size"]) {
      const input = $(`sa-g-${goal.type}-${key}`)
      input.oninput = () => { $(`sa-g-${goal.type}-${key}-v`).textContent = `${input.value}%` }
    }
  }
  $("sa-p-palette").innerHTML = options(PALETTES)
  $("sa-p-size").oninput = () => { $("sa-p-size-v").textContent = `${$("sa-p-size").value}%` }
}

// ── Formularios ──────────────────────────────────────────────────────────────
function fillTimerForm() {
  const config = state.timer.config
  $("sa-p-per-sub").value = config.minutesPerSub
  $("sa-p-per-bits").value = config.minutesPerHundredBits
  $("sa-p-tiers").checked = config.tierWeights
  $("sa-p-title").value = config.title
  $("sa-p-palette").value = config.palette
  $("sa-p-c1").value = config.customColors[0]
  $("sa-p-c2").value = config.customColors[1]
  $("sa-p-size").value = config.size
  $("sa-p-size-v").textContent = `${config.size}%`
  positionGrid($("sa-p-position"), config.position)
}

function fillGoalForm(type) {
  const config = state.goals[type].config
  const field = key => $(`sa-g-${type}-${key}`)
  field("enabled").checked = config.enabled
  field("title").value = config.title
  field("shape").value = config.shape
  field("anim").value = config.animation
  field("milestones").value = config.milestones.map(item => item.reward ? `${item.target}: ${item.reward}` : String(item.target)).join("\n")
  field("palette").value = config.palette
  field("c1").value = config.customColors[0]
  field("c2").value = config.customColors[1]
  field("segments").value = config.segments
  field("glow").value = config.glow
  field("size").value = config.size
  $(`sa-g-${type}-glow-v`).textContent = `${config.glow}%`
  $(`sa-g-${type}-size-v`).textContent = `${config.size}%`
  positionGrid(field("position"), config.position)
}

// "1.000: premio", "25 premio" o "50".
function parseMilestones(text) {
  return String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^([\d.,\s]+)\s*[:\-]?\s*(.*)$/)
    if (!match) throw new Error(`No entiendo la meta "${line}". Empieza cada línea con un número.`)
    return { target: parseInt(match[1].replace(/[.,\s]/g, ""), 10), reward: match[2].trim() }
  })
}

// ── Acciones ─────────────────────────────────────────────────────────────────
async function saveTimerConfig() {
  const ok = await call("subathon:timerConfig", {
    minutesPerSub: parseInt($("sa-p-per-sub").value, 10),
    minutesPerHundredBits: parseInt($("sa-p-per-bits").value, 10),
    tierWeights: $("sa-p-tiers").checked,
    title: $("sa-p-title").value,
    palette: $("sa-p-palette").value,
    customColors: [$("sa-p-c1").value, $("sa-p-c2").value],
    position: selectedPosition($("sa-p-position"), "top-center"),
    size: parseInt($("sa-p-size").value, 10),
  })
  if (ok) showToast("Contador guardado")
}

async function saveGoal(type) {
  const field = key => $(`sa-g-${type}-${key}`)
  let milestones
  try { milestones = parseMilestones(field("milestones").value) } catch (error) { showToast(error.message); return }
  const ok = await call("subathon:goalConfig", type, {
    enabled: field("enabled").checked,
    title: field("title").value,
    shape: field("shape").value,
    animation: field("anim").value,
    milestones,
    palette: field("palette").value,
    customColors: [field("c1").value, field("c2").value],
    segments: parseInt(field("segments").value, 10),
    glow: parseInt(field("glow").value, 10),
    size: parseInt(field("size").value, 10),
    position: selectedPosition(field("position"), type === "bits" ? "bottom-right" : "bottom-left"),
  })
  if (ok) { fillGoalForm(type); showToast("Meta guardada") }
}

function start() { return call("subathon:start") }
function pause() { return call("subathon:pause") }
async function reset() {
  if (!confirm("¿Reiniciar el contador? Se pierde el tiempo restante y el historial de sumas. Las metas no se tocan.")) return
  await call("subathon:reset")
}
function setRemaining() { return call("subathon:setRemaining", hoursMinutes("sa-p-set-h", "sa-p-set-m")) }

function manualLabel() {
  const note = $("sa-p-note").value.trim()
  return note ? `${$("sa-p-source").value} · ${note}` : $("sa-p-source").value
}

async function addTime(sign) {
  const ms = hoursMinutes("sa-p-add-h", "sa-p-add-m")
  if (!ms) { showToast("Indica horas o minutos"); return }
  if (await call("subathon:addTime", sign < 0 ? -ms : ms, manualLabel())) {
    showToast(`${formatDelta(sign < 0 ? -ms : ms)} al contador`)
    $("sa-p-note").value = ""
  }
}

async function quickAdd(minutes) {
  if (await call("subathon:addTime", minutes * MINUTE_MS, manualLabel())) showToast(`${formatDelta(minutes * MINUTE_MS)} al contador`)
}

async function previewTime() {
  await ipcRenderer.invoke("subathon:previewTime")
  showToast("Animación de prueba enviada al overlay")
}

async function previewGoal(type, reached) {
  await ipcRenderer.invoke("subathon:previewGoal", type, reached)
  showToast("Animación de prueba enviada al overlay")
}

// ── Pintado ──────────────────────────────────────────────────────────────────
function remainingNow() {
  const timer = state && state.timer
  if (!timer) return 0
  if (timer.status === "running" && timer.endsAt) return Math.max(0, timer.endsAt - (Date.now() + offset))
  return timer.status === "ended" ? 0 : timer.remainingMs
}

function renderClock() {
  const clock = $("sa-p-clock")
  if (clock && state) clock.textContent = formatClock(remainingNow())
}

function render() {
  if (!state) return
  const timer = state.timer
  offset = Number.isFinite(timer.serverNow) ? timer.serverNow - Date.now() : 0
  const status = $("sa-p-status")
  if (status) {
    status.textContent = STATUS_LABEL[timer.status] || timer.status
    status.className = `sa-panel-status ${timer.status}`
  }
  const startButton = $("sa-p-start")
  if (startButton) {
    startButton.textContent = timer.status === "paused" ? "Reanudar" : "Empezar"
    startButton.disabled = timer.status === "running"
  }
  const pauseButton = $("sa-p-pause")
  if (pauseButton) pauseButton.disabled = timer.status !== "running"
  renderClock()
  const history = $("sa-p-history")
  if (history) {
    history.innerHTML = timer.history.length
      ? timer.history.map(item => `<div class="sa-hist"><b class="${item.ms < 0 ? "neg" : ""}">${formatDelta(item.ms)}</b>
          <span>${escapeHtml(item.user ? `${item.user} · ${item.label}` : item.label || item.source)}</span>
          <time>${new Date(item.at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</time></div>`).join("")
      : "Todavía no se ha sumado tiempo."
  }
  for (const goal of GOALS) {
    const snap = state.goals[goal.type]
    const countEl = $(`sa-g-${goal.type}-count`)
    if (!snap || !countEl) continue
    countEl.textContent = snap.count.toLocaleString("es")
    $(`sa-g-${goal.type}-next`).textContent = snap.allDone
      ? "Todas las metas cumplidas"
      : `de ${snap.target.toLocaleString("es")} ${goal.unit} (meta ${snap.milestoneIndex + 1} de ${snap.milestoneTotal})`
  }
}

function showToast(msg) {
  const t = $("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = {
  initSubathon, saveTimerConfig, start, pause, reset, setRemaining, addTime, quickAdd, previewTime,
}
