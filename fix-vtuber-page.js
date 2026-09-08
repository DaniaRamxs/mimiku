const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const vtuberPage = `
    <!-- VTuber -->
    <div id="vtuber" class="page">
      <div class="page-header">
        <h1>VTuber <span id="vts-status" class="afk-status-badge">Desconectado</span></h1>
        <p class="page-sub">Conecta VTube Studio para las ruletas de ítem y avatar en tus Mimics</p>
      </div>

      <div class="card-block">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <p class="section-label" style="margin:0">CONEXIÓN</p>
            <p class="field-hint" style="font-size:12px;color:var(--text-muted);margin-top:4px">Abre VTube Studio, activa la API de plugins (puerto 8001) y pulsa conectar. Acepta el popup que aparece en VTS.</p>
          </div>
          <button class="btn-primary" style="width:auto;padding:10px 22px" onclick="window.vtuberPage.connectVts()">Conectar VTube Studio</button>
        </div>
      </div>

      <div class="afk-layout" style="margin-top:1rem">
        <div class="afk-col">
          <div class="card-block">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <p class="section-label" style="margin:0">🎰 RULETA DE ÍTEMS</p>
              <button class="btn-ghost" style="width:auto;padding:6px 12px;font-size:12px" onclick="window.vtuberPage.testItem()">▶ Probar</button>
            </div>
            <p class="field-hint" style="font-size:11px;color:var(--text-muted);margin:6px 0 10px">Accesorios que aparecen sobre tu modelo actual y se quitan solos.</p>
            <div class="lvl-field">
              <label>Duración del ítem (segundos)</label>
              <input id="vts-item-duration" type="number" min="1" value="30">
            </div>
            <div id="vts-item-pool" class="vts-pool"></div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn-ghost" style="flex:1;padding:8px;font-size:12px" onclick="window.vtuberPage.addItem()">+ Ítem manual</button>
              <button class="btn-ghost" style="flex:1;padding:8px;font-size:12px" onclick="window.vtuberPage.discoverItems()">🔍 Descubrir de VTS</button>
            </div>
          </div>
        </div>

        <div class="afk-col">
          <div class="card-block">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <p class="section-label" style="margin:0">🎭 RULETA DE AVATARES</p>
              <button class="btn-ghost" style="width:auto;padding:6px 12px;font-size:12px" onclick="window.vtuberPage.testAvatar()">▶ Probar</button>
            </div>
            <p class="field-hint" style="font-size:11px;color:var(--text-muted);margin:6px 0 10px">Cambia tu modelo completo al azar. Se queda hasta el próximo giro.</p>
            <div id="vts-model-pool" class="vts-pool"></div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn-ghost" style="flex:1;padding:8px;font-size:12px" onclick="window.vtuberPage.addModel()">+ Modelo manual</button>
              <button class="btn-ghost" style="flex:1;padding:8px;font-size:12px" onclick="window.vtuberPage.discoverModels()">🔍 Descubrir de VTS</button>
            </div>
          </div>
        </div>
      </div>

      <div id="vts-discovered"></div>

      <button class="btn-primary afk-toggle-btn" onclick="window.vtuberPage.saveVtsConfig()">Guardar configuración</button>
    </div>

`

c = c.replace('    <!-- Ajustes -->', vtuberPage + '    <!-- Ajustes -->')
fs.writeFileSync('src/index.html', c)
console.log('vtuber page added:', c.includes('id="vtuber"'))
