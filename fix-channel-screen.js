const fs = require('fs')
let c = fs.readFileSync('mod-panel/style.css', 'utf8')

// Agregar estilos para channel-screen
c = c.replace(
  '/* ── TOPBAR ── */',
  `/* ── Channel Screen ── */
#channel-screen { display:flex; flex-direction:column; min-height:100vh; }
#ch-content { padding:24px 32px; width:100%; box-sizing:border-box; flex:1; }
.ch-tab-content { display:none; width:100%; }
.ch-tab-content.active { display:block; width:100%; }

/* ── TOPBAR ── */`
)

// Eliminar definiciones duplicadas de ch-content y ch-tab-content
c = c.replace('\n#ch-content { padding:24px 32px; width:100%; box-sizing:border-box; }\n.ch-tab-content { display:none; }\n.ch-tab-content.active { display:block; }', '')

// Quitar el position:relative/absolute del switchChTab si quedó en el CSS
c = c.replace(/\.ch-tab-content\[style\*="block"\][\s\S]*?\}/g, '')

fs.writeFileSync('mod-panel/style.css', c)
console.log('channel-screen added:', c.includes('#channel-screen'))
