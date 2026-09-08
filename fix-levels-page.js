const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const levelsPage = `
    <!-- Niveles -->
    <div id="levels" class="page">
      <div class="page-header">
        <h1>Niveles</h1>
        <p class="page-sub">Configura cómo los viewers ganan XP y suben de nivel</p>
      </div>

      <div class="levels-layout">
        <div class="levels-col">
          <div class="card-block">
            <p class="section-label">GANANCIA DE XP</p>
            <div class="lvl-field">
              <label>XP por mensaje en chat</label>
              <input id="lvl-xp-message" type="number" min="0" value="5">
            </div>
            <div class="lvl-field">
              <label>XP cada 5 min viendo</label>
              <input id="lvl-xp-5min" type="number" min="0" value="10">
            </div>
            <div class="lvl-field">
              <label>Cooldown anti-spam (seg)</label>
              <input id="lvl-cooldown" type="number" min="0" value="30">
            </div>
            <div class="lvl-field">
              <label>Puntos de regalo al subir nivel</label>
              <input id="lvl-reward" type="number" min="0" value="0">
            </div>
            <label class="lvl-check">
              <input id="lvl-announce" type="checkbox" checked>
              Anunciar subidas de nivel en el overlay
            </label>
            <button class="btn-primary" style="margin-top:14px" onclick="window.levelsPage.saveLevelConfig()">Guardar configuración</button>
          </div>

          <div class="card-block" style="margin-top:1rem">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <p class="section-label" style="margin:0">TÍTULOS / PRESTIGIOS</p>
              <button class="btn-ghost" style="width:auto;padding:6px 12px;font-size:12px" onclick="window.levelsPage.addTitle()">+ Título</button>
            </div>
            <div id="titles-list" class="titles-list" style="margin-top:10px"></div>
            <button class="btn-primary" style="margin-top:12px" onclick="window.levelsPage.saveTitles()">Guardar títulos</button>
          </div>
        </div>

        <div class="levels-col">
          <div class="card-block">
            <p class="section-label">RANKING DE XP</p>
            <div id="levels-leaderboard" class="levels-lb"><p class="empty-small">Cargando…</p></div>
          </div>
        </div>
      </div>
    </div>

`

c = c.replace('    <!-- Ajustes -->', levelsPage + '    <!-- Ajustes -->')
fs.writeFileSync('src/index.html', c)
console.log('levels page added:', c.includes('id="levels"'))
