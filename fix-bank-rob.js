const fs = require('fs')
let c = fs.readFileSync('src/services/economy.js', 'utf8')

const bankCode = `
// ── BANCO ─────────────────────────────────────────────────────────────────────
function depositar(username, display, amount) {
  ensureViewer(username, display)
  const db = getDb()
  const viewer = getViewer(username)
  if (!viewer) return { error: "No encontrado." }
  if (amount <= 0) return { error: "La cantidad debe ser mayor a 0." }
  if (viewer.points < amount) return { error: \`No tenés suficientes puntos. Tenés \${viewer.points} en mano.\` }

  db.prepare(\`UPDATE viewers SET points = points - ?, bank = bank + ? WHERE username = ?\`)
    .run(amount, amount, username.toLowerCase())
  db.prepare(\`INSERT INTO economy_log (username, delta, reason) VALUES (?, ?, ?)\`)
    .run(username.toLowerCase(), -amount, "deposito")

  const updated = getViewer(username)
  return {
    ok: true,
    msg: \`🏦 @\${display} depositó \${amount} pts. En mano: \${updated.points.toLocaleString()} | Banco: \${updated.bank.toLocaleString()} ✦\`
  }
}

function retirar(username, display, amount) {
  ensureViewer(username, display)
  const db = getDb()
  const viewer = getViewer(username)
  if (!viewer) return { error: "No encontrado." }
  if (amount <= 0) return { error: "La cantidad debe ser mayor a 0." }
  if (viewer.bank < amount) return { error: \`No tenés suficientes en el banco. Tenés \${viewer.bank} guardados.\` }

  db.prepare(\`UPDATE viewers SET points = points + ?, bank = bank - ? WHERE username = ?\`)
    .run(amount, amount, username.toLowerCase())
  db.prepare(\`INSERT INTO economy_log (username, delta, reason) VALUES (?, ?, ?)\`)
    .run(username.toLowerCase(), amount, "retiro")

  const updated = getViewer(username)
  return {
    ok: true,
    msg: \`🏦 @\${display} retiró \${amount} pts. En mano: \${updated.points.toLocaleString()} | Banco: \${updated.bank.toLocaleString()} ✦\`
  }
}

function verBanco(username, display) {
  ensureViewer(username, display)
  const viewer = getViewer(username)
  if (!viewer) return { error: "No encontrado." }
  return {
    ok: true,
    msg: \`🏦 @\${display} — En mano: \${viewer.points.toLocaleString()} pts | Banco: \${viewer.bank.toLocaleString()} pts\`
  }
}

// ── ROBAR ─────────────────────────────────────────────────────────────────────
function robar(username, display, targetUsername) {
  ensureViewer(username, display)
  const attacker = getViewer(username)
  const target   = getViewer(targetUsername)

  if (!attacker) return { error: "No encontrado." }
  if (!target)   return { error: \`@\${targetUsername} no está registrado.\` }
  if (username.toLowerCase() === targetUsername.toLowerCase()) return { error: "No podés robarte a vos mismo." }
  if (target.points <= 0) return { error: \`@\${targetUsername} no tiene puntos en mano para robar.\` }

  const success = Math.random() < 0.30  // 30% de éxito

  if (success) {
    const stolen = Math.max(1, Math.floor(target.points * 0.30))
    addPoints(targetUsername, -stolen, \`robado por \${username}\`)
    addPoints(username, stolen, \`robo exitoso a \${targetUsername}\`)
    return {
      ok: true, result: "success", stolen,
      msg: \`🥷 @\${display} robó \${stolen} pts de @\${targetUsername}! Total: \${getViewer(username)?.points?.toLocaleString()} ✦\`
    }
  } else {
    const stolen = Math.max(1, Math.floor(target.points * 0.30))
    const penalty = Math.max(1, Math.floor(stolen * 0.50))
    addPoints(username, -penalty, \`fallo de robo a \${targetUsername}\`)
    return {
      ok: true, result: "fail", penalty,
      msg: \`🥷 @\${display} intentó robar a @\${targetUsername} pero lo cacharon! Perdió \${penalty} pts. Total: \${getViewer(username)?.points?.toLocaleString()}\`
    }
  }
}

`

c = c.replace(
  'module.exports = {\n  ensureViewer, addPoints, onMessage,\n  getViewer, getRanking, getLog, getStats,\n  claimDaily, claimWork,\n}',
  bankCode + 'module.exports = {\n  ensureViewer, addPoints, onMessage,\n  getViewer, getRanking, getLog, getStats,\n  claimDaily, claimWork,\n  depositar, retirar, verBanco, robar,\n}'
)

fs.writeFileSync('src/services/economy.js', c)
console.log('bank:', c.includes('depositar'))
console.log('robar:', c.includes('function robar'))
