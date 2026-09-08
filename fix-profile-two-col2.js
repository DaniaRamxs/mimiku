const fs = require('fs')
let c = fs.readFileSync('mod-panel/index.html', 'utf8')

// Buscar el div de profile-content y reemplazar su interior
const startMarker = '<div id="profile-content" style="display:none">'
const endMarker = '</div>\n      </div>\n\n    <!-- Colección -->'

const startIdx = c.indexOf(startMarker)
const endIdx   = c.indexOf('<!-- Colección -->')

if (startIdx === -1 || endIdx === -1) {
  console.log('markers not found, startIdx:', startIdx, 'endIdx:', endIdx)
  // buscar alternativa
  const i2 = c.indexOf('profile-achievements')
  console.log('profile-achievements at:', i2)
  console.log('context:', c.substring(i2-200, i2+200))
  process.exit(1)
}

const newContent = `<div id="profile-content" style="display:none">
        <div class="profile-layout">
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
            <div class="profile-stats" style="margin-top:12px;display:flex;gap:8px">
              <div class="profile-stat"><span class="profile-stat-val" id="prof-points">0</span><span class="profile-stat-label">puntos</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-msgs">0</span><span class="profile-stat-label">mensajes</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-hours">0</span><span class="profile-stat-label">horas</span></div>
              <div class="profile-stat"><span class="profile-stat-val" id="prof-cards">0</span><span class="profile-stat-label">cartas</span></div>
            </div>
          </div>
          <div>
            <p class="section-label">LOGROS</p>
            <div id="profile-achievements" class="achievements-grid"></div>
          </div>
        </div>
      </div>

    `

const beforeContent = c.substring(0, startIdx)
const afterContent  = c.substring(endIdx)

c = beforeContent + newContent + afterContent
fs.writeFileSync('mod-panel/index.html', c)
console.log('profile layout fixed:', c.includes('profile-layout'))
