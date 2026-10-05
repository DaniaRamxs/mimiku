// pages/widgets.js — panel del módulo de Widgets (avatares de chat, tarjeta de fidelidad, etc.)
const { ipcRenderer } = require("electron")
const { escapeHtml } = require("../core/html.js")

let cfg = {}
let loyaltyListening = false
let chatTopListening = false

async function initWidgets() {
  cfg = await ipcRenderer.invoke("widgets:getConfig")
  renderAvatarsForm()
  initChatTop()
  initFloatAvatars()
  initJail()
  await initLoyalty()
}

function setField(id, val) {
  const el = document.getElementById(id)
  if (!el) return
  if (el.type === "checkbox") el.checked = !!val
  else el.value = val ?? ""
}

function renderAvatarsForm() {
  const a = cfg.avatars || {}
  setField("wg-av-enabled",       a.enabled !== false)
  setField("wg-av-position",      a.position || "bottom-left")
  setField("wg-av-duration",      a.duration_s ?? 6)
  setField("wg-av-cooldown",      a.cooldown_s ?? 15)
  setField("wg-av-show-level",    a.show_level !== false)
  setField("wg-av-max-stack",     a.max_stack ?? 5)
}

async function saveAvatarsConfig() {
  const updates = {
    enabled:              document.getElementById("wg-av-enabled").checked,
    position:             document.getElementById("wg-av-position").value,
    duration_s:           parseInt(document.getElementById("wg-av-duration").value) || 6,
    cooldown_s:           parseInt(document.getElementById("wg-av-cooldown").value) || 0,
    show_level:           document.getElementById("wg-av-show-level").checked,
    max_stack:            parseInt(document.getElementById("wg-av-max-stack").value) || 5,
  }
  cfg = await ipcRenderer.invoke("widgets:setConfig", { avatars: updates })
  showToast("Widget de avatares guardado ✦")
}

async function testAvatars() {
  await ipcRenderer.invoke("widgets:test")
  showToast("Avatar de prueba enviado al overlay")
}

// ── Top 3 del chat ───────────────────────────────────────────────────────────
function initChatTop() {
  const t = cfg.chatTop || {}
  setField("wg-top-enabled", t.enabled !== false)
  setField("wg-top-title",   t.title || "Top del chat")
  setField("wg-top-theme",   t.theme || "noche")
  setField("wg-top-counts",  t.show_counts !== false)
  selectChatTopPosition(t.position || "top-right")
  document.querySelectorAll("#wg-top-position button[data-pos]").forEach(button => {
    button.onclick = () => selectChatTopPosition(button.dataset.pos)
  })
  ipcRenderer.invoke("chatTop:snapshot").then(renderChatTopLive).catch(() => {})
  if (!chatTopListening) {
    chatTopListening = true
    ipcRenderer.on("chatTop:update", (_, snapshot) => renderChatTopLive(snapshot))
  }
}

function selectChatTopPosition(position) {
  document.querySelectorAll("#wg-top-position button[data-pos]").forEach(button => {
    button.classList.toggle("active", button.dataset.pos === position)
  })
}

function selectedChatTopPosition() {
  const active = document.querySelector("#wg-top-position button.active")
  return active ? active.dataset.pos : "top-right"
}

async function saveChatTopConfig() {
  try {
    cfg = await ipcRenderer.invoke("widgets:setConfig", { chatTop: {
      enabled:     document.getElementById("wg-top-enabled").checked,
      title:       document.getElementById("wg-top-title").value,
      theme:       document.getElementById("wg-top-theme").value,
      show_counts: document.getElementById("wg-top-counts").checked,
      position:    selectedChatTopPosition(),
    } })
    initChatTop()
    showToast("Top 3 del chat guardado")
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`)
  }
}

async function previewChatTop() {
  await ipcRenderer.invoke("chatTop:preview")
  showToast("Animación de prueba enviada al overlay")
}

function renderChatTopLive(snapshot) {
  const el = document.getElementById("wg-top-live")
  if (!el) return
  const entries = (snapshot && snapshot.entries) || []
  if (!entries.length) { el.textContent = "Todavía no hay mensajes en este directo."; return }
  el.innerHTML = entries.map((entry, index) => `
    <div class="wg-top-row"><b>#${index + 1}</b><span>${escapeHtml(entry.name)} <span style="color:var(--text-muted)">(${escapeHtml(entry.platform)})</span></span>
    <strong>${Number(entry.messages).toLocaleString("es")} mensajes</strong></div>`).join("")
}

// ── Avatares flotantes (!estado, Overlay 2) ──────────────────────────────────
function initFloatAvatars() {
  const f = cfg.floatAvatars || {}
  setField("wg-fa-enabled",    f.enabled !== false)
  setField("wg-fa-duration",   f.duration_s ?? 45)
  setField("wg-fa-max",        f.max_on_screen ?? 8)
  setField("wg-fa-chars",      f.status_max ?? 40)
  setField("wg-fa-size",       f.size ?? 84)
  setField("wg-fa-speed",      f.speed ?? 140)
  setField("wg-fa-theme",      f.theme || "noche")
  setField("wg-fa-collisions", f.collisions !== false)
  for (const [id, unit] of [["wg-fa-size", "px"], ["wg-fa-speed", " px/s"]]) {
    const input = document.getElementById(id)
    const label = document.getElementById(`${id}-v`)
    if (!input || !label) continue
    label.textContent = `${input.value}${unit}`
    input.oninput = () => { label.textContent = `${input.value}${unit}` }
  }
  ipcRenderer.invoke("overlay:getStatus").then(status => {
    const url = document.getElementById("wg-fa-url")
    if (url && status && status.baseUrl) url.textContent = `${status.baseUrl}/overlay2`
  }).catch(() => {})
}

async function saveFloatAvatarsConfig() {
  const number = id => parseInt(document.getElementById(id).value, 10)
  try {
    cfg = await ipcRenderer.invoke("widgets:setConfig", { floatAvatars: {
      enabled:       document.getElementById("wg-fa-enabled").checked,
      duration_s:    number("wg-fa-duration"),
      max_on_screen: number("wg-fa-max"),
      status_max:    number("wg-fa-chars"),
      size:          number("wg-fa-size"),
      speed:         number("wg-fa-speed"),
      theme:         document.getElementById("wg-fa-theme").value,
      collisions:    document.getElementById("wg-fa-collisions").checked,
    } })
    initFloatAvatars()
    showToast("Avatares flotantes guardados")
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`)
  }
}

async function testFloatAvatars() {
  await ipcRenderer.invoke("floatAvatars:test")
  showToast("Avatares de prueba enviados al Overlay 2")
}

// ── Carcel (!carcel, Overlay 2) ──────────────────────────────────────────────
function initJail() {
  const j = cfg.jail || {}
  setField("wg-jail-enabled",  j.enabled !== false)
  setField("wg-jail-duration", j.duration_s ?? 60)
  setField("wg-jail-cells",    j.max_cells ?? 4)
  setField("wg-jail-corner",   j.corner || "bottom-left")
  setField("wg-jail-size",     j.size ?? 96)
  setField("wg-jail-theme",    j.theme || "noche")
  setField("wg-jail-protect",  j.protect_streamer !== false)
  const size = document.getElementById("wg-jail-size")
  const label = document.getElementById("wg-jail-size-v")
  if (size && label) {
    label.textContent = `${size.value}px`
    size.oninput = () => { label.textContent = `${size.value}px` }
  }
}

async function saveJailConfig() {
  const number = id => parseInt(document.getElementById(id).value, 10)
  try {
    cfg = await ipcRenderer.invoke("widgets:setConfig", { jail: {
      enabled:          document.getElementById("wg-jail-enabled").checked,
      duration_s:       number("wg-jail-duration"),
      max_cells:        number("wg-jail-cells"),
      corner:           document.getElementById("wg-jail-corner").value,
      size:             number("wg-jail-size"),
      theme:            document.getElementById("wg-jail-theme").value,
      protect_streamer: document.getElementById("wg-jail-protect").checked,
    } })
    initJail()
    showToast("Cárcel guardada")
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`)
  }
}

async function testJail() {
  await ipcRenderer.invoke("jail:test")
  showToast("Preso de prueba enviado al Overlay 2")
}

async function releaseJail() {
  await ipcRenderer.invoke("jail:releaseAll")
  showToast("Celdas vaciadas")
}

// ── Tarjeta de fidelidad (!claim) ─────────────────────────────────────────────
async function initLoyalty() {
  try {
    renderLoyaltyForm(await ipcRenderer.invoke("loyalty:getConfig"))
    await refreshLoyaltyStatus()
  } catch (error) {
    showToast(`No se pudo cargar la tarjeta de fidelidad: ${error.message}`)
  }
  if (!loyaltyListening) {
    loyaltyListening = true
    ipcRenderer.on("loyalty:update", () => { refreshLoyaltyStatus().catch(() => {}) })
  }
}

function renderLoyaltyForm(loyalty) {
  setField("wg-loy-enabled",  loyalty.enabled)
  setField("wg-loy-title",    loyalty.title)
  setField("wg-loy-theme",    loyalty.theme)
  setField("wg-loy-stamps",   loyalty.stamps)
  setField("wg-loy-reward",   loyalty.rewardPoints)
  setField("wg-loy-position", loyalty.position)
  setField("wg-loy-duration", loyalty.durationSeconds)
  setField("wg-loy-gap",      loyalty.streamGapHours)
}

async function saveLoyaltyConfig() {
  const value = id => document.getElementById(id).value
  try {
    const saved = await ipcRenderer.invoke("loyalty:setConfig", {
      enabled:         document.getElementById("wg-loy-enabled").checked,
      title:           value("wg-loy-title"),
      theme:           value("wg-loy-theme"),
      stamps:          parseInt(value("wg-loy-stamps")),
      rewardPoints:    parseInt(value("wg-loy-reward")),
      position:        value("wg-loy-position"),
      durationSeconds: parseInt(value("wg-loy-duration")),
      streamGapHours:  parseInt(value("wg-loy-gap")),
    })
    renderLoyaltyForm(saved)
    showToast("Tarjeta de fidelidad guardada")
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`)
  }
}

async function previewLoyalty(completed) {
  await ipcRenderer.invoke("loyalty:preview", completed === true)
  showToast("Tarjeta de prueba enviada al overlay")
}

async function newLoyaltyStream() {
  if (!confirm("¿Empezar un directo nuevo? Todos podrán volver a hacer !claim y el Top 3 del chat se reinicia.")) return
  renderLoyaltyStatus(await ipcRenderer.invoke("loyalty:newStream"))
  showToast("Directo nuevo iniciado para la tarjeta de fidelidad")
}

async function setLoyaltyDelivered(id, delivered) {
  try {
    renderLoyaltyStatus(await ipcRenderer.invoke("loyalty:setDelivered", id, delivered))
  } catch (error) {
    showToast(`No se pudo marcar: ${error.message}`)
  }
}

async function refreshLoyaltyStatus() {
  renderLoyaltyStatus(await ipcRenderer.invoke("loyalty:status"))
}

const STREAM_SOURCE_LABEL = { twitch: "detectado por Twitch", auto: "por actividad del chat", manual: "iniciado a mano" }

function formatTime(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es", { weekday: "short", hour: "2-digit", minute: "2-digit" })
}

function renderLoyaltyStatus(status) {
  const streamEl = document.getElementById("wg-loy-stream")
  const listEl = document.getElementById("wg-loy-completions")
  if (!streamEl || !listEl || !status) return
  streamEl.textContent = status.stream
    ? `Directo actual: ${STREAM_SOURCE_LABEL[status.stream.source] || status.stream.source}, desde ${formatTime(status.stream.startedAt)} · ${status.stream.claims} ${status.stream.claims === 1 ? "sello" : "sellos"}`
    : "Directo actual: ninguno todavía (empieza con el primer !claim)"

  if (!status.completions.length) {
    listEl.textContent = "Nadie ha completado la tarjeta todavía."
    return
  }
  listEl.innerHTML = status.completions.map(row => `
    <label style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)">
      <input type="checkbox" data-loyalty-id="${escapeHtml(row.id)}" ${row.deliveredAt ? "checked" : ""}>
      <span style="flex:1"><strong>${escapeHtml(row.displayName)}</strong> <span style="color:var(--text-muted)">(${escapeHtml(row.platform)})</span></span>
      <span style="color:var(--text-muted);font-size:12px">${escapeHtml(formatTime(row.completedAt))} · +${Number(row.rewardPoints).toLocaleString("es")} pts</span>
      <span style="font-size:12px">${row.deliveredAt ? "Premio entregado" : "Pendiente"}</span>
    </label>`).join("")
  listEl.querySelectorAll("input[data-loyalty-id]").forEach(input => {
    input.addEventListener("change", () => setLoyaltyDelivered(input.dataset.loyaltyId, input.checked))
  })
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = {
  initWidgets, saveAvatarsConfig, testAvatars,
  saveLoyaltyConfig, previewLoyalty, newLoyaltyStream,
  saveChatTopConfig, previewChatTop,
  saveFloatAvatarsConfig, testFloatAvatars,
  saveJailConfig, testJail, releaseJail,
}
