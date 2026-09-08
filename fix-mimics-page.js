const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

const mimicsPage = `
    <!-- Mimics -->
    <div id="mimics" class="page">
      <div class="page-header">
        <h1>Mimics</h1>
        <p class="page-sub">Crea momentos programables para tu stream</p>
      </div>

      <div class="mimics-toolbar">
        <button class="btn-primary" style="width:auto;padding:10px 18px" onclick="window.mimicsPage.openMimicEditor()">+ Nuevo Mimic</button>
        <button class="btn-ghost" style="width:auto;padding:10px 18px" onclick="window.mimicsPage.openBoxEditor()">+ Nueva Caja</button>
      </div>

      <p class="section-label" style="margin-top:1.5rem">MIS MIMICS</p>
      <div id="mimics-grid" class="mimics-grid"><p class="empty">Cargando…</p></div>

      <p class="section-label" style="margin-top:2rem">CAJAS DE MIMICS</p>
      <div id="boxes-grid" class="boxes-grid"><p class="empty">Cargando…</p></div>
    </div>

`

c = c.replace('    <!-- Cartas -->', mimicsPage + '    <!-- Cartas -->')
fs.writeFileSync('src/index.html', c)
console.log('mimics page added:', c.includes('id="mimics"'))
