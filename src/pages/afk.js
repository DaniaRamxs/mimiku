// pages/afk.js — Modo AFK con contador comunitario y eventos idle
const { ipcRenderer } = require("electron")

let afkActive = false

async function initAfk() {
  const status = await ipcRenderer.invoke("afk:getStatus")
  afkActive = status?.active || false
  if (afkActive && status) {
    // restaurar valores en la UI
    document.getElementById("afk-msg-input").value  = status.message || ""
    document.getElementById("afk-goal-input").value = status.goal || 100
    document.getElementById("afk-penalty-input").value = status.penalty || 0
    if (status.rewards) {
      document.getElementById("afk-reward-points").value  = status.rewards.points || 0
      document.getElementById("afk-reward-message").value = status.rewards.message || ""
    }
  }
  updateAfkUI()
}

// subir archivo de sonido/video para la recompensa del contador
let afkSoundUrl = ""
let afkVideoUrl = ""

async function pickAfkReward(kind) {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = kind === "sound" ? "audio/*" : "video/*"
  input.onchange = async () => {
    const file = input.files[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) { showToast("El archivo supera 50MB"); return }
    showToast("Guardando " + (kind === "sound" ? "sonido" : "video") + "...")
    try {
      const saved = await ipcRenderer.invoke("assets:save", {
        kind: "afk", name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
      })
      const localUrl = `${(await ipcRenderer.invoke("overlay:getStatus")).baseUrl}${saved.url}`
      if (kind === "sound") { afkSoundUrl = localUrl; document.getElementById("afk-sound-label").textContent = "🎵 " + file.name }
      else { afkVideoUrl = localUrl; document.getElementById("afk-video-label").textContent = "🎬 " + file.name }
      showToast("Archivo listo ✦")
    } catch (e) {
      showToast("Error: " + e.message)
    }
  }
  input.click()
}

async function toggleAfk() {
  if (afkActive) {
    await ipcRenderer.invoke("afk:deactivate")
    afkActive = false
    updateAfkUI()
    return
  }

  const config = {
    message: document.getElementById("afk-msg-input").value.trim() || "Volvemos pronto",
    goal:    parseInt(document.getElementById("afk-goal-input").value) || 100,
    penalty: parseInt(document.getElementById("afk-penalty-input").value) || 0,
    rewards: {
      points:   parseInt(document.getElementById("afk-reward-points").value) || 0,
      message:  document.getElementById("afk-reward-message").value.trim() || "¡Meta alcanzada! 🎉",
      soundUrl: afkSoundUrl,
      videoUrl: afkVideoUrl,
    },
  }
  await ipcRenderer.invoke("afk:activate", config)
  afkActive = true
  updateAfkUI()
}

function updateAfkUI() {
  const btn   = document.getElementById("afk-toggle")
  const badge = document.getElementById("afk-badge-status")
  const config = document.getElementById("afk-config")
  if (!btn) return

  if (afkActive) {
    btn.textContent = "■ Desactivar modo AFK"
    btn.classList.add("afk-active")
    if (badge) { badge.textContent = "AFK ACTIVO"; badge.className = "afk-status-badge active" }
    if (config) config.style.opacity = "0.5"
  } else {
    btn.textContent = "▶ Activar modo AFK"
    btn.classList.remove("afk-active")
    if (badge) { badge.textContent = "En línea"; badge.className = "afk-status-badge" }
    if (config) config.style.opacity = "1"
  }
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = { initAfk, toggleAfk, pickAfkReward }
