const fs = require('fs')

// ── main.cjs: agregar IPC handlers para eventos ──────────────────────────────
let m = fs.readFileSync('main.cjs', 'utf8')

const eventsIPC = `
// ── IPC: Panel de Eventos ─────────────────────────────────────────────────────
function events() { return require("./src/services/events.js") }

ipcMain.handle("events:getStatus",   ()                     => events().getStatus())
ipcMain.handle("events:rainPoints",  (_, amount)            => events().rainPoints(amount))
ipcMain.handle("events:gift500",     ()                     => events().gift500())
ipcMain.handle("events:multiplier",  (_, { value, mins })   => { events().setMultiplier(value, mins); return events().getStatus() })
ipcMain.handle("events:equalizer",   (_, mins)              => events().equalizer(mins))
ipcMain.handle("events:freezeEco",   (_, mins)              => { events().freezeEconomy(mins); return events().getStatus() })
ipcMain.handle("events:freezeBets",  (_, mins)              => { events().freezeBets(mins); return events().getStatus() })
ipcMain.handle("events:shield",      (_, mins)              => { events().activateShield(mins); return events().getStatus() })
ipcMain.handle("events:spawnBoss",   (_, hp)                => { events().spawnBoss(hp); return events().getStatus() })
ipcMain.handle("events:startLottery",(_, price)             => { events().startLottery(price); return events().getStatus() })
ipcMain.handle("events:drawLottery", ()                     => events().drawLottery())
ipcMain.handle("events:random",      ()                     => events().randomEvent())
ipcMain.handle("events:chaos",       ()                     => events().chaosMode())
`

m = m.replace(
  '// ── IPC: juegos ─────────────────────────────────────────────────────────────',
  eventsIPC + '\n// ── IPC: juegos ─────────────────────────────────────────────────────────────'
)

// Inicializar events service cuando conecta Twitch
m = m.replace(
  "  twitch().setBroadcast(payload => overlay().broadcast(payload))",
  `  twitch().setBroadcast(payload => overlay().broadcast(payload))
  // inicializar panel de eventos
  const evtSay = (msg) => { try { require("./src/services/twitch.js").say(msg) } catch {} }
  require("./src/services/events.js").init(channel, evtSay, payload => overlay().broadcast(payload))`
)

fs.writeFileSync('main.cjs', m)
console.log('events IPC added:', m.includes('events:rainPoints'))

// ── twitch.js: agregar comandos de eventos ────────────────────────────────────
let t = fs.readFileSync('src/services/twitch.js', 'utf8')

// Agregar import de events
t = t.replace(
  "const games = require('./games.js')",
  "const games = require('./games.js')\nconst events = require('./events.js')"
)

// Agregar función say exportada
t = t.replace(
  'function disconnect() {\n  client?.disconnect().catch(() => {})\n  client = null\n}\n\nmodule.exports = { connect, disconnect, setWindow, setBroadcast }',
  `function disconnect() {
  client?.disconnect().catch(() => {})
  client = null
}

function sayPublic(msg) { say(msg) }

module.exports = { connect, disconnect, setWindow, setBroadcast, say: sayPublic }`
)

// Agregar comandos de eventos antes de !comandos
t = t.replace(
  '  if (cmd === "!comandos" || cmd === "!cmds") {',
  `  if (cmd === "!atacar") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(\`Uso: !atacar [cantidad]\`); return }
    const result = events.attackBoss(username, display, amount)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    if (result.defeated) send("twitch:event", { type:"boss", text:"¡Boss derrotado!", username })
    return
  }

  if (cmd === "!boleto") {
    const result = events.buyLotteryTicket(username, display)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    send("twitch:event", { type:"lottery", text:\`@\${display} compró boleto\`, username })
    return
  }

  if (cmd === "!comandos" || cmd === "!cmds") {`
)

// Aplicar multiplicador en puntos por mensaje
t = t.replace(
  'const viewer = onMessage(username, display, 2)',
  `const mult = events.getMultiplier()
    if (events.isEconomyFrozen()) {
      send("twitch:message", { username, display, message, color: tags.color||"#7c6ef5", points: 0, badges: tags.badges||{} })
      return
    }
    const viewer = onMessage(username, display, 2 * mult)`
)

fs.writeFileSync('src/services/twitch.js', t)
console.log('events cmds added:', t.includes('!atacar'))
console.log('multiplier applied:', t.includes('getMultiplier'))
