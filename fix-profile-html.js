const fs = require('fs')
let c = fs.readFileSync('mod-panel/index.html', 'utf8')

// Mover stats dentro del banner y quitar el bloque separado
const oldBanner = `        <!-- Banner -->
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
        <!-- Stats -->
        <div class="profile-stats">
          <div class="profile-stat"><span class="profile-stat-val" id="prof-points">0</span><span class="profile-stat-label">puntos</span></div>
          <div class="profile-stat"><span class="profile-stat-val" id="prof-msgs">0</span><span class="profile-stat-label">mensajes</span></div>
          <div class="profile-stat"><span class="profile-stat-val" id="prof-hours">0</span><span class="profile-stat-label">horas vistas</span></div>
          <div class="profile-stat"><span class="profile-stat-val" id="prof-cards">0</span><span class="profile-stat-label">cartas</span></div>
        </div>`

const newBanner = `        <!-- Banner con stats integradas -->
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
        </div>`

c = c.replace(oldBanner, newBanner)
fs.writeFileSync('mod-panel/index.html', c)
console.log('banner fixed:', c.includes('profile-banner-inner'))
