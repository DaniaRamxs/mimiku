const fs = require('fs')
let c = fs.readFileSync('src/services/twitch.js', 'utf8')

// actualizar import
c = c.replace(
  'const { onMessage, addPoints, getViewer, getRanking, claimDaily, claimWork } = require("./economy.js")',
  'const { onMessage, addPoints, getViewer, getRanking, claimDaily, claimWork, depositar, retirar, verBanco, robar } = require("./economy.js")'
)

// agregar comandos antes de !daily
c = c.replace(
  '  if (cmd === "!daily") {',
  `  if (cmd === "!depositar" || cmd === "!dep") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(\`Uso: !depositar [cantidad]\`); return }
    const result = depositar(username, display, amount)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    say(result.msg)
    return
  }

  if (cmd === "!retirar" || cmd === "!ret") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(\`Uso: !retirar [cantidad]\`); return }
    const result = retirar(username, display, amount)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    say(result.msg)
    return
  }

  if (cmd === "!banco" || cmd === "!bank") {
    const result = verBanco(username, display)
    say(result.msg)
    return
  }

  if (cmd === "!robar" || cmd === "!steal") {
    const target = parts[1]?.replace("@","").toLowerCase()
    if (!target) { say(\`Uso: !robar @usuario\`); return }
    const result = robar(username, display, target)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    say(result.msg)
    send("twitch:event", { type:"robar", text: result.msg, username, result: result.result })
    return
  }

  if (cmd === "!daily") {`
)

// actualizar !comandos
c = c.replace(
  'say(`Comandos: !puntos !ranking !daily !work !slots [pts] !ruleta [pts] [tipo] !bj [pts] !hit !stand !duelo [@user] [pts]`)',
  'say(`Cmds: !puntos !banco !depositar !retirar !daily !work !slots !ruleta !bj !hit !stand !duelo !robar`)'
)

fs.writeFileSync('src/services/twitch.js', c)
console.log('depositar:', c.includes('depositar(username'))
console.log('robar cmd:', c.includes('robar(username'))
