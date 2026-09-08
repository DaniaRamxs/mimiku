const fs = require('fs')
let c = fs.readFileSync('src/services/economy.js', 'utf8')

c = c.replace(
  'function onMessage(username, display = "") {',
  'function onMessage(username, display = "", pointsPerMsg = 1) {'
)
c = c.replace(
  'return addPoints(username, 1, "chat")',
  'return addPoints(username, pointsPerMsg, "chat")'
)

fs.writeFileSync('src/services/economy.js', c)
console.log('fixed:', c.includes('pointsPerMsg'))
