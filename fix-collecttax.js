const fs = require('fs')
let c = fs.readFileSync('src/services/events.js', 'utf8')

// Agregar collectTax como alias de taxEveryone si existe
if (c.includes('taxEveryone') && !c.includes('collectTax')) {
  c = c.replace(
    'module.exports = {',
    'function collectTax(percent = 10) { return taxEveryone(percent) }\n\nmodule.exports = {'
  )
  // agregar al exports
  c = c.replace(
    "  randomEvent, chaosMode,\n}",
    "  collectTax,\n  randomEvent, chaosMode,\n}"
  )
  fs.writeFileSync('src/services/events.js', c)
  console.log('collectTax alias added')
} else if (c.includes('collectTax')) {
  console.log('collectTax already exists')
} else {
  // agregar función completa
  const taxFn = `
function collectTax(percent = 10) {
  const viewers = getRanking(9999)
  if (!viewers.length) return { error: "No hay viewers registrados." }
  let totalCollected = 0, affected = 0
  for (const v of viewers) {
    if (v.points <= 0) continue
    const tax = Math.floor(v.points * (percent / 100))
    if (tax <= 0) continue
    addPoints(v.username, -tax, \`impuesto-\${percent}%\`)
    totalCollected += tax
    affected++
  }
  say(\`🏛 ¡IMPUESTO DEL \${percent}%! Se cobraron \${totalCollected} pts de \${affected} viewers.\`)
  overlay({ type: "alert", text: \`🏛 Impuesto del \${percent}% cobrado\`, duration: 6000 })
  return { ok: true, totalCollected, affected, percent }
}
`
  c = c.replace('module.exports = {', taxFn + '\nmodule.exports = {')
  c = c.replace("  randomEvent, chaosMode,\n}", "  collectTax,\n  randomEvent, chaosMode,\n}")
  fs.writeFileSync('src/services/events.js', c)
  console.log('collectTax function added')
}

// Verificar
const e = require('./src/services/events.js')
console.log('collectTax in exports:', typeof e.collectTax)
