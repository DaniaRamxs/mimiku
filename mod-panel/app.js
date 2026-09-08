// Panel local-first. Toda mutación pasa por la API autoritativa de Mimiku Desktop.
const API_TOKEN = document.querySelector('meta[name="mimiku-api-token"]')?.content || ""
const state = { currentChannel: null, identity: null, activeType: "url", widgets: {} }

async function api(path, options = {}) {
  const headers = { "x-mimiku-token": API_TOKEN, ...(options.headers || {}) }
  if (options.body && typeof options.body !== "string") {
    headers["content-type"] = "application/json"
    options.body = JSON.stringify(options.body)
  }
  const response = await fetch(`/api/v1${path}`, { ...options, headers })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Error ${response.status}`)
  return result
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

window.addEventListener("load", async () => {
  if (!API_TOKEN) { showToast("Abre este panel desde Mimiku Desktop"); return }
  try {
    const status = await api("/status")
    state.currentChannel = status.channel
    renderChannels([{ id: status.channel, display: status.channel }])
  } catch (error) { showToast(error.message) }
  document.querySelectorAll(".ch-tab").forEach(button => button.addEventListener("click", () => switchChTab(button.dataset.tab)))
})

function renderChannels(channels) {
  const grid = document.getElementById("channels-grid")
  grid.innerHTML = channels.map(item => `<button class="channel-card" onclick="openChannel('${escapeHtml(item.id)}')">
    <div class="channel-card-avatar">${escapeHtml((item.display || item.id)[0].toUpperCase())}</div>
    <div class="channel-card-name">${escapeHtml(item.display || item.id)}</div>
    <div class="channel-card-handle">Local · /${escapeHtml(item.id)}</div>
  </button>`).join("")
}

function filterChannels(query) {
  const channel = state.currentChannel || ""
  renderChannels(!query || channel.includes(query.toLowerCase()) ? [{ id: channel, display: channel }] : [])
}

function openChannel(channelId, tab = "overview") {
  state.currentChannel = channelId
  document.getElementById("home-screen").style.display = "none"
  const screen = document.getElementById("channel-screen")
  screen.style.display = ""
  screen.classList.add("visible")
  document.getElementById("ch-avatar").textContent = channelId[0].toUpperCase()
  document.getElementById("ch-topbar-name").textContent = channelId
  switchChTab(tab)
}

function openChannelTab(id, tab) { openChannel(id, tab) }
function goHome() {
  document.getElementById("home-screen").style.display = "block"
  document.getElementById("channel-screen").classList.remove("visible")
}

function switchChTab(tab) {
  document.querySelectorAll(".ch-tab").forEach(button => button.classList.toggle("active", button.dataset.tab === tab))
  document.querySelectorAll(".ch-tab-content").forEach(content => { content.style.display = content.id === `tab-${tab}` ? "block" : "none" })
  const loaders = { overview: loadOverview, economy: loadEconomy, profile: loadProfile, collection: loadCollection, mimics: loadViewerMimics, shop: loadShop, arena: loadArena, mod: initModTab }
  loaders[tab]?.()
}

async function loadOverview() {
  try {
    const data = await api(`/overview?channel=${encodeURIComponent(state.currentChannel)}`)
    document.getElementById("ov-viewers").textContent = data.viewers
    document.getElementById("ov-points").textContent = Number(data.points).toLocaleString()
    document.getElementById("ov-events").textContent = "local"
    document.getElementById("ov-mods").textContent = "0"
    document.getElementById("ov-ranking").innerHTML = data.ranking.length
      ? data.ranking.map((viewer, index) => `<div class="ov-row"><span>${index + 1}</span><span class="ov-name">${escapeHtml(viewer.display || viewer.username)}</span><span>${viewer.balance.toLocaleString()}</span></div>`).join("")
      : '<p class="empty-small">Sin datos.</p>'
    document.getElementById("ov-activity").innerHTML = '<p class="empty-small">El ledger se gestiona localmente en Mimiku Desktop.</p>'
  } catch (error) { showToast(error.message) }
}

function setIdentity(identity) {
  state.identity = identity
  const chip = document.getElementById("viewer-chip")
  if (chip) chip.style.display = identity ? "flex" : "none"
  const name = document.getElementById("viewer-chip-name")
  if (name && identity) name.textContent = `@${identity.username}`
  const button = document.getElementById("btn-login-viewer")
  if (button) button.style.display = identity ? "none" : "flex"
}

function loginViewer() {
  showToast("El OAuth seguro con un botón se implementará en la siguiente fase. No se solicita Client Secret.")
}
function logoutViewer() { setIdentity(null); showToast("Sesión local cerrada") }

function showViewerGate(prefix) {
  const gate = document.getElementById(`${prefix}-login-gate`)
  const content = document.getElementById(`${prefix}-content`)
  if (gate) gate.style.display = state.identity ? "none" : "flex"
  if (content) content.style.display = state.identity ? "block" : "none"
  return !!state.identity
}

function loadProfile() { showViewerGate("profile") }
function loadCollection() { showViewerGate("collection") }

async function loadViewerMimics() {
  if (!showViewerGate("mimics")) return
  try {
    const data = await api(`/mimics?channel=${encodeURIComponent(state.currentChannel)}`)
    document.getElementById("viewer-mimics-grid").innerHTML = data.mimics.map(item => `<div class="mimic-inv-card"><span>${escapeHtml(item.icon)}</span><strong>${escapeHtml(item.name)}</strong></div>`).join("") || '<p class="empty-small">Sin Mimics.</p>'
  } catch (error) { showToast(error.message) }
}

async function useMimic(mimicId) {
  if (!state.identity) return loginViewer()
  try {
    await api("/mimics/use", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: { identity: state.identity, mimicId } })
    showToast("Mimic enviado")
  } catch (error) { showToast(error.message) }
}

async function loadShop() {
  const canBuy = showViewerGate("shop")
  try {
    const { items } = await api(`/shop?channel=${encodeURIComponent(state.currentChannel)}`)
    document.getElementById("packs-grid").innerHTML = items.map(item => `<div class="pack-card"><strong>${escapeHtml(item.name)}</strong><span>${item.price} pts</span><button ${canBuy ? "" : "disabled"} onclick="buyShopItem('${escapeHtml(item.id)}')">Comprar</button></div>`).join("") || '<p class="empty-small">La tienda aún no tiene items.</p>'
    document.getElementById("mimic-boxes-grid").innerHTML = ""
    document.getElementById("cosmetics-grid").innerHTML = ""
  } catch (error) { showToast(error.message) }
}

async function buyShopItem(itemId) {
  if (!state.identity) return loginViewer()
  try {
    await api("/shop/purchase", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: { identity: state.identity, itemId } })
    showToast("Compra completada localmente")
  } catch (error) { showToast(error.message) }
}

async function loadEconomy() {
  try {
    const data = await api(`/overview?channel=${encodeURIComponent(state.currentChannel)}`)
    document.getElementById("eco-ranking").innerHTML = data.ranking.map((viewer, index) => `<div class="eco-rank-row"><span>${index + 1}</span><span>${escapeHtml(viewer.display || viewer.username)}</span><strong>${viewer.balance}</strong></div>`).join("") || '<p class="empty-small">Sin datos.</p>'
    document.getElementById("eco-log").innerHTML = '<p class="empty-small">Ledger local protegido por transacciones SQLite.</p>'
  } catch (error) { showToast(error.message) }
}

function guestIdentity() {
  const name = document.getElementById("arena-guest-name")?.value.trim()
  if (!name) throw new Error("Escribe tu nombre")
  let id = sessionStorage.getItem("mimiku_guest_id")
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("mimiku_guest_id", id) }
  return { platform: "guest", platformUserId: id, username: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"), display: name }
}

async function loadArena() {
  try {
    const { room } = await api("/arena")
    document.getElementById("arena-none").style.display = room ? "none" : "block"
    document.getElementById("arena-room").style.display = room ? "block" : "none"
    if (room) {
      document.getElementById("arena-code-display").textContent = room.code
      document.getElementById("arena-room-status").textContent = String(room.status).toUpperCase()
      document.getElementById("arena-count-badge").textContent = room.players?.length || 0
      document.getElementById("arena-lobby-players").innerHTML = (room.players || []).map(player => `<div class="arena-player-chip">${escapeHtml(player.display || player.username)}</div>`).join("")
    }
  } catch (error) { showToast(error.message) }
}
function joinArenaTwitch() { return loginViewer() }
function joinArenaGuest() {
  const row = document.getElementById("arena-guest-row")
  if (row && row.style.display === "none") { row.style.display = "flex"; return }
  doArenaJoin(guestIdentity())
}
async function doArenaJoin(identity) {
  try {
    const { player } = await api("/arena/join", { method: "POST", body: { identity } })
    setIdentity(identity)
    document.getElementById("arena-joined-msg").style.display = "block"
    showToast(`${player.display} entró a la Arena`)
  } catch (error) { showToast(error.message) }
}
async function submitArenaWord() {
  if (!state.identity) return
  const input = document.getElementById("ag-word-input")
  try { await api("/arena/move", { method: "POST", body: { identity: state.identity, word: input.value } }); input.value = "" }
  catch (error) { showToast(error.message) }
}

function loginMod() { showModPanel() }
function logoutMod() {
  document.getElementById("mod-login-gate").style.display = "flex"
  document.getElementById("mod-panel-inner").style.display = "none"
}
function initModTab() { logoutMod() }
async function showModPanel() {
  document.getElementById("mod-login-gate").style.display = "none"
  document.getElementById("mod-panel-inner").style.display = "block"
  document.getElementById("mod-user-name").textContent = "Panel local del streamer"
  const { widgets } = await api(`/widgets?channel=${encodeURIComponent(state.currentChannel)}`)
  document.getElementById("widget-list").innerHTML = widgets.map(item => `<div>${escapeHtml(item.type)} · ${escapeHtml(item.content)}</div>`).join("") || '<p class="empty-small">Vacío</p>'
}
function selectType(type, button) {
  state.activeType = type
  document.querySelectorAll(".type-btn").forEach(item => item.classList.remove("active"))
  button?.classList.add("active")
  document.querySelectorAll(".input-block").forEach(item => { item.style.display = item.id === `input-${type}` ? "block" : "none" })
}
async function sendToOverlay() {
  const fields = { url: "content-url", text: "content-text", image: "content-image", alert: "content-alert" }
  const content = document.getElementById(fields[state.activeType])?.value || ""
  try {
    await api("/commands", { method: "POST", body: { type: state.activeType === "alert" ? "alert" : "widget_add", payload: { content, text: content, duration: 5000 } } })
    showToast("Enviado al overlay local")
  } catch (error) { showToast(error.message) }
}

function closePackModal() { document.getElementById("pack-modal").style.display = "none" }
function saveWebOnboarding() {}
function showToast(message) {
  const toast = document.getElementById("toast")
  if (!toast) return
  toast.textContent = message
  toast.classList.add("show")
  setTimeout(() => toast.classList.remove("show"), 3500)
}
