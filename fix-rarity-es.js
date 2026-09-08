const fs = require('fs')

// Fix en cards.js del renderer — select de rareza
let c = fs.readFileSync('src/index.html', 'utf8')
c = c.replace(
  `                  <option value="common">Común</option>
                  <option value="rare">Raro</option>
                  <option value="epic">Épico</option>
                  <option value="legendary">Legendario</option>`,
  `                  <option value="comun">Común</option>
                  <option value="raro">Raro</option>
                  <option value="epico">Épico</option>
                  <option value="legendario">Legendario</option>`
)
fs.writeFileSync('src/index.html', c)

// Fix en mod-panel style.css — variables de rareza
let s = fs.readFileSync('mod-panel/style.css', 'utf8')
s = s.replace('--common:   #a1a1aa;', '--common:   #a1a1aa; /* comun */')
fs.writeFileSync('mod-panel/style.css', s)

// Fix en mod-panel app.js — clases de rareza
let a = fs.readFileSync('mod-panel/app.js', 'utf8')
// collection grid items
a = a.replace(/\.card-col-item \$\{c\.rarity\}/g, '.card-col-item ${rarityClass(c.rarity)}')
a = a.replace(/class="reveal-card \$\{c\.rarity\}"/g, 'class="reveal-card ${rarityClass(c.rarity)}"')
a = a.replace(/class="card-col-item \$\{c\.rarity\}"/g, 'class="card-col-item ${rarityClass(c.rarity)}"')

// Agregar función rarityClass
a = a.replace(
  'const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)',
  `const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

function rarityClass(r) {
  const map = { comun:'common', raro:'rare', epico:'epic', legendario:'legendary', common:'common', rare:'rare', epic:'epic', legendary:'legendary' }
  return map[r] || 'common'
}

function rarityLabel(r) {
  const map = { comun:'Común', raro:'Raro', epico:'Épico', legendario:'Legendario', common:'Común', rare:'Raro', epic:'Épico', legendary:'Legendario' }
  return map[r] || r
}`
)

// Reemplazar labels de rareza en colección y reveal
a = a.replace(/<div class="card-col-rarity">\$\{c\.rarity\}<\/div>/g, '<div class="card-col-rarity">${rarityLabel(c.rarity)}</div>')
a = a.replace(/<div class="reveal-card-rarity">\$\{c\.rarity\}<\/div>/g, '<div class="reveal-card-rarity">${rarityLabel(c.rarity)}</div>')

fs.writeFileSync('mod-panel/app.js', a)
console.log('rarity labels fixed')
