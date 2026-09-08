const fs = require('fs')
let c = fs.readFileSync('src/services/games.js', 'utf8')

const slotsCode = `
// ── SLOTS ─────────────────────────────────────────────────────────────────────
const SYMBOLS = ["🍒","🍋","🍊","🍇","⭐","💎","7️⃣","🎰"]

function playSlots(username, bet) {
  const viewer = getViewer(username)
  if (!viewer) return { error: "Chateá primero para registrarte." }
  if (viewer.points < bet) return { error: \`No tenés suficientes puntos. Tenés \${viewer.points}.\` }
  if (bet <= 0) return { error: "La apuesta debe ser mayor a 0." }

  const s1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
  const s2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
  const s3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]

  addPoints(username, -bet, "slots-apuesta")

  let result, payout = 0, multiplier = 0

  if (s1 === s2 && s2 === s3) {
    // Jackpot especial para 💎 y 7️⃣
    multiplier = (s1 === "💎" || s1 === "7️⃣") ? 20 : 10
    payout = bet * multiplier
    result = "jackpot"
  } else if (s1 === s2 || s2 === s3 || s1 === s3) {
    multiplier = 2
    payout = bet * multiplier
    result = "par"
  } else {
    result = "miss"
  }

  if (payout > 0) addPoints(username, payout, "slots-" + result)

  const finalViewer = getViewer(username)
  const display = \`[ \${s1} | \${s2} | \${s3} ]\`

  let msg = ""
  if (result === "jackpot") {
    msg = \`🎰 \${display} ¡¡JACKPOT!! @\${username} ganó \${payout} pts (\${multiplier}x)! Total: \${finalViewer?.points?.toLocaleString() ?? 0} ✦\`
  } else if (result === "par") {
    msg = \`🎰 \${display} ¡Par! @\${username} ganó \${payout} pts (2x). Total: \${finalViewer?.points?.toLocaleString() ?? 0}\`
  } else {
    msg = \`🎰 \${display} Sin suerte @\${username}, perdiste \${bet} pts. Total: \${finalViewer?.points?.toLocaleString() ?? 0}\`
  }

  return { ok: true, s1, s2, s3, result, payout, bet, multiplier, msg }
}

`

// Insertar antes del module.exports
c = c.replace('module.exports = {', slotsCode + 'module.exports = {')

// Agregar playSlots al exports
c = c.replace(
  'module.exports = {\n  bjOpen, bjClose, bjIsOpen, bjJoin, bjHit, bjStand,\n  rouletteSpin,\n}',
  'module.exports = {\n  bjOpen, bjClose, bjIsOpen, bjJoin, bjHit, bjStand,\n  rouletteSpin, playSlots,\n}'
)

fs.writeFileSync('src/services/games.js', c)
console.log('slots added:', c.includes('playSlots'))
