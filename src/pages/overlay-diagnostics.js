// pages/overlay-diagnostics.js — panel de red del overlay (Ajustes)
const { ipcRenderer } = require("electron")

let probeResults = new Map()

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

function byId(id) { return document.getElementById(id) }

function renderStatus(status) {
  const el = byId("overlay-net-status")
  if (!el) return
  el.className = `doctor-row ${status.running ? "ok" : "warning"}`
  const title = document.createElement("strong")
  const detail = document.createElement("span")
  if (status.running) {
    const scope = status.host === "0.0.0.0" ? "todas las interfaces (red local)" : "solo este equipo"
    title.textContent = "Servidor arriba"
    detail.textContent = `Puerto ${status.httpPort} en ${status.host} - ${scope}. WebSocket: /ws en el mismo puerto`
      + (status.wsPort ? ` y puerto ${status.wsPort}.` : ".")
    if (status.wsError) detail.textContent += ` Aviso: ${status.wsError}`
  } else {
    title.textContent = "Servidor caído"
    detail.textContent = status.error || "El servidor local no está iniciado."
  }
  el.replaceChildren(title, detail)
}

function renderConfig(config) {
  byId("overlay-net-port").value = config.httpPort
  byId("overlay-net-ws-port").value = config.wsPort
  byId("overlay-net-lan").checked = config.allowLan
  byId("overlay-net-hostname").value = config.customHostname
}

async function copyUrl(url) {
  try {
    await navigator.clipboard.writeText(url)
    showToast("URL copiada al portapapeles")
  } catch {
    showToast("No se pudo copiar la URL")
  }
}

function probeBadge(result) {
  const badge = document.createElement("span")
  if (!result) {
    badge.textContent = "Sin probar"
    return badge
  }
  badge.style.color = result.ok ? "#4ade80" : "#f87171"
  badge.textContent = result.ok ? `Responde (${result.ms} ms)` : `No responde: ${result.error}`
  return badge
}

function renderUrls(urls) {
  const list = byId("overlay-net-urls")
  if (!list) return
  list.replaceChildren()
  for (const entry of urls) {
    const row = document.createElement("div")
    row.className = "doctor-row"
    const label = document.createElement("strong")
    label.textContent = entry.label
    const box = document.createElement("div")
    box.className = "url-box"
    const text = document.createElement("span")
    text.textContent = entry.url
    const copy = document.createElement("button")
    copy.textContent = "Copiar"
    copy.addEventListener("click", () => copyUrl(entry.url))
    box.append(text, copy)
    row.append(label, box, probeBadge(probeResults.get(entry.id)))
    list.append(row)
  }
}

function renderDiagnostics(data) {
  renderStatus(data.status)
  renderUrls(data.urls)
}

async function initOverlayDiagnostics() {
  const data = await ipcRenderer.invoke("overlay:getDiagnostics")
  renderConfig(data.config)
  renderDiagnostics(data)
}

async function refreshOverlayDiagnostics() {
  probeResults = new Map()
  renderDiagnostics(await ipcRenderer.invoke("overlay:getDiagnostics"))
}

async function saveOverlayConfig() {
  const input = {
    httpPort: byId("overlay-net-port").value,
    wsPort: byId("overlay-net-ws-port").value,
    allowLan: byId("overlay-net-lan").checked,
    customHostname: byId("overlay-net-hostname").value,
  }
  let result
  try {
    result = await ipcRenderer.invoke("overlay:saveConfig", input)
  } catch (error) {
    // Electron antepone "Error invoking remote method ..." al mensaje real.
    showToast(String(error.message || error).replace(/^.*Error: /, ""))
    return
  }
  probeResults = new Map()
  renderDiagnostics(result)
  // Si falló se conservan los valores escritos para que el usuario los corrija.
  if (!result.ok) {
    showToast(result.error)
    return
  }
  renderConfig(result.config)
  showToast("Overlay reiniciado. Actualiza la fuente de navegador si cambió el puerto.")
}

async function probeOverlayUrls() {
  const button = byId("overlay-net-probe")
  if (button) button.disabled = true
  try {
    const results = await ipcRenderer.invoke("overlay:probeUrls")
    probeResults = new Map(results.map(result => [result.id, result]))
    renderUrls((await ipcRenderer.invoke("overlay:getDiagnostics")).urls)
    const failed = results.filter(result => !result.ok).length
    showToast(failed ? `${failed} URL(s) no responden` : "Todas las URLs responden")
  } finally {
    if (button) button.disabled = false
  }
}

module.exports = { initOverlayDiagnostics, refreshOverlayDiagnostics, saveOverlayConfig, probeOverlayUrls }
