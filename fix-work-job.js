const fs = require('fs')
let c = fs.readFileSync('src/services/economy.js', 'utf8')
c = c.replace(
  '{ job: "memeó en el chat",       min: 15, max: 50  }',
  '{ job: "lurkeó en el stream",    min: 15, max: 50  }'
)
fs.writeFileSync('src/services/economy.js', c)
console.log('fixed:', c.includes('lurkeó'))
