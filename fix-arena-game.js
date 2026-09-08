const fs = require('fs')
let c = fs.readFileSync('mod-panel/index.html', 'utf8')

// insertar la vista de juego dentro de #tab-arena, después de #arena-room
const gameView = `      <!-- juego en curso -->
      <div id="arena-game" style="display:none">
        <div class="ag-hud">
          <div class="ag-hud-item"><span class="ag-hud-label">Ronda</span><span id="ag-round" class="ag-hud-val">1</span></div>
          <div class="ag-hud-item"><span class="ag-hud-label">Vivos</span><span id="ag-alive" class="ag-hud-val">0</span></div>
          <div class="ag-hud-item"><span class="ag-hud-label">Categoría</span><span id="ag-cat" class="ag-hud-val">Libre</span></div>
        </div>

        <div class="ag-bomb-wrap">
          <div id="ag-bomb" class="ag-bomb">
            <div id="ag-timer" class="ag-timer">15</div>
          </div>
        </div>

        <div class="ag-letter-box">
          <span class="ag-letter-label">Palabra que empiece con</span>
          <span id="ag-letter" class="ag-letter">N</span>
        </div>
        <div id="ag-lastword" class="ag-lastword"></div>

        <div id="ag-turn-info" class="ag-turn-info"></div>

        <!-- input solo visible si es tu turno -->
        <div id="ag-input-row" class="ag-input-row" style="display:none">
          <input type="text" id="ag-word-input" placeholder="Escribe tu palabra…" autocomplete="off">
          <button class="btn-twitch" onclick="submitArenaWord()">Enviar 💥</button>
        </div>
        <div id="ag-wait-msg" class="ag-wait-msg"></div>
      </div>

      <!-- resultado final -->
      <div id="arena-result" style="display:none">
        <div class="ag-podium">
          <div class="ag-trophy">🏆</div>
          <div class="ag-winner-label">GANADOR</div>
          <div id="ag-winner-name" class="ag-winner-name"></div>
        </div>
        <button class="btn-twitch" onclick="loadArena()" style="margin-top:20px">↻ Volver al inicio</button>
      </div>
`

// lo insertamos justo antes del cierre de #arena-room... en realidad va como hermano dentro de #tab-arena
// lo ponemos después del div #arena-room (que cierra con </div> antes de </div> del tab)
c = c.replace(
  '        <div id="arena-lobby-players" class="arena-lobby-players"></div>\n      </div>\n    </div>',
  '        <div id="arena-lobby-players" class="arena-lobby-players"></div>\n      </div>\n\n' + gameView + '    </div>'
)

fs.writeFileSync('mod-panel/index.html', c)
console.log('game view added:', c.includes('id="arena-game"'))
