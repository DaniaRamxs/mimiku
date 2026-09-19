// pages/vips.js — configuración de puntos y alertas para VIPs
const { ipcRenderer } = require("electron")
const { escapeHtml, inlineJson } = require("../core/html.js")

let vipState = { enabled: true, vipPointsPerMessage: 5, users: [], sounds: [] }
let previewAudio = null

async function initVips() {
  vipState = await ipcRenderer.invoke("vips:list") || vipState
  const enabled = document.getElementById("vips-enabled")
  const points = document.getElementById("vips-points")
  if (enabled) enabled.checked = vipState.enabled !== false
  if (points) points.value = String(vipState.vipPointsPerMessage ?? 5)
  renderVips()
}

function renderVips() {
  renderUsers()
  renderSounds()
}

function renderUsers() {
  const el = document.getElementById("vips-users-list")
  if (!el) return
  if (!vipState.users?.length) {
    el.innerHTML = "<p class=\"empty-small\">No hay VIPs manuales.</p>"
    return
  }
  el.innerHTML = vipState.users.map(user =>
    "<div class=\"vip-row\">" +
      "<span>💎 <strong>" + escapeHtml(user.username) + "</strong> <span class=\"field-hint\">" + escapeHtml(user.platform || "all") + "</span></span>" +
      "<button class=\"btn-icon-sm danger\" onclick='window.vipsPage.removeUser(" + inlineJson(user.username) + "," + inlineJson(user.platform) + ")' title=\"Quitar VIP\">✕</button>" +
    "</div>"
  ).join("")
}

function renderSounds() {
  const el = document.getElementById("vips-sounds-list")
  if (!el) return
  if (!vipState.sounds?.length) {
    el.innerHTML = "<p class=\"empty\">No hay alertas VIP aún. Agrega un audio arriba.</p>"
    return
  }
  el.innerHTML = vipState.sounds.map(sound => {
    const target = "⌘ " + escapeHtml(sound.command || "")
    const file = sound.exists === false ? "⚠ Archivo ausente" : "🎵 " + escapeHtml(sound.file)
    const volume = Number.isFinite(Number(sound.volume)) ? Number(sound.volume) : 0.8
    return "<div class=\"vip-row vip-sound-row\">" +
      "<div class=\"vip-sound-info\"><strong>" + target + "</strong><span class=\"emote-file\">" + file + "</span></div>" +
      "<label>comando <input class=\"vip-command-input\" type=\"text\" value=\"" + escapeHtml(sound.command || "") + "\" onchange='window.vipsPage.updateSound(" + inlineJson(sound.id) + ",\"command\",this.value)'></label>" +
      "<label>plataforma <select onchange='window.vipsPage.updateSound(" + inlineJson(sound.id) + ",\"platform\",this.value)'>" +
        "<option value=\"all\" " + (sound.platform === "all" ? "selected" : "") + ">Todas</option>" +
        "<option value=\"twitch\" " + (sound.platform === "twitch" ? "selected" : "") + ">Twitch</option>" +
        "<option value=\"youtube\" " + (sound.platform === "youtube" ? "selected" : "") + ">YouTube</option>" +
        "<option value=\"tiktok\" " + (sound.platform === "tiktok" ? "selected" : "") + ">TikTok</option>" +
        "<option value=\"kick\" " + (sound.platform === "kick" ? "selected" : "") + ">Kick</option>" +
      "</select></label>" +
      "<label>temporizador <input type=\"number\" min=\"0\" max=\"86400\" value=\"" + (Number(sound.cooldown_s) || 0) + "\" onchange='window.vipsPage.updateSound(" + inlineJson(sound.id) + ",\"cooldown_s\",this.value)'>s</label>" +
      "<label>vol <input type=\"number\" min=\"0\" max=\"1\" step=\"0.1\" value=\"" + volume + "\" onchange='window.vipsPage.updateSound(" + inlineJson(sound.id) + ",\"volume\",this.value)'></label>" +
      "<button class=\"btn-icon-sm test\" onclick='window.vipsPage.testSound(" + inlineJson(sound.id) + ")' title=\"Probar\">▶</button>" +
      "<button class=\"btn-icon-sm danger\" onclick='window.vipsPage.removeSound(" + inlineJson(sound.id) + ")' title=\"Eliminar\">✕</button>" +
    "</div>"
  }).join("")
}

async function toggleEnabled(value) {
  vipState.enabled = await ipcRenderer.invoke("vips:setEnabled", !!value)
}

async function savePoints() {
  const input = document.getElementById("vips-points")
  const points = Math.max(0, parseInt(input?.value, 10) || 0)
  vipState.vipPointsPerMessage = await ipcRenderer.invoke("vips:setPoints", points)
  if (input) input.value = String(vipState.vipPointsPerMessage)
  showToast("Puntos VIP guardados ✦")
}

async function addUser() {
  const input = document.getElementById("new-vip-username")
  const username = input?.value.trim()
  if (!username) { showToast("Escribe el nombre del VIP"); return }
  try {
    vipState.users = await ipcRenderer.invoke("vips:addUser", {
      username,
      platform: document.getElementById("new-vip-platform")?.value || "all",
    })
    input.value = ""
    renderUsers()
    showToast("VIP agregado ✦")
  } catch (error) {
    showToast(error.message)
  }
}

async function removeUser(username, platform) {
  vipState.users = await ipcRenderer.invoke("vips:removeUser", { username, platform })
  renderUsers()
}

async function updateSound(id, field, value) {
  if (field === "cooldown_s") value = parseInt(value, 10) || 0
  if (field === "volume") value = Number(value)
  vipState = await ipcRenderer.invoke("vips:updateSound", { id, u: { [field]: value } })
  renderSounds()
}

async function removeSound(id) {
  vipState = await ipcRenderer.invoke("vips:removeSound", id)
  renderSounds()
}

async function testSound(id) {
  if (previewAudio) { previewAudio.pause(); previewAudio = null }
  try {
    const sound = await ipcRenderer.invoke("vips:testSound", id)
    if (sound.volume <= 0) { showToast("Sube el volumen para probar la alerta"); return false }
    previewAudio = new Audio(sound.url)
    previewAudio.volume = sound.volume
    await previewAudio.play()
    return true
  } catch (error) {
    showToast("No se pudo reproducir la alerta: " + error.message)
    return false
  }
}

function pickSoundFile() {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = "audio/*"
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { showToast("El audio supera 10MB"); return }
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        vipState = await ipcRenderer.invoke("vips:addSound", {
          command: document.getElementById("new-vip-sound-command")?.value.trim() || "",
          platform: document.getElementById("new-vip-sound-platform")?.value || "all",
          cooldown_s: parseInt(document.getElementById("new-vip-sound-cd")?.value, 10) || 0,
          volume: Number(document.getElementById("new-vip-sound-volume")?.value),
          fileName: file.name,
          fileDataB64: reader.result.split(",")[1],
          mimeType: file.type,
        })
        document.getElementById("new-vip-sound-command").value = ""
        renderSounds()
        showToast("Alerta VIP agregada ✦")
      } catch (error) {
        showToast(error.message)
      }
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function showToast(message) {
  const toast = document.getElementById("toast")
  if (!toast) return
  toast.textContent = message
  toast.classList.add("show")
  setTimeout(() => toast.classList.remove("show"), 3000)
}

module.exports = {
  initVips, renderVips, toggleEnabled, savePoints, addUser, removeUser,
  updateSound, removeSound, testSound, pickSoundFile,
}
