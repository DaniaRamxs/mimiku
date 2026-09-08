const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const modals = `
<!-- Modal: Editor de Mimic -->
<div id="mimic-editor-modal" class="modal-overlay" style="display:none">
  <div class="modal-card mimic-editor-card">
    <div class="modal-header">
      <h2 id="mimic-editor-title">Nuevo Mimic</h2>
      <button class="modal-close" onclick="window.mimicsPage.closeMimicEditor()">✕</button>
    </div>
    <div class="mimic-editor-body">
      <div class="mimic-editor-left">
        <label class="field-label">Nombre</label>
        <input id="mimic-name" type="text" placeholder="Ej: Explosión épica">
        <label class="field-label" style="margin-top:10px">Descripción</label>
        <input id="mimic-desc" type="text" placeholder="Qué hace este Mimic">
        <div style="display:flex;gap:10px;margin-top:10px">
          <div style="flex:1">
            <label class="field-label">Icono</label>
            <input id="mimic-icon" type="text" placeholder="✨" maxlength="2">
          </div>
          <div style="flex:1">
            <label class="field-label">Rareza</label>
            <select id="mimic-rarity" class="event-select" style="width:100%">
              <option value="comun">Común</option>
              <option value="raro">Raro</option>
              <option value="epico">Épico</option>
              <option value="legendario">Legendario</option>
              <option value="evento">Evento</option>
            </select>
          </div>
          <div style="flex:1">
            <label class="field-label">Cooldown (s)</label>
            <input id="mimic-cooldown" type="number" value="30" min="0">
          </div>
        </div>

        <label class="field-label" style="margin-top:16px">Agregar bloque a la secuencia</label>
        <div class="block-palette">
          <button class="block-btn" onclick="window.mimicsPage.addBlock('image')"><span>🎞</span>GIF/Imagen</button>
          <button class="block-btn" onclick="window.mimicsPage.addBlock('sound')"><span>🔊</span>Sonido</button>
          <button class="block-btn" onclick="window.mimicsPage.addBlock('message')"><span>💬</span>Mensaje</button>
          <button class="block-btn" onclick="window.mimicsPage.addBlock('effect')"><span>✨</span>Efecto</button>
          <button class="block-btn" onclick="window.mimicsPage.addBlock('xp')"><span>⭐</span>XP</button>
          <button class="block-btn" onclick="window.mimicsPage.addBlock('wait')"><span>⏱</span>Esperar</button>
        </div>
      </div>
      <div class="mimic-editor-right">
        <label class="field-label">Secuencia de acciones</label>
        <div id="sequence-list" class="sequence-list"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" style="width:auto;padding:9px 18px" onclick="window.mimicsPage.closeMimicEditor()">Cancelar</button>
      <button class="btn-primary" style="width:auto;padding:9px 24px" onclick="window.mimicsPage.saveMimic()">Guardar Mimic</button>
    </div>
  </div>
</div>

<!-- Modal: Editor de Caja -->
<div id="box-editor-modal" class="modal-overlay" style="display:none">
  <div class="modal-card" style="max-width:420px">
    <div class="modal-header">
      <h2>Nueva Caja</h2>
      <button class="modal-close" onclick="window.mimicsPage.closeBoxEditor()">✕</button>
    </div>
    <div style="padding:20px">
      <label class="field-label">Nombre</label>
      <input id="box-name" type="text" placeholder="Ej: Caja Misteriosa">
      <label class="field-label" style="margin-top:10px">Descripción</label>
      <input id="box-desc" type="text" placeholder="Qué contiene">
      <div style="display:flex;gap:10px;margin-top:10px">
        <div style="flex:1">
          <label class="field-label">Icono</label>
          <input id="box-icon" type="text" value="🎁" maxlength="2">
        </div>
        <div style="flex:1">
          <label class="field-label">Precio (pts)</label>
          <input id="box-price" type="number" value="500" min="1">
        </div>
        <div style="flex:1">
          <label class="field-label"># Mimics</label>
          <input id="box-count" type="number" value="3" min="1" max="10">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" style="width:auto;padding:9px 18px" onclick="window.mimicsPage.closeBoxEditor()">Cancelar</button>
      <button class="btn-primary" style="width:auto;padding:9px 24px" onclick="window.mimicsPage.saveBox()">Crear Caja</button>
    </div>
  </div>
</div>

`

c = c.replace('<div id="toast"></div>', modals + '<div id="toast"></div>')
fs.writeFileSync('src/index.html', c)
console.log('modals added:', c.includes('mimic-editor-modal'))
