const fs = require('fs')
let c = fs.readFileSync('main.cjs', 'utf8')

// El problema: function events() { return require(...) } recarga el módulo cada vez
// Cambiar a una variable singleton
c = c.replace(
  '// ── IPC: Panel de Eventos ─────────────────────────────────────────────────────\nfunction events() { return require("./src/services/events.js") }',
  '// ── IPC: Panel de Eventos ─────────────────────────────────────────────────────\nconst eventsService = require("./src/services/events.js")\nfunction events() { return eventsService }'
)

fs.writeFileSync('main.cjs', c)
console.log('fixed singleton:', c.includes('const eventsService'))
