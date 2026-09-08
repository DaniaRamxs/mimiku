const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Buscar y eliminar cards de Cara o Cruz en la sección de eventos
// La sección de eventos tiene botones con window.eventsPage
// Necesitamos encontrar la card de coin en eventos y quitarla

// Encontrar el bloque de events page
const evStart = c.indexOf('<!-- Panel de Eventos -->')
const evEnd   = c.indexOf('<!-- Cartas -->')

if (evStart === -1 || evEnd === -1) {
  console.log('ERROR: no encontré marcadores')
  process.exit(1)
}

const evSection = c.substring(evStart, evEnd)

// Contar cuántas veces aparece Cara o Cruz en la sección de eventos
const coinInEvents = (evSection.match(/Cara o Cruz|!moneda|toggleCoin|activateMuerte/g) || []).length
console.log('Coin references in events section:', coinInEvents)
console.log('Event section length:', evSection.length)

// Buscar el bloque de cara o cruz en eventos y eliminarlo
// El bloque empieza con una de estas variantes
const coinCardPatterns = [
  /\s*<div class="event-card">\s*<div class="event-card-header">\s*<span class="event-icon">🪙<\/span>[\s\S]*?<\/div>\s*<\/div>/,
  /\s*<div class="event-card">\s*<div class="event-card-header">\s*<span class="event-icon">🏛<\/span>[\s\S]*?toggleCoin[\s\S]*?<\/div>\s*<\/div>/,
]

let newEvSection = evSection
for (const pattern of coinCardPatterns) {
  newEvSection = newEvSection.replace(pattern, '')
}

c = c.substring(0, evStart) + newEvSection + c.substring(evEnd)

// Verificar que equilibrador está bien y funciona
console.log('Equilibrador present:', c.includes('activateEqualizer'))
console.log('Tax present:', c.includes('ev-tax-percent'))
console.log('Cara o Cruz in events after fix:', (c.substring(c.indexOf('Panel de Eventos'), c.indexOf('Cartas -->')).match(/Cara o Cruz/g)||[]).length)

fs.writeFileSync('src/index.html', c)
console.log('done')
