// pages/settings.js
const { ipcRenderer } = require("electron")

async function initSettings() {
  const config = await ipcRenderer.invoke("config:get")
  document.getElementById("streamer-display-name").value = config.streamer.displayName || ""
  document.getElementById("channel").value = config.streamer.twitchChannel || ""
  const legacyToken = localStorage.getItem("mimiku_token") || ""
  if (legacyToken) {
    await ipcRenderer.invoke("secrets:setTwitchToken", legacyToken)
    localStorage.removeItem("mimiku_token")
  }
  const twitchSecret = await ipcRenderer.invoke("secrets:twitchStatus")
  const tokenInput = document.getElementById("token")
  tokenInput.value = ""
  tokenInput.placeholder = twitchSecret.configured ? "Token guardado de forma segura" : "oauth:xxxxxxxxxxxxxxxxxxxx"
  const tokenStatus = document.getElementById("twitch-token-status")
  if (tokenStatus) tokenStatus.textContent = twitchSecret.configured
    ? (twitchSecret.protected ? "Guardado con protección del sistema" : "Disponible solo durante esta sesión")
    : "No configurado"
  document.getElementById("legacy-cloud-enabled").checked = config.integrations.legacySupabase.enabled
  document.getElementById("legacy-cloud-url").value = config.integrations.legacySupabase.url || ""
  document.getElementById("legacy-cloud-status").textContent = config.integrations.legacySupabase.configured
    ? "Configurado"
    : "No configurado"
  document.getElementById("btn-sync").disabled = !(
    config.integrations.legacySupabase.enabled && config.integrations.legacySupabase.configured
  )
  await refreshSsnStatus()
  await refreshTikTok(config)
  await refreshBackups()
  if (!ssnStatusInterval) ssnStatusInterval = setInterval(() => refreshSsnStatus().catch(() => {}), 4000)
  if (!tiktokStatusInterval) tiktokStatusInterval = setInterval(() => refreshTikTokStatus().catch(() => {}), 4000)
  return config
}

// ── Social Stream Ninja (fuente opcional, solo lectura) ─────────────────────
function timeAgo(iso) {
  if (!iso) return "—"
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `hace ${seconds}s`
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)}m`
  return `hace ${Math.round(seconds / 3600)}h`
}

// Estado del TRANSPORTE (¿hay conexión real con SSApp?) — es lo que manda
// en la UI. Los contadores de payload (§ más abajo) solo se muestran una
// vez que hay conexión; "conectado" nunca se muestra solo porque exista
// configuración guardada, tal como pidió la fase.
const SSN_CONNECTION_LABEL = {
  not_detected: "⚪ Social Stream Ninja no detectado",
  detecting: "🔎 Detectando…",
  detected: "🟢 Social Stream Ninja detectado",
  not_connected: "⚪ No conectado",
  connecting: "🟡 Conectando…",
  connected: "🟢 Conectado",
  reconnecting: "🟠 Reconectando…",
  error: "🔴 Error",
}

// Nunca se muestra el texto técnico crudo del error (conn.error) en la UI —
// solo un mensaje en español, pensado para un streamer que nunca
// vio un WebSocket en su vida. El detalle técnico real sigue yendo a la
// consola (ver más abajo) para poder diagnosticarlo si hace falta.
const SSN_ERROR_CONNECT_MSG =
  "No pudimos conectar con Social Stream Ninja. Comprueba que Social Stream Ninja esté abierto y que File → Enable Local Server (3003) esté activado."

let ssnStatusInterval = null

async function refreshSsnStatus() {
  const el = document.getElementById("ssn-conn-status")
  if (!el) return // la página de ajustes puede no tener esta sección todavía cargada
  const status = await ipcRenderer.invoke("ssn:getStatus")
  const conn = status.connection || { state: "not_connected" }
  const discovery = status.discovery || { state: "not_detected", chatRelayEnabled: null }

  const visibleState = conn.state === "not_connected" ? discovery.state : conn.state
  el.textContent = SSN_CONNECTION_LABEL[visibleState] || SSN_CONNECTION_LABEL.not_detected

  const errorEl = document.getElementById("ssn-error-msg")
  if (errorEl) {
    if (conn.state === "error") {
      if (conn.error) console.debug("[ssn] detalle técnico de conexión:", conn.error)
      errorEl.textContent = SSN_ERROR_CONNECT_MSG
      errorEl.style.display = ""
    } else {
      errorEl.style.display = "none"
    }
  }

  const connected = conn.state === "connected" || conn.state === "reconnecting"
  document.getElementById("ssn-connect-btn").style.display = !connected && discovery.state === "detected" && discovery.configured !== false ? "" : "none"
  const detectBtn = document.getElementById("ssn-detect-btn")
  if (detectBtn) detectBtn.style.display = connected ? "none" : ""
  document.getElementById("ssn-disconnect-btn").style.display = connected ? "" : "none"
  document.getElementById("ssn-connected-info").style.display = connected ? "" : "none"

  const serverAddrEl = document.getElementById("ssn-server-addr")
  if (serverAddrEl) serverAddrEl.textContent = conn.port ? `127.0.0.1:${conn.port}` : "—"
  document.getElementById("ssn-last-event").textContent = status.lastPlatform
    ? `${status.lastPlatform} · ${timeAgo(status.lastEventAt)}`
    : "Aún no se han recibido eventos."
  document.getElementById("ssn-platforms").textContent = status.platforms.length ? status.platforms.join(", ") : "—"

  const relayHint = document.getElementById("ssn-relay-hint")
  if (relayHint) {
    if (discovery.configured === false && discovery.state === "detected") {
      relayHint.textContent = "Mimiku detectó el relay, pero no pudo leer la sesión activa de Social Stream Ninja. Usa una instalación estándar de SSApp para la conexión automática."
      relayHint.style.display = ""
    } else {
      relayHint.textContent = discovery.chatRelayEnabled === false
        ? 'En Social Stream Ninja activa “Send messages to Dock from Extension via server” para que el chat llegue al relay local.'
        : ""
      relayHint.style.display = discovery.chatRelayEnabled === false ? "" : "none"
    }
  }

  const urlInput = document.getElementById("ssn-post-url")
  if (urlInput) urlInput.value = status.postUrl
}

async function connectSsn() {
  try {
    await ipcRenderer.invoke("ssn:connect")
    showToast("Conectando con Social Stream Ninja…")
  } catch (error) {
    console.debug("[ssn] no se pudo resolver la sala activa:", error?.message || error)
    showToast("No pudimos leer la configuración activa de Social Stream Ninja")
  }
  await refreshSsnStatus()
}

async function detectSsn() {
  showToast("Detectando Social Stream Ninja…")
  await ipcRenderer.invoke("ssn:detect")
  await refreshSsnStatus()
}

async function disconnectSsn() {
  await ipcRenderer.invoke("ssn:disconnect")
  showToast("Desconectado de Social Stream Ninja")
  await refreshSsnStatus()
}

function copySsnUrl() {
  const input = document.getElementById("ssn-post-url")
  if (!input) return
  input.select()
  document.execCommand("copy")
  showToast("URL copiada")
}

// ── TikTok LIVE (fuente no oficial) ─────────────────────────────────────────
const TIKTOK_STATE_LABEL = {
  disconnected: "Desconectado",
  connecting: "Conectando…",
  connected: "Conectado",
  reconnecting: "Reconectando…",
  error: "Error",
  unavailable: "No disponible",
}

let tiktokStatusInterval = null

async function refreshTikTokStatus() {
  const label = document.getElementById("tiktok-status")
  if (!label) return
  const status = await ipcRenderer.invoke("tiktok:getStatus")
  label.textContent = TIKTOK_STATE_LABEL[status.state] || TIKTOK_STATE_LABEL.disconnected
  const errorEl = document.getElementById("tiktok-error")
  errorEl.textContent = status.error || ""
  errorEl.style.display = status.error ? "" : "none"
  const active = ["connecting", "connected", "reconnecting"].includes(status.state)
  document.getElementById("tiktok-connect-btn").style.display = active ? "none" : ""
  document.getElementById("tiktok-disconnect-btn").style.display = active ? "" : "none"
}

async function refreshTikTok(config) {
  if (!document.getElementById("tiktok-username")) return
  const saved = config?.integrations?.tiktok || {}
  document.getElementById("tiktok-username").value = saved.username || ""
  document.getElementById("tiktok-auto-reconnect").checked = saved.autoReconnect !== false
  await refreshTikTokStatus()
  await refreshGiftConfig()
  await refreshRankConfig()
}

async function connectTikTok() {
  const username = document.getElementById("tiktok-username").value.trim()
  if (!username) { showToast("Escribe tu usuario de TikTok"); return }
  const autoReconnect = document.getElementById("tiktok-auto-reconnect").checked
  await ipcRenderer.invoke("tiktok:connect", { username, autoReconnect })
  showToast("Conectando con TikTok…")
  await refreshTikTokStatus()
}

async function disconnectTikTok() {
  await ipcRenderer.invoke("tiktok:disconnect")
  showToast("Desconectado de TikTok")
  await refreshTikTokStatus()
}

// Filas de lista construidas con textContent: los nombres de regalo y de Mimic
// pueden venir de fuera y nunca se inyectan como HTML.
function renderRemovableRows(container, rows) {
  container.replaceChildren()
  if (!rows.length) {
    container.textContent = "Sin entradas."
    return
  }
  for (const { text, onRemove } of rows) {
    const row = document.createElement("div")
    row.className = "backup-row"
    const label = document.createElement("span")
    label.textContent = text
    const remove = document.createElement("button")
    remove.className = "btn-ghost"
    remove.textContent = "Quitar"
    remove.addEventListener("click", onRemove)
    row.append(label, remove)
    container.append(row)
  }
}

async function refreshGiftConfig() {
  const rateList = document.getElementById("gift-rate-list")
  const ruleList = document.getElementById("gift-rule-list")
  if (!rateList || !ruleList) return
  const [rates, rules, mimics] = await Promise.all([
    ipcRenderer.invoke("gifts:listRates"),
    ipcRenderer.invoke("gifts:listRules"),
    // Sin canal todavia (primer arranque) no hay Mimics que listar.
    localStorage.getItem("mimiku_channel")
      ? ipcRenderer.invoke("mimics:list", localStorage.getItem("mimiku_channel")).catch(() => [])
      : Promise.resolve([]),
  ])
  renderRemovableRows(rateList, rates.map(rate => ({
    text: `${rate.platform} · ${rate.gift_id === "*" ? "general" : "regalo " + rate.gift_id}: ${rate.points_per_coin} pts por moneda`,
    onRemove: async () => { await ipcRenderer.invoke("gifts:removeRate", { platform: rate.platform, giftId: rate.gift_id }); await refreshGiftConfig() },
  })))
  renderRemovableRows(ruleList, rules.map(rule => ({
    text: `${rule.gift_id === "*" ? "Cualquier regalo" : "Regalo " + rule.gift_id} · mínimo ${rule.min_count} → ${rule.mimic_name}${rule.enabled ? "" : " (desactivada)"}`,
    onRemove: async () => { await ipcRenderer.invoke("gifts:removeRule", rule.id); await refreshGiftConfig() },
  })))
  const select = document.getElementById("gift-rule-mimic")
  select.replaceChildren(...mimics.map(mimic => {
    const option = document.createElement("option")
    option.value = mimic.id
    option.textContent = mimic.name
    return option
  }))
}

async function refreshRankConfig() {
  const list = document.getElementById("override-list")
  if (!list) return
  const [config, overrides] = await Promise.all([ipcRenderer.invoke("ranks:getConfig"), ipcRenderer.invoke("ranks:listOverrides")])
  document.getElementById("superfan-threshold").value = String(config.superfanThresholds?.tiktok || 0)
  renderRemovableRows(list, overrides.map(item => {
    const effect = item.effect === "grant" ? "Concede" : "Niega"
    const expiry = item.expires_at ? `caduca ${new Date(item.expires_at).toLocaleDateString()}` : "sin caducidad"
    const state = item.expired ? " (caducada)" : ""
    const reason = item.reason ? ` · motivo: ${item.reason}` : ""
    return {
      text: `${item.display} (${item.platform}) · ${effect} Superfan · ${expiry}${state} · por ${item.granted_by} el ${new Date(item.granted_at).toLocaleDateString()}${reason}`,
      onRemove: async () => { await ipcRenderer.invoke("ranks:removeOverride", item.id); await refreshRankConfig() },
    }
  }))
}

async function saveSuperfanThreshold() {
  const coins = Math.trunc(Number(document.getElementById("superfan-threshold").value))
  try {
    await ipcRenderer.invoke("ranks:setThreshold", { platform: "tiktok", coins })
    showToast(coins > 0 ? "Umbral de Superfan guardado" : "Superfan automático desactivado")
  } catch (error) {
    showToast("No se pudo guardar el umbral")
    console.error("[settings] ranks:setThreshold:", error.message)
  }
  await refreshRankConfig()
}

async function addRankOverride() {
  const username = document.getElementById("override-username").value.trim()
  if (!username) { showToast("Escribe el usuario"); return }
  try {
    await ipcRenderer.invoke("ranks:addOverride", {
      platform: "tiktok",
      username,
      rank: "superfan",
      effect: document.getElementById("override-effect").value,
      expiresAt: document.getElementById("override-expires").value,
      reason: document.getElementById("override-reason").value.trim(),
    })
    document.getElementById("override-username").value = ""
    document.getElementById("override-reason").value = ""
    showToast("Asignación guardada")
  } catch (error) {
    showToast("No se pudo guardar la asignación")
    console.error("[settings] ranks:addOverride:", error.message)
  }
  await refreshRankConfig()
}

async function saveGiftRate() {
  const giftId = document.getElementById("gift-rate-id").value.trim()
  const pointsPerCoin = Number(document.getElementById("gift-rate-value").value)
  try {
    await ipcRenderer.invoke("gifts:setRate", { platform: "tiktok", giftId, pointsPerCoin })
    showToast("Tasa guardada")
  } catch (error) {
    showToast("No se pudo guardar la tasa")
    console.error("[settings] gifts:setRate:", error.message)
  }
  await refreshGiftConfig()
}

async function saveGiftRule() {
  const mimicId = document.getElementById("gift-rule-mimic").value
  if (!mimicId) { showToast("Crea primero un Mimic"); return }
  try {
    await ipcRenderer.invoke("gifts:addRule", {
      platform: "tiktok",
      giftId: document.getElementById("gift-rule-id").value.trim(),
      minCount: Number(document.getElementById("gift-rule-min").value) || 1,
      mimicId,
    })
    showToast("Regla añadida")
  } catch (error) {
    showToast("No se pudo añadir la regla")
    console.error("[settings] gifts:addRule:", error.message)
  }
  await refreshGiftConfig()
}

async function runDiagnostics() {
  const report = await ipcRenderer.invoke("diagnostics:run")
  const list = document.getElementById("doctor-results")
  if (!list) return
  list.replaceChildren()
  for (const check of report.checks) {
    const row = document.createElement("div")
    row.className = `doctor-row ${check.ok ? "ok" : "warning"}`
    const label = document.createElement("strong")
    label.textContent = `${check.ok ? "✓" : "!"} ${check.label}`
    const detail = document.createElement("span")
    detail.textContent = check.detail
    row.append(label, detail)
    list.append(row)
  }
  showToast(report.ok ? "Diagnóstico completado: todo listo" : "Diagnóstico completado: revisa las advertencias")
}

async function exportDiagnostics() {
  const result = await ipcRenderer.invoke("diagnostics:export")
  if (!result.canceled) showToast("Diagnóstico exportado sin secretos")
}

async function simulateChatEvent() {
  const platform = document.getElementById("diagnostic-platform")?.value || "youtube"
  const text = document.getElementById("diagnostic-message")?.value.trim() || "hola desde Mimiku"
  const result = await ipcRenderer.invoke("diagnostics:simulateEvent", { platform, text })
  showToast(result.delivered ? `Evento ${platform} enviado al Event Engine` : "El evento de prueba fue descartado")
}

async function refreshBackups() {
  const list = document.getElementById("backup-list")
  if (!list) return
  const backups = await ipcRenderer.invoke("backups:list")
  list.replaceChildren()
  if (!backups.length) {
    const empty = document.createElement("span")
    empty.className = "field-hint"
    empty.textContent = "Aún no hay copias locales."
    list.append(empty)
    return
  }
  for (const backup of backups) {
    const row = document.createElement("div")
    row.className = "backup-row"
    const label = document.createElement("span")
    label.textContent = `${backup.name} · ${(backup.size / 1024).toFixed(0)} KB`
    const restore = document.createElement("button")
    restore.className = "btn-ghost"
    restore.textContent = "Restaurar al reiniciar"
    restore.addEventListener("click", () => restoreBackup(backup.name))
    row.append(label, restore)
    list.append(row)
  }
}

async function createBackup() {
  await ipcRenderer.invoke("backups:create")
  await refreshBackups()
  showToast("Copia local creada")
}

async function restoreBackup(name) {
  if (!window.confirm(`¿Restaurar ${name} al reiniciar? Mimiku conservará una copia del estado actual.`)) return
  await ipcRenderer.invoke("backups:restore", name)
  showToast("Restauración preparada. Reinicia Mimiku para aplicarla.")
}

async function saveAppProfile(completed = false) {
  const displayName = document.getElementById("streamer-display-name").value.trim()
  const twitchChannel = document.getElementById("channel").value.trim()
  const config = await ipcRenderer.invoke("config:save", {
    onboarding: { completed },
    streamer: { displayName, twitchChannel },
  })
  if (config.workspace?.id) localStorage.setItem("mimiku_channel", config.workspace.id)
  return config
}

async function saveSettings() {
  const channel = document.getElementById("channel").value.trim()
  const token   = document.getElementById("token").value.trim()
  const config = await saveAppProfile(true)
  if (token) await ipcRenderer.invoke("secrets:setTwitchToken", token)
  localStorage.removeItem("mimiku_token")
  if (!config.streamer.twitchChannel) {
    showToast("Perfil guardado. Twitch queda sin configurar.")
    return
  }
  await ipcRenderer.invoke("twitch:connect", { channel: config.streamer.twitchChannel, token })
  document.getElementById("token").value = ""
  showToast("Perfil guardado. Conectando a Twitch…")
}

async function completeOnboarding() {
  const displayName = document.getElementById("onboarding-display-name").value.trim()
  const twitchChannel = document.getElementById("onboarding-twitch-channel").value.trim()
  if (!displayName) {
    showToast("Completa tu nombre público")
    return
  }

  document.getElementById("streamer-display-name").value = displayName
  document.getElementById("channel").value = twitchChannel
  const config = await saveAppProfile(true)
  if (!config.onboarding.completed) {
    showToast("Revisa tu nombre público")
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
  refreshSsnStatus,
  detectSsn,
  connectSsn,
  disconnectSsn,
  connectTikTok,
  disconnectTikTok,
  saveGiftRate,
  saveGiftRule,
  saveSuperfanThreshold,
  addRankOverride,
  copySsnUrl,
  runDiagnostics,
  exportDiagnostics,
  simulateChatEvent,
  refreshBackups,
  createBackup,
  restoreBackup,
}
