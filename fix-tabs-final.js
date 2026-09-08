const fs = require('fs')

// Reescribir el CSS de tabs completamente
let css = fs.readFileSync('mod-panel/style.css', 'utf8')

// Quitar todas las reglas de ch-tab-content existentes
css = css.replace(/#ch-content \{[^}]+\}/g, '')
css = css.replace(/\.ch-tab-content \{[^}]+\}/g, '')
css = css.replace(/\.ch-tab-content\.active \{[^}]+\}/g, '')
css = css.replace(/#channel-screen \{[^}]+\}/g, '')

// Agregar reglas limpias al inicio del archivo (después de :root)
const newRules = `
/* ── Layout principal ── */
#home-screen { min-height:100vh; }
#channel-screen { display:block; min-height:100vh; }
#ch-content { padding:24px 32px; box-sizing:border-box; }
.ch-tab-content { display:none; }
.ch-tab-content.active { display:block; }

`

css = css.replace('body {', newRules + 'body {')

fs.writeFileSync('mod-panel/style.css', css)
console.log('css rebuilt')

// Reescribir switchChTab en app.js - versión ultra simple
let app = fs.readFileSync('mod-panel/app.js', 'utf8')

app = app.replace(
  /function switchChTab\(tab\) \{[\s\S]*?if \(tab === "mod"\).*?initModTab\(\)/,
  `function switchChTab(tab) {
  document.querySelectorAll(".ch-tab").forEach(function(b) { b.classList.remove("active") })
  document.querySelectorAll(".ch-tab-content").forEach(function(t) { t.classList.remove("active"); t.style.display = "none" })
  var btn     = document.querySelector('.ch-tab[data-tab="' + tab + '"]')
  var content = document.getElementById("tab-" + tab)
  if (btn)     btn.classList.add("active")
  if (content) { content.classList.add("active"); content.style.display = "block" }
  if (tab === "overview")   loadOverview().catch(function(e){ console.error(e) })
  if (tab === "economy")    loadEconomy().catch(function(e){ console.error(e) })
  if (tab === "profile")    loadProfile().catch(function(e){ console.error(e) })
  if (tab === "collection") loadCollection().catch(function(e){ console.error(e) })
  if (tab === "shop")       loadShop().catch(function(e){ console.error(e) })
  if (tab === "mod")        initModTab()`
)

fs.writeFileSync('mod-panel/app.js', app)
console.log('switchChTab rebuilt')
