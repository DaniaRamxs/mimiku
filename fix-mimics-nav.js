const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Agregar nav item
c = c.replace(
  '<button class="nav-item" data-page="cards">🃏 Cartas</button>',
  '<button class="nav-item" data-page="cards">🃏 Cartas</button>\n    <button class="nav-item" data-page="mimics">✨ Mimics</button>'
)

console.log('nav added:', c.includes('data-page="mimics"'))
fs.writeFileSync('src/index.html', c)
