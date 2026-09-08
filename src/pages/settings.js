// pages/settings.js
const { ipcRenderer } = require("electron")

async function initSettings() {
  const config = await ipcRenderer.invoke("config:get")
  const legacyChannel = localStorage.getItem("mimiku_channel") || ""
  document.getElementById("streamer-display-name").value = config.streamer.displayName || ""
  document.getElementById("channel").value = config.streamer.twitchChannel || legacyChannel
  document.getElementById("token").value   = localStorage.getItem("mimiku_token")   || ""
  document.getElementById("legacy-cloud-enabled").checked = config.integrations.legacySupabase.enabled
  document.getElementById("legacy-cloud-url").value = config.integrations.legacySupabase.url || ""
  document.getElementById("legacy-cloud-status").textContent = config.integrations.legacySupabase.configured
    ? "Configurado"
    : "No configurado"
  document.getElementById("btn-sync").disabled = !(
    config.integrations.legacySupabase.enabled && config.integrations.legacySupabase.configured
  )
  return config
}

async function saveAppProfile(completed = false) {
  const displayName = document.getElementById("streamer-display-name").value.trim()
  const twitchChannel = document.getElementById("channel").value.trim()
  const config = await ipcRenderer.invoke("config:save", {
    onboarding: { completed },
    streamer: { displayName, twitchChannel },
  })
  localStorage.setItem("mimiku_channel", config.streamer.twitchChannel)
  return config
}

async function saveSettings() {
  const channel = document.getElementById("channel").value.trim()
  const token   = document.getElementById("token").value.trim()
  if (!channel) return
  const config = await saveAppProfile(true)
  localStorage.setItem("mimiku_token",   token)
  await ipcRenderer.invoke("twitch:connect", { channel: config.streamer.twitchChannel, token })
  showToast("Conectando a Twitch…")
}

async function completeOnboarding() {
  const displayName = document.getElementById("onboarding-display-name").value.trim()
  const twitchChannel = document.getElementById("onboarding-twitch-channel").value.trim()
  if (!displayName || !twitchChannel) {
    showToast("Completa tu nombre y canal de Twitch")
    return
  }

  document.getElementById("streamer-display-name").value = displayName
  document.getElementById("channel").value = twitchChannel
  const config = await saveAppProfile(true)
  if (!config.onboarding.completed) {
    showToast("Revisa el nombre del canal")
    return
  }
  document.getElementById("onboarding-modal").style.display = "none"
  showToast(`Bienvenido a Mimiku, ${config.streamer.displayName}`)
}

async function saveLegacyCloudConfig() {
  const enabled = document.getElementById("legacy-cloud-enabled").checked
  const url = document.getElementById("legacy-cloud-url").value.trim()
  const anonKey = document.getElementById("legacy-cloud-key").value.trim()
  const legacySupabase = { enabled, url }
  if (anonKey) legacySupabase.anonKey = anonKey
  const config = await ipcRenderer.invoke("config:save", {
    integrations: { legacySupabase },
  })
  document.getElementById("legacy-cloud-key").value = ""
  document.getElementById("legacy-cloud-status").textContent = config.integrations.legacySupabase.configured
    ? "Configurado"
    : "No configurado"
  document.getElementById("btn-sync").disabled = !(
    config.integrations.legacySupabase.enabled && config.integrations.legacySupabase.configured
  )
  showToast("Configuración heredada guardada")
}

async function disconnectTwitch() {
  await ipcRenderer.invoke("twitch:disconnect")
  showToast("Desconectado.")
}

async function importFromMimiku1() {
  const config = await ipcRenderer.invoke("config:get")
  if (!config.integrations.legacySupabase.enabled || !config.integrations.legacySupabase.configured) {
    showToast("Configura y habilita primero el puente heredado")
    return
  }
  const btn = document.getElementById("btn-sync")
  if (btn) { btn.textContent = "Sincronizando…"; btn.disabled = true }
  try {
    const result = await ipcRenderer.invoke("legacy:import")
    showToast(`✦ ${result.imported} registros importados · ${result.skipped} ya existentes · ${result.errors.length} errores`)
  } catch (e) {
    showToast("Error al sincronizar: " + e.message)
  } finally {
    if (btn) { btn.textContent = "Importar desde Mimiku 1"; btn.disabled = false }
  }
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = {
  initSettings,
  saveSettings,
  disconnectTwitch,
  importFromMimiku1,
  completeOnboarding,
  saveLegacyCloudConfig,
}
