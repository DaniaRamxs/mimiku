// pages/emotes.js — Emotes con sonido
const { ipcRenderer } = require("electron")
const { escapeHtml, inlineJson } = require("../core/html.js")

let emoteState = { mappings: [], enabled: true, masterVolume: 1 }
let previewAudio = null
let previewRequest = 0

async function initEmotes() {
  const data = await ipcRenderer.invoke("emotes:list")
  emoteState = data || { mappings: [], enabled: true }
  renderEmotes()
  const toggle = document.getElementById("emotes-enabled")
  if (toggle) toggle.checked = emoteState.enabled
  const masterVolume = document.getElementById("emotes-master-volume")
  if (masterVolume) masterVolume.value = String(emoteState.masterVolume ?? 1)
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
        <input type="text" class="emote-name" value="${escapeHtml(m.emote)}" onchange="window.emotesPage.updateField(${inlineJson(m.id)},'emote',this.value)" placeholder="nombre del emote">
        <span class="emote-file">${m.exists === false ? "⚠ Archivo ausente" : "🎵 " + escapeHtml(m.file)}</span>
      </div>
      <label class="emote-cd">plataforma <select onchange="window.emotesPage.updateField(${inlineJson(m.id)},'platform',this.value)">
        <option value="all" ${m.platform === "all" || !m.platform ? "selected" : ""}>Todas</option>
        <option value="twitch" ${m.platform === "twitch" ? "selected" : ""}>Twitch</option>
        <option value="youtube" ${m.platform === "youtube" ? "selected" : ""}>YouTube</option>
        <option value="tiktok" ${m.platform === "tiktok" ? "selected" : ""}>TikTok</option>
        <option value="kick" ${m.platform === "kick" ? "selected" : ""}>Kick</option>
      </select></label>
      <label class="emote-cd">cooldown <input type="number" min="0" value="${Number(m.cooldown_s) || 0}" onchange="window.emotesPage.updateField(${inlineJson(m.id)},'cooldown_s',this.value)">s</label>
      <label class="emote-vol">vol <input type="number" step="0.1" min="0" max="1" value="${Number(m.volume) || 0}" onchange="window.emotesPage.updateField(${inlineJson(m.id)},'volume',this.value)"></label>
      <button class="btn-icon-sm test" onclick="window.emotesPage.test(${inlineJson(m.id)})" title="Probar">▶</button>
      <button class="btn-icon-sm danger" onclick="window.emotesPage.remove(${inlineJson(m.id)})" title="Eliminar">✕</button>
    </div>`).join("")
}

async function toggleEnabled(val) {
  emoteState.enabled = await ipcRenderer.invoke("emotes:setEnabled", val)
}

async function setMasterVolume(value) {
  emoteState.masterVolume = await ipcRenderer.invoke("emotes:setMasterVolume", Number(value))
}

async function updateField(id, field, value) {
  if (field === "cooldown_s") value = parseInt(value) || 0
  if (field === "volume")     value = parseFloat(value) || 0
  const u = {}; u[field] = value
  emoteState.mappings = await ipcRenderer.invoke("emotes:update", { id, u })
}

async function test(id) {
  const request = ++previewRequest
  if (previewAudio) {
    previewAudio.pause()
    previewAudio = null
  }
  try {
    const sound = await ipcRenderer.invoke("emotes:test", id)
    if (request !== previewRequest) return false
    if (sound.volume <= 0) {
      showToast("Sube el volumen del sonido y el volumen general para probarlo")
      return false
    }
    previewAudio = new Audio(sound.url)
    previewAudio.volume = sound.volume
    await previewAudio.play()
    return true
  } catch (error) {
    if (request === previewRequest) {
      showToast("No se pudo reproducir el sonido: " + error.message)
    }
    return false
  }
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
      const platform = document.getElementById("new-emote-platform").value
      emoteState.mappings = await ipcRenderer.invoke("emotes:add", {
        emote, fileName: file.name, fileDataB64: b64, mimeType: file.type, cooldown_s, volume: 0.8, platform,
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
  initEmotes, renderEmotes, toggleEnabled, setMasterVolume, updateField, test, remove, pickEmoteFile,
}
