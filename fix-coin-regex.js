const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Eliminar todas las cards que contengan ev-coin-btn usando regex
c = c.replace(/<div class="event-card">[\s\S]*?id="ev-coin-btn"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g, '')

fs.writeFileSync('src/index.html', c)

const remaining = c.includes('ev-coin-btn')
console.log('coin remaining:', remaining)
if (remaining) {
  // buscar contexto
  const idx = c.indexOf('ev-coin-btn')
  console.log('context:', c.substring(idx-100, idx+100))
}
