const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Agregar nav item antes de Cartas
c = c.replace(
  '    <button class="nav-item" data-page="cards">🃏 Cartas</button>',
  '    <button class="nav-item" data-page="events">⚡ Eventos</button>\n    <button class="nav-item" data-page="cards">🃏 Cartas</button>'
)

// Agregar página de eventos antes de Cartas
const eventsPage = `
    <!-- Panel de Eventos -->
    <div id="events" class="page">
      <div class="page-header"><h1>Panel de Eventos</h1></div>

      <div class="events-grid">

        <!-- ECONOMÍA -->
        <div class="events-section">
          <p class="section-title">💰 Economía</p>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">🎉</span>
              <div>
                <div class="event-name">Lluvia de puntos</div>
                <div class="event-desc">Todos los viewers reciben puntos</div>
              </div>
            </div>
            <div class="event-controls">
              <input id="ev-rain-amount" type="number" value="100" min="1" max="9999" placeholder="Cantidad">
              <button class="btn-event" onclick="window.eventsPage.rainPoints()">🎉 Activar</button>
            </div>
          </div>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">💸</span>
              <div>
                <div class="event-name">Regalar 500 pts</div>
                <div class="event-desc">500 puntos para todos los viewers</div>
              </div>
            </div>
            <button class="btn-event" onclick="ipcRenderer.invoke('events:gift500').then(()=>showToast('💸 ¡500 pts para todos!'))">💸 Activar</button>
          </div>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">🔥</span>
              <div>
                <div class="event-name">Multiplicador</div>
                <div class="event-desc">Multiplica puntos ganados por X tiempo</div>
              </div>
              <span id="ev-mult-badge" class="event-badge">Inactivo</span>
            </div>
            <div class="event-controls">
              <select id="ev-mult-value" class="event-select">
                <option value="2">x2</option>
                <option value="3">x3</option>
                <option value="5">x5</option>
              </select>
              <input id="ev-mult-mins" type="number" value="5" min="1" max="60" placeholder="Minutos">
              <button class="btn-event" onclick="window.eventsPage.activateMultiplier()">🔥 Activar</button>
            </div>
          </div>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">🧲</span>
              <div>
                <div class="event-name">Equilibrador</div>
                <div class="event-desc">El viewer con menos puntos recibe un boost</div>
              </div>
            </div>
            <button class="btn-event" onclick="ipcRenderer.invoke('events:equalizer', 5).then(()=>showToast('🧲 ¡Equilibrador activado!'))">🧲 Activar</button>
          </div>
        </div>

        <!-- JUEGOS -->
        <div class="events-section">
          <p class="section-title">🎮 Juegos</p>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">👾</span>
              <div>
                <div class="event-name">Invocar Boss</div>
                <div class="event-desc">Minijuego colectivo — viewers usan !atacar</div>
              </div>
              <span id="ev-boss-badge" class="event-badge">Sin boss</span>
            </div>
            <div id="ev-boss-bar" class="event-progress" style="display:none">
              <div class="event-progress-fill" style="background:var(--danger)"></div>
            </div>
            <div class="event-controls">
              <input id="ev-boss-hp" type="number" value="5000" min="100" placeholder="HP del boss">
              <button class="btn-event danger" onclick="window.eventsPage.spawnBoss()">👾 Invocar</button>
            </div>
          </div>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">🎟</span>
              <div>
                <div class="event-name">Lotería</div>
                <div class="event-desc">Viewers compran boletos con !boleto</div>
              </div>
              <span id="ev-lottery-badge" class="event-badge">Inactiva</span>
            </div>
            <div class="event-controls">
              <input id="ev-lottery-price" type="number" value="100" min="1" placeholder="Precio boleto">
              <button class="btn-event" onclick="window.eventsPage.startLottery()">🎟 Iniciar</button>
              <button class="btn-event success" onclick="window.eventsPage.drawLottery()">🏆 Sortear</button>
            </div>
          </div>
        </div>

        <!-- CONTROL -->
        <div class="events-section">
          <p class="section-title">🛑 Control</p>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">🛑</span>
              <div>
                <div class="event-name">Congelar economía</div>
                <div class="event-desc">Nadie gana puntos por X minutos</div>
              </div>
              <span id="ev-eco-badge" class="event-badge">Normal</span>
            </div>
            <button class="btn-event danger" onclick="ipcRenderer.invoke('events:freezeEco', 5).then(()=>showToast('🛑 Economía congelada'))">🛑 Congelar 5 min</button>
          </div>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">❄</span>
              <div>
                <div class="event-name">Congelar apuestas</div>
                <div class="event-desc">No se puede apostar por X minutos</div>
              </div>
              <span id="ev-bets-badge" class="event-badge">Normal</span>
            </div>
            <button class="btn-event danger" onclick="ipcRenderer.invoke('events:freezeBets', 5).then(()=>showToast('❄ Apuestas congeladas'))">❄ Congelar 5 min</button>
          </div>

          <div class="event-card">
            <div class="event-card-header">
              <span class="event-icon">🛡</span>
              <div>
                <div class="event-name">Escudo</div>
                <div class="event-desc">Nadie puede robar por X minutos</div>
              </div>
              <span id="ev-shield-badge" class="event-badge">Inactivo</span>
            </div>
            <button class="btn-event success" onclick="ipcRenderer.invoke('events:shield', 5).then(()=>showToast('🛡 Escudo activado'))">🛡 Activar 5 min</button>
          </div>
        </div>

        <!-- SORPRESA -->
        <div class="events-section">
          <p class="section-title">🌟 Sorpresa</p>

          <div class="event-card big-event" onclick="ipcRenderer.invoke('events:random').then(()=>showToast('🌟 ¡Evento aleatorio!'))">
            <span class="big-event-icon">🌟</span>
            <div class="big-event-name">Evento aleatorio</div>
            <div class="big-event-desc">Activa un evento al azar</div>
          </div>

          <div class="event-card big-event chaos" onclick="ipcRenderer.invoke('events:chaos').then(()=>showToast('🎭 ¡MODO CAOS!'))">
            <span class="big-event-icon">🎭</span>
            <div class="big-event-name">Modo Caos</div>
            <div class="big-event-desc">3 eventos simultáneos random</div>
          </div>
        </div>

      </div>
    </div>

`

c = c.replace('    <!-- Cartas -->', eventsPage + '    <!-- Cartas -->')
fs.writeFileSync('src/index.html', c)
console.log('events page added:', c.includes('Panel de Eventos'))
