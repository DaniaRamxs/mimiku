const fs = require('fs')

// ── overlay.js — agregar toggleKing ──────────────────────────────────────────
let o = fs.readFileSync('src/pages/overlay.js', 'utf8')
const kingVisible = { value: false }

// Agregar función si no existe
if (!o.includes('toggleKing')) {
  o += `
async function toggleKing() {
  const { ipcRenderer } = require("electron")
  kingVisible.value = !kingVisible.value
  await ipcRenderer.invoke("king:toggle", kingVisible.value)
  const btn    = document.getElementById("btn-king-toggle")
  const badge  = document.getElementById("king-badge-status")
  if (btn)   btn.textContent   = kingVisible.value ? "👁 Ocultar del overlay" : "👁 Mostrar en overlay"
  if (badge) { badge.textContent = kingVisible.value ? "Activo" : "Oculto"; badge.className = kingVisible.value ? "game-badge active" : "game-badge" }
}

if (typeof module !== 'undefined') {
  const _exports = module.exports || {}
  _exports.toggleKing = toggleKing
  module.exports = _exports
}
`
  fs.writeFileSync('src/pages/overlay.js', o)
  console.log('toggleKing added to overlay.js')
} else {
  console.log('toggleKing already exists')
}

// ── games.js — agregar feed de moneda ────────────────────────────────────────
let g = fs.readFileSync('src/pages/games.js', 'utf8')

g = g.replace(
  "  ipcRenderer.on('game:slots', (_, data) => addSlotsEvent(data))",
  "  ipcRenderer.on('game:slots', (_, data) => addSlotsEvent(data))\n  ipcRenderer.on('game:coin',  (_, data) => addCoinEvent(data))"
)

g = g.replace(
  'module.exports = { initGames, toggleBj }',
  `function addCoinEvent(data) {
  const feed = document.getElementById("coin-feed")
  if (!feed) return
  const empty = feed.querySelector(".empty")
  if (empty) empty.remove()
  const el = document.createElement("div")
  el.className = "game-event"
  el.innerHTML = \`
    <span class="game-event-icon">\${data.win ? "🪙" : "🟤"}</span>
    <span style="flex:1;font-size:12px">\${data.display||data.username}</span>
    <span style="font-size:11px;color:var(--text-muted)">\${data.side}</span>
    <span style="color:\${data.win ? "var(--success)" : "var(--danger)"};font-weight:600;font-size:12px">\${data.win ? "+" : "-"}\${data.amount}</span>
  \`
  feed.prepend(el)
  if (feed.children.length > 20) feed.lastChild.remove()
}

module.exports = { initGames, toggleBj }`
)

fs.writeFileSync('src/pages/games.js', g)
console.log('coin feed:', g.includes('addCoinEvent'))
