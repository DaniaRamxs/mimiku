const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Encontrar y eliminar la card de coin en eventos
// El botón tiene id="ev-coin-btn"
const coinCardStart = c.indexOf('id="ev-coin-btn"')
if (coinCardStart === -1) { console.log('coin btn not found'); process.exit(0) }

// Buscar el inicio del event-card que contiene este botón
let cardStart = c.lastIndexOf('<div class="event-card">', coinCardStart)
// Buscar el cierre del event-card
let depth = 0, i = cardStart
while (i < c.length) {
  if (c.substring(i, i+4) === '<div') depth++
  if (c.substring(i, i+6) === '</div>') { depth--; if (depth === 0) { i += 6; break } }
  i++
}
const cardEnd = i

console.log('Removing coin card from index', cardStart, 'to', cardEnd)
console.log('Content:', c.substring(cardStart, cardStart+100))

c = c.substring(0, cardStart) + c.substring(cardEnd)
fs.writeFileSync('src/index.html', c)
console.log('done, coin in events:', c.includes('ev-coin-btn'))
