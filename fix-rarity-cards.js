const fs = require('fs')
let c = fs.readFileSync('src/pages/cards.js', 'utf8')

// Agregar función de label
c = c.replace(
  '// pages/cards.js — gestión de cartas y sobres desde Mimiku (broadcaster)',
  `// pages/cards.js — gestión de cartas y sobres desde Mimiku (broadcaster)

function rarityLabel(r) {
  const map = { comun:'Común', raro:'Raro', epico:'Épico', legendario:'Legendario', common:'Común', rare:'Raro', epic:'Épico', legendary:'Legendario' }
  return map[r] || r
}

function rarityColor(r) {
  const map = { comun:'#a1a1aa', common:'#a1a1aa', raro:'#3b82f6', rare:'#3b82f6', epico:'#a855f7', epic:'#a855f7', legendario:'#f59e0b', legendary:'#f59e0b' }
  return map[r] || '#a1a1aa'
}`
)

// Usar rarityLabel en la lista de cartas
c = c.replace(
  '        <div class="card-rarity-badge" style="background:${rarityColors[c.rarity]}">${c.rarity}</div>',
  '        <div class="card-rarity-badge" style="background:${rarityColor(c.rarity)}">${rarityLabel(c.rarity)}</div>'
)

// Quitar rarityColors y usar rarityColor
c = c.replace(
  '  const rarityColors = { common:"#a1a1aa", rare:"#3b82f6", epic:"#a855f7", legendary:"#f59e0b" }\n  el.innerHTML = cards.map(c => `',
  '  el.innerHTML = cards.map(c => `'
)
c = c.replace(
  '      <div class="card-preview" style="border-color:${rarityColors[c.rarity]||\'#27272a\'}">',
  '      <div class="card-preview" style="border-color:${rarityColor(c.rarity)||\'#27272a\'}">'
)

fs.writeFileSync('src/pages/cards.js', c)
console.log('cards.js rarity fixed:', c.includes('rarityLabel'))
