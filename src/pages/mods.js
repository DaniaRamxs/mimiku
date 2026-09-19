// pages/mods.js — Panel de moderadores (renderer)
const { ipcRenderer } = require("electron")
const { escapeHtml } = require("../core/html.js")

async function initMods() {
  await refreshModList()
  setInterval(refreshModList, 15000)
}

async function refreshModList() {
  const mods = await ipcRenderer.invoke("mods:getActive")
  const el   = document.getElementById("mod-list")
  if (!el) return
  if (!mods || !mods.length) {
    el.innerHTML = `<p class="empty">No hay mods conectados ahora.</p>`
    return
  }
  el.innerHTML = mods.map(m => `
    <div class="mod-row">
      <div class="mod-avatar">${(m.mod_display||m.mod_username)[0].toUpperCase()}</div>
      <div class="mod-info">
        <span class="mod-name">${escapeHtml(m.mod_display || m.mod_username)}</span>
        <span class="mod-since">${timeAgo(m.last_seen)}</span>
      </div>
      <span class="mod-badge">MOD</span>
    </div>`).join("")
}

function onModCommand(cmd) {
  const el = document.getElementById("mod-feed")
  if (!el) return
  const empty = el.querySelector(".empty")
  if (empty) empty.remove()

  const icons = { url:"🌐", text:"💬", image:"🖼", alert:"🔔" }
  const icon  = icons[cmd.type] || "📦"
  const preview = cmd.payload?.content
    ? cmd.payload.content.slice(0,60) + (cmd.payload.content.length>60?"…":"")
    : ""

  const row = document.createElement("div")
  row.className = "event"
  row.innerHTML = `
    <span class="event-type" style="background:rgba(124,110,245,.2);color:#7c6ef5">${icon} ${cmd.type}</span>
    <span style="flex:1;font-size:12px;color:#9898b0">${escapeHtml(cmd.mod_display || cmd.mod_username)}</span>
    <span style="font-size:12px;color:#55556a;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(preview)}</span>
  `
  el.prepend(row)
  if (el.children.length > 30) el.lastChild.remove()
}

async function clearWidgets() {
  await ipcRenderer.invoke("mods:clearWidgets")
  showToast("Overlay limpiado")
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60)   return `hace ${diff}s`
  if (diff < 3600) return `hace ${Math.floor(diff/60)}m`
  return `hace ${Math.floor(diff/3600)}h`
}

function showToast(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 2500)
}

module.exports = { initMods, refreshModList, onModCommand, clearWidgets }
