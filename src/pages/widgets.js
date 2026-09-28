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
}
