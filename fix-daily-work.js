const fs = require('fs')
let c = fs.readFileSync('src/services/twitch.js', 'utf8')

// actualizar import de economy
c = c.replace(
  'const { onMessage, addPoints, getViewer, getRanking } = require("./economy.js")',
  'const { onMessage, addPoints, getViewer, getRanking, claimDaily, claimWork } = require("./economy.js")'
)

// agregar comandos !daily y !work antes de !comandos
c = c.replace(
  '  if (cmd === "!comandos" || cmd === "!cmds") {',
  `  if (cmd === "!daily") {
    const result = claimDaily(username, display)
    say(result.msg)
    if (result.ok) send("twitch:event", { type:"daily", text: result.msg, username })
    return
  }

  if (cmd === "!work") {
    const result = claimWork(username, display)
    say(result.msg)
    if (result.ok) send("twitch:event", { type:"work", text: result.msg, username })
    return
  }

  if (cmd === "!comandos" || cmd === "!cmds") {`
)

// actualizar lista de comandos
c = c.replace(
  'say(`Comandos: !puntos !ranking !ruleta [pts] [tipo] !bj [pts] !hit !stand !duelo [@user] [pts]`)',
  'say(`Comandos: !puntos !ranking !daily !work !ruleta [pts] [tipo] !bj [pts] !hit !stand !duelo [@user] [pts]`)'
)

// actualizar mensaje de conexión
c = c.replace(
  "say(`mimiku activo ✦ Comandos: !puntos !ranking !ruleta !bj !duelo`)",
  "say(`mimiku activo ✦ Comandos: !puntos !daily !work !ranking !ruleta !bj !duelo`)"
)

fs.writeFileSync('src/services/twitch.js', c)
console.log('daily:', c.includes('claimDaily'))
console.log('work:', c.includes('claimWork'))
