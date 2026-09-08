const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Agregar card de impuestos después de la card de equilibrador
const taxCard = `
          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">🏛</span>
              <div>
                <div class="event-name">Impuestos</div>
                <div class="event-desc">Cobra un % de puntos a todos los viewers</div>
              </div>
            </div>
            <div class="event-controls">
              <select id="ev-tax-percent" class="event-select">
                <option value="5">5%</option>
                <option value="10" selected>10%</option>
                <option value="15">15%</option>
                <option value="20">20%</option>
                <option value="50">50%</option>
              </select>
              <button class="btn-event danger" onclick="window.eventsPage.collectTax()">🏛 Cobrar</button>
            </div>
          </div>`

c = c.replace(
  `          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">👾</span>`,
  taxCard + `

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">👾</span>`
)

fs.writeFileSync('src/index.html', c)
console.log('tax card added:', c.includes('ev-tax-percent'))
