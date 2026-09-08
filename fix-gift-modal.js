const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const giftModal = `
<!-- Modal: Regalar (streamer) -->
<div id="gift-modal" class="modal-overlay" style="display:none">
  <div class="modal-card" style="max-width:440px">
    <div class="modal-header">
      <h2>🎁 Regalar Mimic</h2>
      <button class="modal-close" onclick="window.mimicsPage.closeGiftModal()">✕</button>
    </div>
    <div style="padding:20px">
      <label class="field-label">Mimic a regalar</label>
      <select id="gift-mimic-select" class="event-select" style="width:100%"></select>

      <label class="field-label" style="margin-top:14px">Destinatarios</label>
      <select id="gift-target" class="event-select" style="width:100%" onchange="window.mimicsPage.updateGiftTarget()">
        <option value="all">Todos los viewers activos</option>
        <option value="first_n">Los primeros N viewers</option>
        <option value="user">Un viewer específico</option>
      </select>

      <div id="gift-firstn-row" class="lvl-field" style="margin-top:12px;display:none">
        <label>Cantidad de viewers</label>
        <input id="gift-firstn" type="number" min="1" value="10">
      </div>
      <div id="gift-user-row" class="lvl-field" style="margin-top:12px;display:none">
        <label>Usuario de Twitch</label>
        <input id="gift-user" type="text" placeholder="nombre_usuario">
      </div>

      <p class="field-hint" style="margin-top:10px;font-size:11px;color:var(--text-muted)">Los viewers activos son quienes han escrito en el chat durante este stream.</p>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost" style="width:auto;padding:9px 18px" onclick="window.mimicsPage.closeGiftModal()">Cancelar</button>
      <button class="btn-primary" style="width:auto;padding:9px 24px" onclick="window.mimicsPage.sendStreamerGift()">Enviar regalo</button>
    </div>
  </div>
</div>

`

c = c.replace('<div id="toast"></div>', giftModal + '<div id="toast"></div>')
fs.writeFileSync('src/index.html', c)
console.log('gift modal added:', c.includes('gift-modal'))
