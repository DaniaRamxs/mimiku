const fs = require('fs')
let c = fs.readFileSync('mod-panel/style.css', 'utf8')

// Fix: ch-content sin max-width para usar todo el ancho
c = c.replace(
  '#ch-content { padding:24px 20px; max-width:1100px; }',
  '#ch-content { padding:24px 32px; width:100%; box-sizing:border-box; }'
)

// Fix: overview-stats usa más columnas en pantallas grandes
c = c.replace(
  '.overview-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:1.5rem; }',
  '.overview-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:1.5rem; width:100%; }'
)

// Fix: profile banner ocupa todo el ancho
c = c.replace(
  '.profile-banner { background:linear-gradient(135deg, #1a1a2e, #16213e); border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:1rem; }',
  '.profile-banner { background:linear-gradient(135deg, #1a1a2e, #16213e); border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:1rem; width:100%; }'
)

// Fix: two-col usa todo el ancho
c = c.replace(
  '.two-col { display:grid; grid-template-columns:1fr 1fr; gap:24px; }',
  '.two-col { display:grid; grid-template-columns:1fr 1fr; gap:24px; width:100%; }'
)

// Fix: achievements-grid más columnas en PC
c = c.replace(
  '.achievements-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:8px; margin-top:10px; }',
  '.achievements-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; margin-top:10px; width:100%; }'
)

// Fix: collection-grid más columnas en PC
c = c.replace(
  '.collection-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; }',
  '.collection-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; width:100%; }'
)

// Fix: packs-grid más columnas en PC
c = c.replace(
  '.packs-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }',
  '.packs-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; width:100%; }'
)

// Fix: eco-layout usa todo el ancho
c = c.replace(
  '.eco-layout { display:grid; grid-template-columns:1fr 1fr; gap:24px; }',
  '.eco-layout { display:grid; grid-template-columns:1fr 1fr; gap:24px; width:100%; }'
)

// Fix: perfil layout en PC — banner + logros lado a lado
c = c.replace(
  '/* ── PERFIL ── */',
  `/* ── PERFIL ── */
.profile-layout { display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:start; }
@media(max-width:900px){ .profile-layout { grid-template-columns:1fr; } }`
)

fs.writeFileSync('mod-panel/style.css', c)
console.log('layout fixed')
