const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const emotesPage = `
    <!-- Emotes -->
    <div id="emotes" class="page">
      <div class="page-header">
        <h1>Emotes con Sonido</h1>
        <p class="page-sub">Cuando alguien use un emote en el chat, suena el audio que elijas</p>
      </div>

      <label class="emotes-master">
        <input type="checkbox" id="emotes-enabled" checked onchange="window.emotesPage.toggleEnabled(this.checked)">
        Sistema activado
      </label>

      <div class="card-block" style="margin-top:1rem">
        <p class="section-label">AGREGAR SONIDO</p>
        <div class="emote-add-row">
          <input type="text" id="new-emote-name" placeholder="Nombre del emote (ej: MiCanalPog)">
          <label class="emote-cd">cooldown <input type="number" id="new-emote-cd" min="0" value="5">s</label>
          <button class="btn-primary" style="width:auto;padding:9px 18px" onclick="window.emotesPage.pickEmoteFile()">📁 Elegir audio y agregar</button>
        </div>
        <p class="field-hint" style="margin-top:8px;font-size:11px;color:var(--text-muted)">Escribe el nombre exacto del emote de tu canal, luego elige el archivo de audio (mp3, wav, ogg).</p>
      </div>

      <p class="section-label" style="margin-top:1.5rem">TUS SONIDOS</p>
      <div id="emotes-list" class="emotes-list"><p class="empty">Cargando…</p></div>
    </div>

`

c = c.replace('    <!-- Niveles -->', emotesPage + '    <!-- Niveles -->')
fs.writeFileSync('src/index.html', c)
console.log('emotes page added:', c.includes('id="emotes"'))
