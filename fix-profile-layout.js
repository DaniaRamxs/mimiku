const fs = require('fs')
let c = fs.readFileSync('mod-panel/style.css', 'utf8')

// Compactar perfil banner
c = c.replace(
  '.profile-banner-inner { display:flex; align-items:flex-end; gap:20px; padding:24px; }',
  '.profile-banner-inner { display:flex; align-items:center; gap:20px; padding:20px 24px; }'
)
c = c.replace(
  '.profile-avatar { width:80px; height:80px; border-radius:50%; border:3px solid var(--accent); object-fit:cover; background:var(--card); }',
  '.profile-avatar { width:72px; height:72px; border-radius:50%; border:3px solid var(--accent); object-fit:cover; background:var(--card); }'
)
c = c.replace(
  '.profile-display { font-size:22px; font-weight:700; }',
  '.profile-display { font-size:20px; font-weight:700; }'
)

// Stats en línea con el banner (no debajo)
c = c.replace(
  '.profile-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }',
  '.profile-stats { display:flex; gap:8px; margin-left:auto; flex-shrink:0; }'
)
c = c.replace(
  '.profile-stat { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:14px; text-align:center; }',
  '.profile-stat { background:rgba(0,0,0,.3); border:1px solid rgba(255,255,255,.08); border-radius:var(--radius); padding:10px 16px; text-align:center; min-width:80px; }'
)
c = c.replace(
  '.profile-stat-val { font-size:22px; font-weight:700; color:var(--accent); display:block; }',
  '.profile-stat-val { font-size:18px; font-weight:700; color:var(--accent); display:block; }'
)
c = c.replace(
  '.profile-stat-label { font-size:11px; color:var(--dim); margin-top:4px; display:block; }',
  '.profile-stat-label { font-size:10px; color:rgba(255,255,255,.5); margin-top:3px; display:block; }'
)

// Logros más compactos
c = c.replace(
  '.achievements-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:10px; }',
  '.achievements-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:8px; margin-top:10px; }'
)
c = c.replace(
  '.achievement-item { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:14px; display:flex; align-items:center; gap:10px; }',
  '.achievement-item { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:10px 12px; display:flex; align-items:center; gap:8px; }'
)
c = c.replace(
  '.achievement-icon { font-size:28px; flex-shrink:0; }',
  '.achievement-icon { font-size:22px; flex-shrink:0; }'
)
c = c.replace(
  '.achievement-name { font-weight:600; font-size:13px; }',
  '.achievement-name { font-weight:600; font-size:12px; }'
)
c = c.replace(
  '.achievement-desc { font-size:11px; color:var(--sub); margin-top:2px; }',
  '.achievement-desc { font-size:10px; color:var(--sub); margin-top:1px; }'
)

// Banner más compacto
c = c.replace(
  '.profile-banner { background:linear-gradient(135deg, #1a1a2e, #16213e); border:1px solid var(--border); border-radius:16px; overflow:hidden; margin-bottom:1.5rem; }',
  '.profile-banner { background:linear-gradient(135deg, #1a1a2e, #16213e); border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:1rem; }'
)

fs.writeFileSync('mod-panel/style.css', c)
console.log('layout fixed')
