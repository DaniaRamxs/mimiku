const fs = require('fs')
let c = fs.readFileSync('src/services/twitch.js', 'utf8')

// agregar playSlots al import
c = c.replace(
  'const games = require("./games.js")',
  'const games = require("./games.js")'
)

// agregar comando !slots antes de !daily
c = c.replace(
  '  if (cmd === "!daily") {',
  `  if (cmd === "!slots" || cmd === "!tragamonedas") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(\`Uso: !slots [apuesta]\`); return }
    const result = games.playSlots(username, amount)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    say(result.msg)
    send("game:slots", { ...result, username, display })
    sendOverlay({ type: "game_slots", ...result, username, display })
    return
  }

  if (cmd === "!daily") {`
)

// actualizar !comandos
c = c.replace(
  'say(`Comandos: !puntos !ranking !daily !work !ruleta [pts] [tipo] !bj [pts] !hit !stand !duelo [@user] [pts]`)',
  'say(`Comandos: !puntos !daily !work !ranking !slots [pts] !ruleta [pts] [tipo] !bj [pts] !hit !stand !duelo [@user] [pts]`)'
)

c = c.replace(
  "say(`mimiku activo ✦ Comandos: !puntos !daily !work !ranking !ruleta !bj !duelo`)",
  "say(`mimiku activo ✦ Comandos: !puntos !daily !work !slots !ruleta !bj !duelo`)"
)

fs.writeFileSync('src/services/twitch.js', c)
console.log('slots cmd:', c.includes('playSlots'))
