const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

c = c.replace(
  '"top:30%",',
  '"top:60%",'
)

fs.writeFileSync('src/services/overlay.html', c)
console.log('fixed:', c.includes('"top:60%"'))
