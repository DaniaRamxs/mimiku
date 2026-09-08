const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Reemplazar el campo de URL de imagen por URL + upload
c = c.replace(
  `              <label>URL de imagen<input id="card-img" type="url" placeholder="https://...jpg"></label>`,
  `              <label>Imagen
                <div style="display:flex;gap:6px;align-items:center">
                  <input id="card-img" type="url" placeholder="https://...jpg" style="flex:1">
                  <button class="btn-ghost" onclick="document.getElementById('card-img-file').click()" style="white-space:nowrap;padding:8px 10px;font-size:12px">📁 Subir</button>
                  <input id="card-img-file" type="file" accept="image/*" style="display:none" onchange="window.cardsPage.uploadCardImage(this.files[0])">
                </div>
                <p id="card-img-uploading" class="field-hint" style="display:none">Subiendo imagen…</p>
              </label>`
)

fs.writeFileSync('src/index.html', c)
console.log('upload field added:', c.includes('card-img-file'))
