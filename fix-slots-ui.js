const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const slotsCard = `
        <!-- Slots -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">🎰 Tragamonedas</span>
            <span class="game-badge active">Siempre activo</span>
          </div>
          <p class="desc">Los viewers giran los reels apostando puntos desde el chat.</p>
          <ul class="feature-list" style="margin-bottom:1rem">
            <li><code>!slots [apuesta]</code> — girar los reels</li>
            <li>Par (2 iguales) — paga 2x</li>
            <li>Jackpot (3 iguales) — paga 10x</li>
            <li>💎 o 7️⃣ triple — paga 20x</li>
          </ul>
          <div style="display:flex;gap:6px;margin-bottom:1rem">
            <div class="slots-demo-reel">🍒</div>
            <div class="slots-demo-reel">💎</div>
            <div class="slots-demo-reel">🍋</div>
          </div>
          <div style="margin-top:1rem">
            <p class="section-label">ÚLTIMAS TIRADAS</p>
            <div id="slots-feed" style="display:flex;flex-direction:column;gap:5px;max-height:200px;overflow-y:auto">
              <p class="empty">Sin tiradas aún.</p>
            </div>
          </div>
        </div>

`

c = c.replace('      </div>\n    </div>\n\n    <!-- Economía -->', slotsCard + '      </div>\n    </div>\n\n    <!-- Economía -->')

fs.writeFileSync('src/index.html', c)
console.log('slots card added:', c.includes('Tragamonedas'))
