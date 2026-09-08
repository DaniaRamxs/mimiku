const fs = require('fs')
let c = fs.readFileSync('src/app.js', 'utf8')

c = c.replace(
  "const eventsPage = require('./pages/events-panel.js')",
  "const eventsPage = require('./pages/events-panel.js')\nconst mimicsPage = require('./pages/mimics.js')"
)
c = c.replace(
  "window.eventsPage   = eventsPage",
  "window.eventsPage   = eventsPage\nwindow.mimicsPage   = mimicsPage"
)
c = c.replace(
  "  eventsPage.initEvents()",
  "  eventsPage.initEvents()\n  mimicsPage.initMimics()"
)
// cargar mimics al navegar
c = c.replace(
  '  if (id === "cards")   { cardsPage.loadCards(); cardsPage.loadPacks() }',
  '  if (id === "cards")   { cardsPage.loadCards(); cardsPage.loadPacks() }\n  if (id === "mimics")  { mimicsPage.loadMimics(); mimicsPage.loadBoxes() }'
)

fs.writeFileSync('src/app.js', c)
console.log('mimicsPage registered:', c.includes('window.mimicsPage'))
