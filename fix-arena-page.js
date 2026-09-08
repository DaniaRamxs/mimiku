const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const arenaPage = `
    <!-- Arena -->
    <div id="arena" class="page">
      <div class="page-header">
        <h1>Arena <span id="arena-status-label" class="afk-status-badge"></span></h1>
        <p class="page-sub">Juegos en vivo para tu comunidad — empezando con Palabra Bomba 💣</p>
      </div>

      <!-- Setup: crear partida -->
      <div id="arena-setup">
        <div class="afk-layout">
          <div class="afk-col">
            <div class="card-block">
              <p class="section-label">CATEGORÍA</p>
              <select id="arena-category" class="event-select" style="width:100%">
                <option value="libre">Libre</option>
                <option value="animales">Animales</option>
                <option value="paises">Países</option>
                <option value="comida">Comida</option>
                <option value="videojuegos">Videojuegos</option>
                <option value="anime">Anime</option>
                <option value="peliculas">Películas</option>
                <option value="musica">Música</option>
                <option value="tecnologia">Tecnología</option>
                <option value="ciencia">Ciencia</option>
              </select>
            </div>
            <div class="card-block" style="margin-top:1rem">
              <p class="section-label">DIFICULTAD</p>
              <div style="display:flex;gap:12px">
                <div class="lvl-field" style="flex:1">
                  <label>Tiempo inicial (s)</label>
                  <input id="arena-start-time" type="number" min="3" value="15">
                </div>
                <div class="lvl-field" style="flex:1">
                  <label>Reducción/ronda (s)</label>
                  <input id="arena-reduction" type="number" min="0" value="1">
                </div>
                <div class="lvl-field" style="flex:1">
                  <label>Tiempo mínimo (s)</label>
                  <input id="arena-min-time" type="number" min="1" value="3">
                </div>
              </div>
            </div>
          </div>
          <div class="afk-col">
            <div class="card-block">
              <p class="section-label">RECOMPENSA AL GANADOR</p>
              <div class="lvl-field">
                <label>Tipo</label>
                <select id="arena-reward-type" class="event-select" style="width:100%">
                  <option value="none">Sin recompensa</option>
                  <option value="points">Puntos</option>
                  <option value="card">Carta</option>
                  <option value="box">Caja/Sobre</option>
                  <option value="custom">Personalizada (texto)</option>
                </select>
              </div>
              <div class="lvl-field">
                <label>Valor (cantidad de puntos, o texto de la recompensa)</label>
                <input id="arena-reward-value" type="text" placeholder="500">
              </div>
            </div>
            <button class="btn-primary afk-toggle-btn" onclick="window.arenaPage.createArenaRoom()">💣 Crear partida</button>
          </div>
        </div>
      </div>

      <!-- Lobby: jugadores esperando -->
      <div id="arena-lobby" style="display:none">
        <div class="arena-lobby-head">
          <div>
            <p class="section-label">CÓDIGO DE SALA</p>
            <div id="arena-room-code" class="arena-code">-----</div>
            <p id="arena-room-link" class="field-hint" style="font-size:12px;color:var(--text-muted);margin-top:6px"></p>
          </div>
          <div class="arena-lobby-actions">
            <button class="btn-primary" style="width:auto;padding:11px 24px" onclick="window.arenaPage.startArenaGame()">▶ Comenzar (<span id="arena-player-count">0</span>)</button>
            <button class="btn-ghost" style="width:auto;padding:11px 18px" onclick="window.arenaPage.finishArenaGame()">Finalizar</button>
          </div>
        </div>
        <p class="section-label" style="margin-top:1.5rem">JUGADORES EN EL LOBBY</p>
        <div id="arena-players-grid" class="arena-players-grid"></div>
      </div>
    </div>

`

c = c.replace('    <!-- Economía -->', arenaPage + '    <!-- Economía -->')
fs.writeFileSync('src/index.html', c)
console.log('arena page added:', c.includes('id="arena"'))
