const fs = require('fs')
let c = fs.readFileSync('mod-panel/style.css', 'utf8')

// Agregar clases en español para rareza (además de las en inglés)
const rarityAdditions = `
/* Rareza en español */
.card-col-item.comun      { border-color:var(--common); }
.card-col-item.raro       { border-color:var(--rare); box-shadow:0 0 12px rgba(59,130,246,.2); }
.card-col-item.epico      { border-color:var(--epic); box-shadow:0 0 12px rgba(168,85,247,.2); }
.card-col-item.legendario { border-color:var(--legendary); box-shadow:0 0 16px rgba(245,158,11,.3); }
.card-col-item.comun .card-col-rarity      { color:var(--common); }
.card-col-item.raro .card-col-rarity       { color:var(--rare); }
.card-col-item.epico .card-col-rarity      { color:var(--epic); }
.card-col-item.legendario .card-col-rarity { color:var(--legendary); }
.reveal-card.comun      { border-color:var(--common); }
.reveal-card.raro       { border-color:var(--rare); box-shadow:0 0 16px rgba(59,130,246,.3); }
.reveal-card.epico      { border-color:var(--epic); box-shadow:0 0 16px rgba(168,85,247,.3); }
.reveal-card.legendario { border-color:var(--legendary); box-shadow:0 0 20px rgba(245,158,11,.4); }
.reveal-card.comun .reveal-card-rarity      { color:var(--common); }
.reveal-card.raro .reveal-card-rarity       { color:var(--rare); }
.reveal-card.epico .reveal-card-rarity      { color:var(--epic); }
.reveal-card.legendario .reveal-card-rarity { color:var(--legendary); }
`

c += rarityAdditions
fs.writeFileSync('mod-panel/style.css', c)
console.log('spanish rarity css added')
