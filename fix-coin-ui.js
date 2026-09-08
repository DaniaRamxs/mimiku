const fs = require('fs')

// ── Cara o Cruz en index.html ──────────────────────────────────────────────────
let h = fs.readFileSync('src/index.html', 'utf8')

// Agregar card de cara o cruz en la games-grid
const coinCard = `
        <!-- Cara o Cruz -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">🪙 Cara o Cruz</span>
            <span class="game-badge active">Siempre activo</span>
          </div>
          <p class="desc">Los viewers apuestan puntos al azar — 50/50.</p>
          <ul class="feature-list" style="margin-bottom:1rem">
            <li><code>!moneda [apuesta]</code> — apostar puntos</li>
            <li>CARA — ganás el doble de tu apuesta</li>
            <li>CRUZ — perdés la apuesta</li>
            <li>Probabilidad exacta: 50/50</li>
          </ul>
          <div style="display:flex;gap:8px;font-size:32px;margin-bottom:1rem">
            <span title="Cara">🪙</span>
            <span title="Cruz">🟤</span>
          </div>
          <div style="margin-top:1rem">
            <p class="section-label">ÚLTIMAS TIRADAS</p>
            <div id="coin-feed" style="display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto">
              <p class="empty">Sin tiradas aún.</p>
            </div>
          </div>
        </div>

`

// Insertar antes del cierre de games-grid
h = h.replace(
  '      </div>\n    </div>\n\n    <!-- Economía -->',
  coinCard + '      </div>\n    </div>\n\n    <!-- Economía -->'
)

// Agregar botón Rey del Chat en Overlay page
h = h.replace(
  '      <div class="panel" style="max-width:560px">\n        <div class="panel-header"><span class="panel-title">Ticker</span></div>',
  `      <div class="panel" style="max-width:560px;margin-bottom:1rem">
        <div class="panel-header">
          <span class="panel-title">👑 Rey del Chat</span>
          <span id="king-badge-status" class="game-badge">Oculto</span>
        </div>
        <p class="desc">Muestra el viewer con más mensajes en el stream actual. Se actualiza automáticamente.</p>
        <button class="btn-primary" id="btn-king-toggle" onclick="window.overlayPage.toggleKing()">👁 Mostrar en overlay</button>
      </div>

      <div class="panel" style="max-width:560px">
        <div class="panel-header"><span class="panel-title">Ticker</span></div>`
)

fs.writeFileSync('src/index.html', h)
console.log('coin card:', h.includes('Cara o Cruz'))
console.log('king button:', h.includes('toggleKing'))
