// pages/emotes.js — Emotes con sonido
const { ipcRenderer } = require("electron")

let emoteState = { mappings: [], enabled: true }

async function initEmotes() {
  const data = await ipcRenderer.invoke("emotes:list")
  emoteState = data || { mappings: [], enabled: true }
  renderEmotes()
  const toggle = document.getElementById("emotes-enabled")
  if (toggle) toggle.checked = emoteState.enabled
}

function renderEmotes() {
  const el = document.getElementById("emotes-list")
  if (!el) return
  if (!emoteState.mappings.length) {
    el.innerHTML = `<p class="empty">No hay sonidos aún. Agrega el primero abajo.</p>`
    return
  }
  el.innerHTML = emoteState.mappings.map(m => `
    <div class="emote-row">
      <div class="emote-info">
        <input type="text" class="emote-name" value="${(m.emote||"").replace(/"/g,'&quot;')}" onchange="window.emotesPage.updateField('${m.id}','emote',this.value)" placeholder="nombre del emote">
        <span class="emote-file">🎵 ${m.file}</span>
      </div>
      <label class="emote-cd">cooldown <input type="number" min="0" value="${m.cooldown_s}" onchange="window.emotesPage.updateField('${m.id}','cooldown_s',this.value)">s</label>
      <label class="emote-vol">vol <input type="number" step="0.1" min="0" max="1" value="${m.volume}" onchange="window.emotesPage.updateField('${m.id}','volume',this.value)"></label>
      <button class="btn-icon-sm test" onclick="window.emotesPage.test('${m.id}')" title="Probar">▶</button>
      <button class="btn-icon-sm danger" onclick="window.emotesPage.remove('${m.id}')" title="Eliminar">✕</button>
    </div>`).join("")
}

async function toggleEnabled(val) {
  emoteState.enabled = await ipcRenderer.invoke("emotes:setEnabled", val)
}

async function updateField(id, field, value) {
  if (field === "cooldown_s") value = parseInt(value) || 0
  if (field === "volume")     value = parseFloat(value) || 0
  const u = {}; u[field] = value
  emoteState.mappings = await ipcRenderer.invoke("emotes:update", { id, u })
}

async function test(id) {
  await ipcRenderer.invoke("emotes:test", id)
}

async function remove(id) {
  emoteState.mappings = await ipcRenderer.invoke("emotes:remove", id)
  renderEmotes()
}

// agregar: archivo + emote + cooldown
function pickEmoteFile() {
  const emote = document.getElementById("new-emote-name").value.trim()
  if (!emote) { showToast("Escribe el nombre del emote primero"); return }
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "audio/*"
  input.onchange = async () => {
    const file = input.files[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { showToast("El audio supera 10MB"); return }
    const reader = new FileReader()
    reader.onload = async () => {
      const b64 = reader.result.split(",")[1]
      const cooldown_s = parseInt(document.getElementById("new-emote-cd").value) || 5
      emoteState.mappings = await ipcRenderer.invoke("emotes:add", {
        emote, fileName: file.name, fileDataB64: b64, cooldown_s, volume: 0.8,
      })
      document.getElementById("new-emote-name").value = ""
      renderEmotes()
      showToast("Sonido agregado ✦")
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = {
  initEmotes, renderEmotes, toggleEnabled, updateField, test, remove, pickEmoteFile,
}
