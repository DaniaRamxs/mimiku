const fs = require('fs')
let c = fs.readFileSync('mod-panel/style.css', 'utf8')

// Fix: ch-content debe tener overflow visible y min-height
c = c.replace(
  '#ch-content { padding:24px 32px; width:100%; box-sizing:border-box; }',
  '#ch-content { padding:24px 32px; width:100%; box-sizing:border-box; min-height:400px; overflow:visible; }'
)

// Fix: ch-tab-content debe ser visible cuando active
c = c.replace(
  '.ch-tab-content { display:none; }',
  '.ch-tab-content { display:none !important; }'
)
c = c.replace(
  '.ch-tab-content.active { display:block; }',
  '.ch-tab-content.active { display:block !important; }'
)

// Fix: shop-content y otros contenedores internos
c += `
/* Fix tabs visibility */
#tab-shop[style*="display: block"],
#tab-economy[style*="display: block"],
#tab-collection[style*="display: block"],
#tab-profile[style*="display: block"],
#tab-mod[style*="display: block"],
#tab-overview[style*="display: block"] {
  display:block !important;
  min-height:200px;
}
#shop-content, #collection-content, #eco-ranking, #eco-log { display:block !important; }
`

fs.writeFileSync('mod-panel/style.css', c)
console.log('fixed')
