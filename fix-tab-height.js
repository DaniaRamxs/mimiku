const fs = require('fs')
let c = fs.readFileSync('mod-panel/style.css', 'utf8')

// Fix principal: ch-content y tabs sin restricciones de altura
c = c.replace(
  '#ch-content { padding:24px 32px; width:100%; box-sizing:border-box; min-height:400px; overflow:visible; }',
  '#ch-content { padding:24px 32px; width:100%; box-sizing:border-box; }'
)

// Fix: ch-tab-content sin !important que interfiera
c = c.replace(
  '.ch-tab-content { display:none !important; }',
  '.ch-tab-content { display:none; }'
)
c = c.replace(
  '.ch-tab-content.active { display:block !important; }',
  '.ch-tab-content.active { display:block; }'
)

// Quitar el bloque de fix que agregamos antes
c = c.replace(/\/\* Fix tabs visibility \*\/[\s\S]*?#shop-content.*?\}(\s*\})?/g, '')

// Fix definitivo: forzar que el inline style funcione correctamente
// El problema es que cuando se hace style.display="block" en un elemento con display:none en CSS
// a veces el layout no recalcula. Agregamos una regla que ayude:
c += `
/* ── Tab content fix ── */
.ch-tab-content[style*="block"] {
  display: block;
  width: 100%;
}
#shop-content[style*="block"],
#collection-content[style*="block"],
#profile-content[style*="block"],
#mod-panel-inner[style*="block"] {
  display: block;
  width: 100%;
}
`

fs.writeFileSync('mod-panel/style.css', c)
console.log('css fixed')
