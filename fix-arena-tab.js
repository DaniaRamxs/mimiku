const fs = require('fs')
let c = fs.readFileSync('mod-panel/index.html', 'utf8')

const arenaTab = `    <!-- Arena -->
    <div id="tab-arena" class="ch-tab-content">
      <!-- sin sala activa -->
      <div id="arena-none" class="arena-none">
        <div class="arena-none-icon">🏟</div>
        <h2>No hay partida activa</h2>
        <p>Cuando el streamer cree una partida, aparecerá aquí para que te unas.</p>
        <button class="btn-twitch" onclick="loadArena()">↻ Buscar partida</button>
      </div>

      <!-- lobby -->
      <div id="arena-room" style="display:none">
        <div class="arena-room-banner">
          <div class="arena-game-icon">💣</div>
          <div>
            <div class="arena-game-name">Palabra Bomba</div>
            <div class="arena-room-meta">Sala <strong id="arena-code-display">-----</strong> · <span id="arena-cat-display">Libre</span></div>
          </div>
          <div id="arena-room-status" class="arena-room-status">EN LOBBY</div>
        </div>

        <!-- gate: necesita identidad -->
        <div id="arena-join-box" class="arena-join-box">
          <p class="arena-join-title">¡Únete a la partida!</p>
          <div id="arena-guest-row" style="display:none">
            <input type="text" id="arena-guest-name" placeholder="Tu nombre" maxlength="20">
            <button class="btn-twitch" onclick="joinArenaGuest()">Entrar como invitado</button>
          </div>
          <div id="arena-joined-msg" style="display:none" class="arena-joined-msg">✓ Estás en el lobby. Espera a que comience…</div>
        </div>

        <p class="section-label" style="margin-top:1.5rem">JUGADORES <span id="arena-count-badge">0</span></p>
        <div id="arena-lobby-players" class="arena-lobby-players"></div>
      </div>
    </div>

`

c = c.replace('    <!-- Moderar -->', arenaTab + '    <!-- Moderar -->')
fs.writeFileSync('mod-panel/index.html', c)
console.log('arena tab added:', c.includes('id="tab-arena"'))
