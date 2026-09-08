const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')
c = c.replace(
  'background:rgba(10,10,15,.85);z-index:9995;',
  'background:transparent;z-index:9995;'
)
fs.writeFileSync('src/services/overlay.html', c)
console.log('fixed:', c.includes('background:transparent;z-index:9995;'))
