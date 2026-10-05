// pages/canje.js — Ajustes de la página de canje para viewers (servidor propio + ngrok).
const { ipcRenderer } = require("electron")

function el(id) { return document.getElementById(id) }

function render(settings) {
  el("canje-enabled").checked = settings.enabled
  el("canje-client-id").value = settings.clientId || ""
  el("canje-public-url").value = settings.publicUrl || ""
  el("canje-port").value = settings.port
  el("canje-redirect").textContent = settings.redirectUrl || "Guarda tu dirección de ngrok"
  el("canje-ngrok").textContent = settings.ngrokCommand
  el("canje-link").textContent = settings.link || "Guarda tu dirección de ngrok"
  const status = settings.status
  el("canje-status").textContent = !settings.enabled ? "Desactivada"
    : status.error ? `No está funcionando: ${status.error}`
      : status.running ? `Funcionando en este equipo (puerto ${status.port}). Falta que ngrok esté abierto para que se vea desde internet.`
        : "Detenida"
}

// ── Pase de batalla ─────────────────────────────────────────────────────────
const PASS_REASONS = {
  "season-active": "Ya hay una temporada activa. Termínala antes de empezar otra.",
  "bad-name": "Ponle un nombre a la temporada.",
  "bad-weeks": "La duración va de 1 a 26 semanas.",
  "no-season": "No hay ninguna temporada activa.",
  gone: "Ese premio ya estaba marcado.",
}

function passDate(iso) {
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "long" })
}

function renderPending(pending) {
  const box = el("pass-pending")
  if (!box) return
  box.textContent = ""
  if (!pending.length) { box.textContent = "Ninguno."; return }
  for (const item of pending) {
    const row = document.createElement("div")
    row.className = "doctor-row"
    row.style.cssText = "display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:6px"
    const text = document.createElement("span")
    text.textContent = `${item.viewer} (${item.platform}) · ${item.season}, nivel ${item.level}: ${item.items.join(", ")}`
    const button = document.createElement("button")
    button.className = "btn-ghost"
    button.style.cssText = "width:auto;padding:6px 12px"
    button.textContent = "Entregado"
    button.addEventListener("click", () => markDelivered(item))
    row.appendChild(text)
    row.appendChild(button)
    box.appendChild(row)
  }
}

async function refreshPass() {
  const status = el("pass-status")
  if (!status) return
  const summary = await ipcRenderer.invoke("battlePass:summary")
  el("pass-xp").value = summary.config.xpPerLevel
  el("pass-price").value = summary.config.premiumPrice
  el("pass-mission-xp").value = summary.config.missionXp
  el("pass-reroll-price").value = summary.config.missionRerollPrice
  const season = summary.season
  status.textContent = !season
    ? "Todavía no has empezado ninguna temporada."
    : season.active
      ? `Temporada activa: ${season.name} (hasta el ${passDate(season.endsAt)}). ${summary.players} viewers con progreso, ${summary.premiumPlayers} con premium.`
      : `Última temporada: ${season.name}, terminó el ${passDate(season.endsAt)}. Empieza otra cuando quieras.`
  renderPending(summary.pending)
}

async function savePass() {
  try {
    await ipcRenderer.invoke("battlePass:setConfig", {
      xpPerLevel: Number(el("pass-xp").value), premiumPrice: Number(el("pass-price").value), missionXp: Number(el("pass-mission-xp").value),
      missionRerollPrice: Number(el("pass-reroll-price").value),
    })
    showToast("Pase de batalla guardado")
    await refreshPass()
  } catch (error) {
    showToast("No se pudo guardar: " + error.message)
  }
}

async function startSeason() {
  const result = await ipcRenderer.invoke("battlePass:startSeason", { name: el("pass-season-name").value, weeks: Number(el("pass-season-weeks").value || 5) })
  showToast(result.ok ? `Temporada "${result.season.name}" empezada` : PASS_REASONS[result.reason] || "No se pudo empezar")
  await refreshPass()
}

async function endSeason() {
  if (!confirm("¿Terminar la temporada ahora? El progreso de esta temporada deja de contar.")) return
  const result = await ipcRenderer.invoke("battlePass:endSeason")
  showToast(result.ok ? "Temporada terminada" : PASS_REASONS[result.reason] || "No se pudo terminar")
  await refreshPass()
}

async function markDelivered(item) {
  const result = await ipcRenderer.invoke("battlePass:markDelivered", { seasonId: item.seasonId, viewerId: item.viewerId, level: item.level, track: item.track })
  showToast(result.ok ? `Marcado como entregado a ${item.viewer}` : PASS_REASONS[result.reason] || "No se pudo marcar")
  await refreshPass()
}

async function refreshSubPassBox() {
  const select = el("sub-pass-box")
  if (!select) return
  const config = await ipcRenderer.invoke("subPass:getConfig")
  select.textContent = ""
  if (!config.boxes.length) select.appendChild(new Option("No hay cofres creados (se dan tiradas a cambio)", ""))
  for (const box of config.boxes) select.appendChild(new Option(box.name, box.id, false, box.id === config.boxId))
  el("sub-pass-bonus-price").value = config.bonusPrice
}

async function saveSubPassBox() {
  try {
    const input = { bonusPrice: Number(el("sub-pass-bonus-price").value) }
    if (el("sub-pass-box").value) input.boxId = el("sub-pass-box").value
    const config = await ipcRenderer.invoke("subPass:setConfig", input)
    showToast(config.boxName ? `Pase Sub guardado (regala cofres "${config.boxName}")` : "Pase Sub guardado")
  } catch (error) {
    showToast("No se pudo guardar: " + error.message)
  }
}

// ── Apoyo al proyecto (pestana Top de la pagina) ────────────────────────────
const SUPPORT_REASONS = {
  "bad-amount": "Escribe cuántos dólares aportó (por ejemplo 2 o 2.50).",
  "bad-platform": "Elige una plataforma.",
  "unknown-viewer": "Mimiku no conoce a ese usuario en esa plataforma: tiene que haber escrito alguna vez en el chat.",
  gone: "Ese aporte ya estaba deshecho.",
  spent: "Ese viewer ya gastó los puntos del aporte: no se puede deshacer.",
}
let supportPointsPerUsd = 500000

function formatUsd(value) {
  return Number(value).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " USD"
}

function renderSupportList(donations) {
  const box = el("support-list")
  box.textContent = ""
  if (!donations.length) { box.textContent = "Ninguno."; return }
  for (const item of donations) {
    const row = document.createElement("div")
    row.className = "doctor-row"
    row.style.cssText = "display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:6px"
    const text = document.createElement("span")
    const when = new Date(String(item.at).replace(" ", "T") + "Z").toLocaleDateString("es", { day: "numeric", month: "short" })
    text.textContent = `${item.viewer} (${item.platform}) · ${formatUsd(item.amountUsd)} · ${item.points.toLocaleString("es")} pts · ${when}${item.note ? " · " + item.note : ""}`
    const button = document.createElement("button")
    button.className = "btn-ghost"
    button.style.cssText = "width:auto;padding:6px 12px"
    button.textContent = "Deshacer"
    button.addEventListener("click", () => undoSupport(item))
    row.appendChild(text)
    row.appendChild(button)
    box.appendChild(row)
  }
}

function previewSupport() {
  const amount = Number(el("support-amount").value)
  el("support-preview").textContent = amount > 0
    ? `Recibirá ${Math.floor(Math.round(amount * 100) * supportPointsPerUsd / 100).toLocaleString("es")} puntos.`
    : ""
}

async function refreshSupport() {
  if (!el("support-tip-url")) return
  const config = await ipcRenderer.invoke("support:getConfig")
  supportPointsPerUsd = config.pointsPerUsd
  el("support-tip-url").value = config.tipUrl
  el("support-points").value = config.pointsPerUsd
  el("support-amount").oninput = previewSupport
  previewSupport()
  renderSupportList(await ipcRenderer.invoke("support:listDonations"))
}

async function saveSupport() {
  try {
    await ipcRenderer.invoke("support:setConfig", { tipUrl: el("support-tip-url").value.trim(), pointsPerUsd: Number(el("support-points").value || 500000) })
    showToast("Apoyo guardado")
    await refreshSupport()
  } catch (error) {
    showToast(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))
  }
}

async function registerSupport() {
  try {
    const result = await ipcRenderer.invoke("support:register", {
      username: el("support-username").value, platform: el("support-platform").value,
      amount: Number(el("support-amount").value), note: el("support-note").value,
    })
    if (!result.ok) { showToast(SUPPORT_REASONS[result.reason] || "No se pudo apuntar"); return }
    const { donation } = result
    showToast(`${donation.viewer} recibió ${donation.points.toLocaleString("es")} puntos por ${formatUsd(donation.amountUsd)}`)
    el("support-username").value = ""
    el("support-amount").value = ""
    el("support-note").value = ""
    await refreshSupport()
  } catch (error) {
    showToast(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))
  }
}

async function undoSupport(item) {
  if (!confirm(`¿Deshacer el aporte de ${item.viewer} (${formatUsd(item.amountUsd)})? Se le quitan ${item.points.toLocaleString("es")} puntos.`)) return
  const result = await ipcRenderer.invoke("support:undo", item.id)
  showToast(result.ok ? "Aporte deshecho" : SUPPORT_REASONS[result.reason] || "No se pudo deshacer")
  await refreshSupport()
}

// ── StreamElements: propinas automaticas ────────────────────────────────────
const SE_REASONS = {
  "unknown-viewer": "nadie del chat se llama así",
  currency: "no es en dólares",
  "need-usd": "Escribe a cuántos dólares equivale.",
  gone: "Esa propina ya no está pendiente.",
}
let seTimer = null

function seStatusText(status) {
  if (!status.configured) return "Sin conectar. Pega tu token para que las propinas se apunten solas."
  if (status.error) return "Error: " + status.error
  if (!status.connected) return "Conectando con StreamElements…"
  const last = status.lastTipAt ? " Última propina: " + new Date(status.lastTipAt).toLocaleString("es") + "." : ""
  return "Conectado: las propinas nuevas se apuntan solas." + last + (status.pending ? ` ${status.pending} pendiente(s) de asignar.` : "")
}

function renderSePending(list) {
  const box = el("se-pending")
  box.textContent = ""
  for (const tip of list) {
    const row = document.createElement("div")
    row.className = "doctor-row"
    row.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px"
    const text = document.createElement("span")
    text.style.flex = "1 1 220px"
    text.textContent = `${tip.name || "Sin nombre"} · ${tip.amount.toLocaleString("es", { minimumFractionDigits: 2 })} ${tip.currency}${tip.message ? " · “" + tip.message + "”" : ""} (${SE_REASONS[tip.reason] || "pendiente"})`
    const user = document.createElement("input")
    user.type = "text"
    user.placeholder = "usuario del chat"
    user.value = String(tip.name || "").toLowerCase()
    user.style.cssText = "width:150px"
    row.appendChild(text)
    row.appendChild(user)
    let usd = null
    if (tip.currency !== "USD") {
      usd = document.createElement("input")
      usd.type = "number"
      usd.min = "0.01"
      usd.step = "0.01"
      usd.placeholder = "USD"
      usd.style.cssText = "width:80px"
      row.appendChild(usd)
    }
    const assign = document.createElement("button")
    assign.className = "btn-primary"
    assign.style.cssText = "width:auto;padding:6px 12px"
    assign.textContent = "Asignar"
    assign.addEventListener("click", async () => {
      const result = await ipcRenderer.invoke("se:assign", { id: tip.id, username: user.value, platform: "twitch", amountUsd: usd ? usd.value : null })
      if (!result.ok) { showToast(SE_REASONS[result.reason] || SUPPORT_REASONS[result.reason] || "No se pudo asignar"); return }
      showToast(`${result.donation.viewer} recibió ${result.donation.points.toLocaleString("es")} puntos`)
      refreshSupport()
    })
    const drop = document.createElement("button")
    drop.className = "btn-ghost"
    drop.style.cssText = "width:auto;padding:6px 12px"
    drop.textContent = "Descartar"
    drop.addEventListener("click", async () => {
      if (!confirm("¿Descartar esta propina? No sumará al top ni dará puntos.")) return
      await ipcRenderer.invoke("se:dismiss", tip.id)
      refreshSupport()
    })
    row.appendChild(assign)
    row.appendChild(drop)
    box.appendChild(row)
  }
}

async function refreshStreamElements() {
  if (!el("se-status")) return
  const status = await ipcRenderer.invoke("se:status")
  el("se-status").textContent = seStatusText(status)
  renderSePending(await ipcRenderer.invoke("se:pending"))
  // Mientras el panel este abierto, el estado y las pendientes se refrescan solos.
  clearTimeout(seTimer)
  seTimer = setTimeout(() => {
    if (!el("se-status") || !el("se-status").offsetParent) return
    refreshStreamElements().catch(() => {})
    ipcRenderer.invoke("support:listDonations").then(renderSupportList).catch(() => {})
  }, 15000)
}

async function saveSeToken() {
  try {
    const status = await ipcRenderer.invoke("se:setToken", el("se-token").value.trim())
    el("se-token").value = ""
    showToast(status.error ? status.error : "StreamElements conectado")
    setTimeout(() => refreshStreamElements().catch(() => {}), 2500)
    await refreshStreamElements()
  } catch (error) {
    showToast(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))
  }
}

async function clearSeToken() {
  if (!confirm("¿Quitar el token? Las propinas dejarán de apuntarse solas.")) return
  await ipcRenderer.invoke("se:setToken", "")
  showToast("StreamElements desconectado")
  await refreshStreamElements()
}

async function refreshCanje() {
  refreshPass().catch(error => console.error("[pase]", error.message))
  refreshSupport().catch(error => console.error("[apoyo]", error.message))
  refreshStreamElements().catch(error => console.error("[streamelements]", error.message))
  refreshSubPassBox().catch(error => console.error("[pase sub]", error.message))
  if (!el("canje-enabled")) return
  render(await ipcRenderer.invoke("canje:getSettings"))
}

async function saveCanje() {
  try {
    render(await ipcRenderer.invoke("canje:saveSettings", {
      enabled: el("canje-enabled").checked,
      clientId: el("canje-client-id").value.trim(),
      publicUrl: el("canje-public-url").value.trim(),
      port: Number(el("canje-port").value || 7780),
    }))
    showToast("Página de canje guardada")
  } catch (error) {
    showToast(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""))
  }
}

// Para probar sin ngrok. El login de Twitch solo funciona por la dirección pública.
function openLocal() {
  ipcRenderer.invoke("canje:openLocal")
}

function copyFrom(id) {
  const text = el(id).textContent
  if (!text || text.startsWith("Guarda")) return
  navigator.clipboard.writeText(text)
  showToast("Copiado")
}

function showToast(msg) {
  const t = el("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}

module.exports = { refreshCanje, saveCanje, openLocal, copyFrom, savePass, startSeason, endSeason, saveSubPassBox, saveSupport, registerSupport, saveSeToken, clearSeToken }
