const fs = require('fs')

// ── Cara o Cruz en twitch.js ──────────────────────────────────────────────────
let t = fs.readFileSync('src/services/twitch.js', 'utf8')

t = t.replace(
  '  if (cmd === "!daily") {',
  `  if (cmd === "!moneda" || cmd === "!coin" || cmd === "!caracruz") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(\`Uso: !moneda [apuesta]\`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < amount) { say(\`@\${display} no tienes suficientes puntos. Tienes \${viewer?.points ?? 0}.\`); return }
    const win  = Math.random() < 0.5
    const side = win ? "🪙 CARA" : "🟤 CRUZ"
    if (win) {
      addPoints(username, amount, "moneda-ganada")
      say(\`\${side} ¡@\${display} ganó \${amount} pts! Total: \${getViewer(username)?.points?.toLocaleString()} ✦\`)
    } else {
      addPoints(username, -amount, "moneda-perdida")
      say(\`\${side} @\${display} perdió \${amount} pts. Total: \${getViewer(username)?.points?.toLocaleString()}\`)
    }
    send("game:coin", { username, display, amount, win, side })
    sendOverlay({ type: "game_coin", username: display, amount, win, side })
    return
  }

  if (cmd === "!daily") {`
)

fs.writeFileSync('src/services/twitch.js', t)
console.log('moneda cmd:', t.includes('!moneda'))

// ── Rey del Chat toggle en overlay-server (IPC) ───────────────────────────────
let m = fs.readFileSync('main.cjs', 'utf8')
m = m.replace(
  'ipcMain.handle("events:tax"',
  `ipcMain.handle("king:toggle", (_, visible) => {
  overlay().broadcast({ type: "king_toggle", visible })
  return { ok: true }
})

ipcMain.handle("events:tax"`
)
fs.writeFileSync('main.cjs', m)
console.log('king toggle IPC:', m.includes('king:toggle'))
