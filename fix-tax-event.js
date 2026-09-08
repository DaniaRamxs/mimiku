const fs = require('fs')
let c = fs.readFileSync('src/services/events.js', 'utf8')

// Agregar evento de impuestos
const taxCode = `
// ── IMPUESTOS ─────────────────────────────────────────────────────────────────
async function collectTax(percent = 10) {
  const viewers = getRanking(9999)
  if (!viewers.length) return { error: "No hay viewers registrados." }

  let totalCollected = 0
  let affected = 0

  for (const v of viewers) {
    if (v.points <= 0) continue
    const tax = Math.floor(v.points * (percent / 100))
    if (tax <= 0) continue
    addPoints(v.username, -tax, \`impuesto-\${percent}%\`)
    totalCollected += tax
    affected++
  }

  say(\`🏛 ¡IMPUESTO DEL \${percent}%! Se cobraron \${totalCollected} pts de \${affected} viewers para el fisco.\`)
  overlay({ type: "alert", text: \`🏛 Impuesto del \${percent}% cobrado a todos los viewers\`, duration: 6000 })
  overlay({ type: "game_event", event: "tax", percent, totalCollected, affected })
  return { ok: true, totalCollected, affected, percent }
}

`

c = c.replace('// ── SORPRESA ──────────────────────────────────────────────────────────────', taxCode + '// ── SORPRESA ──────────────────────────────────────────────────────────────')

// agregar collectTax a RANDOM_EVENTS y exports
c = c.replace(
  'const RANDOM_EVENTS = [',
  'const RANDOM_EVENTS = [\n  () => collectTax(5),'
)

c = c.replace(
  'module.exports = {\n  init, getStatus,\n  rainPoints, gift500, setMultiplier, getMultiplier, equalizer,\n  freezeEconomy, isEconomyFrozen,\n  freezeBets, areBetsFrozen,\n  activateShield, isShieldActive,\n  spawnBoss, attackBoss,\n  startLottery, buyLotteryTicket, drawLottery,\n  randomEvent, chaosMode,\n}',
  'module.exports = {\n  init, getStatus,\n  rainPoints, gift500, setMultiplier, getMultiplier, equalizer,\n  collectTax,\n  freezeEconomy, isEconomyFrozen,\n  freezeBets, areBetsFrozen,\n  activateShield, isShieldActive,\n  spawnBoss, attackBoss,\n  startLottery, buyLotteryTicket, drawLottery,\n  randomEvent, chaosMode,\n}'
)

fs.writeFileSync('src/services/events.js', c)
console.log('tax added:', c.includes('collectTax'))
