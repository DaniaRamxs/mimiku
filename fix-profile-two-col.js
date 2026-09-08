const fs = require('fs')
let c = fs.readFileSync('mod-panel/index.html', 'utf8')

// Envolver el perfil en un layout de dos columnas
const oldProfileContent = `      <div id="profile-content" style="display:none">
        <!-- Banner -->
        <div class="profile-banner" id="profile-banner">
          <div class="profile-banner-inner">
            <div class="profile-avatar-wrap">
              <img id="profile-avatar" src="" alt="" class="profile-avatar">
              <img id="profile-frame" src="" alt="" class="profile-frame" style="display:none">
            </div>
            <div class="profile-info">
              <div class="profile-display" id="profile-display"></div>
              <div class="profile-handle" id="profile-handle"></div>
              <div class="profile-badges" id="profile-badges"></div>
            </div>
            <div class="profile-stats">
              <div class="profile-stat"><span class="profile-stat-val" id="prof-points">0</span><span class="profile-stat-label">puntos</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-msgs">0</span><span class="profile-stat-label">mensajes</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-hours">0</span><span class="profile-stat-label">horas</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-cards">0</span><span class="profile-stat-label">cartas</span></div>
            </div>
          </div>
        </div>
        <!-- Logros -->
        <div style="margin-top:1.5rem">
          <p class="section-label">LOGROS</p>
          <div id="profile-achievements" class="achievements-grid"></div>
        </div>
      </div>`

const newProfileContent = `      <div id="profile-content" style="display:none">
        <div class="profile-layout">
          <!-- Columna izquierda: banner + stats -->
          <div>
            <div class="profile-banner" id="profile-banner">
              <div class="profile-banner-inner">
                <div class="profile-avatar-wrap">
                  <img id="profile-avatar" src="" alt="" class="profile-avatar">
                  <img id="profile-frame" src="" alt="" class="profile-frame" style="display:none">
                </div>
                <div class="profile-info">
                  <div class="profile-display" id="profile-display"></div>
                  <div class="profile-handle" id="profile-handle"></div>
                  <div class="profile-badges" id="profile-badges"></div>
                </div>
              </div>
            </div>
            <div class="profile-stats" style="margin-top:12px">
              <div class="profile-stat"><span class="profile-stat-val" id="prof-points">0</span><span class="profile-stat-label">puntos</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-msgs">0</span><span class="profile-stat-label">mensajes</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-hours">0</span><span class="profile-stat-label">horas</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-cards">0</span><span class="profile-stat-label">cartas</span></div>
            </div>
          </div>
          <!-- Columna derecha: logros -->
          <div>
            <p class="section-label">LOGROS</p>
            <div id="profile-achievements" class="achievements-grid"></div>
          </div>
        </div>
      </div>`

c = c.replace(oldProfileContent, newProfileContent)
fs.writeFileSync('mod-panel/index.html', c)
console.log('profile layout fixed:', c.includes('profile-layout'))
