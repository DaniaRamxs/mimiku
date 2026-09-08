const fs = require('fs')
const c = fs.readFileSync('main.cjs', 'utf8')
console.log('evtSay:', c.includes('evtSay'))
console.log('events init:', c.includes('require("./src/services/events.js").init'))
// buscar la inicialización
const idx = c.indexOf('evtSay')
if (idx > -1) console.log('context:', c.substring(idx-50, idx+200))
