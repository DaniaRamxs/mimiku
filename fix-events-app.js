const fs = require('fs')
let c = fs.readFileSync('src/app.js', 'utf8')

c = c.replace(
  "const cardsPage = require('./pages/cards.js')",
  "const cardsPage  = require('./pages/cards.js')\nconst eventsPage = require('./pages/events-panel.js')"
)
c = c.replace(
  "window.cardsPage    = cardsPage",
  "window.cardsPage    = cardsPage\nwindow.eventsPage   = eventsPage"
)

// exponer ipcRenderer y showToast globalmente para los botones inline del HTML
c = c.replace(
  "window.minimize = () => ipcRenderer.invoke('app:minimize')",
  `window.ipcRenderer = ipcRenderer
window.minimize = () => ipcRenderer.invoke('app:minimize')`
)

// agregar función showToast global
c = c.replace(
  "window.showPage = showPage",
  `window.showPage = showPage
window.showToast = function(msg) {
  const t = document.getElementById("toast")
  if (!t) return
  t.textContent = msg; t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), 3000)
}`
)

c = c.replace(
  "  cardsPage.initCards()",
  "  cardsPage.initCards()\n  eventsPage.initEvents()"
)

fs.writeFileSync('src/app.js', c)
console.log('eventsPage added:', c.includes('eventsPage'))
