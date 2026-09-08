const fs = require('fs')
let c = fs.readFileSync('src/services/events.js', 'utf8')

c = c.replace(
  '  taxEveryone,',
  '  taxEveryone,\n  collectTax: taxEveryone,'
)

fs.writeFileSync('src/services/events.js', c)

// verificar
delete require.cache[require.resolve('./src/services/events.js')]
const e = require('./src/services/events.js')
console.log('collectTax:', typeof e.collectTax)
console.log('taxEveryone:', typeof e.taxEveryone)
