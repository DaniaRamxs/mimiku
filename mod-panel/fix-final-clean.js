const fs = require('fs')

// Fix CSS - reglas limpias sin conflictos
let css = fs.readFileSync('style.css', 'utf8')

// Eliminar todas las reglas de channel-screen y ch-content duplicadas
css = css.replace(/\/\* ── Layout principal ── \*\/[\s\S]*?(?=\/\* ── TOPBAR)/g, '')
css = css.replace(/\/\* ── Channel Screen ── \*\/[\s\S]*?(?=\/\* ── TOPBAR)/g, '')
css = css.replace(/#channel-screen \{[^}]+\}\s*/g, '')
css = css.replace(/#ch-content \{[^}]+\}\s*/g, '')
css = css.replace(/\.ch-tab-content \{[^}]+\}\s*/g, '')
css = css.replace(/\.ch-tab-content\.active \{[^}]+\}\s*/g, '')

// Agregar reglas limpias al inicio
const cleanRules = `
/* ── Layout ── */
#home-screen { display:block; }
#channel-screen { display:none; flex-direction:column; min-height:100vh; }
#channel-screen.visible { display:flex; }
#ch-content { flex:1; padding:24px 32px; box-sizing:border-box; }
.ch-tab-content { display:none; }
.ch-tab-content.active { display:block; }

`

css = cleanRules + css
fs.writeFileSync('style.css', css)
console.log('CSS fixed')

// Fix app.js - usar clase en vez de style.display para channel-screen
let app = fs.readFileSync('app.js', 'utf8')

app = app.replace(
  `document.getElementById("home-screen").style.display    = "none"
  document.getElementById("channel-screen").style.display = "flex"`,
  `document.getElementById("home-screen").style.display = "none"
  document.getElementById("channel-screen").classList.add("visible")`
)

app = app.replace(
  `document.getElementById("home-screen").style.display    = "block"
  document.getElementById("channel-screen").style.display = "none"`,
  `document.getElementById("home-screen").style.display = "block"
  document.getElementById("channel-screen").classList.remove("visible")`
)

fs.writeFileSync('app.js', app)
console.log('app.js fixed:', app.includes('classList.add("visible")'))
