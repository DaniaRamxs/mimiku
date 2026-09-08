const fs = require('fs')
let c = fs.readFileSync('main.cjs', 'utf8')

const eventsIPC = `
// ── IPC: Panel de Eventos ─────────────────────────────────────────────────────
function events() { return require("./src/services/events.js") }

ipcMain.handle("events:getStatus",    ()                   => events().getStatus())
ipcMain.handle("events:rainPoints",   (_, amount)          => events().rainPoints(amount))
ipcMain.handle("events:gift500",      ()                   => events().gift500())
ipcMain.handle("events:multiplier",   (_, { value, mins }) => { events().setMultiplier(value, mins); return events().getStatus() })
ipcMain.handle("events:equalizer",    (_, mins)            => events().equalizer(mins))
ipcMain.handle("events:freezeEco",    (_, mins)            => { events().freezeEconomy(mins); return events().getStatus() })
ipcMain.handle("events:freezeBets",   (_, mins)            => { events().freezeBets(mins); return events().getStatus() })
ipcMain.handle("events:shield",       (_, mins)            => { events().activateShield(mins); return events().getStatus() })
ipcMain.handle("events:spawnBoss",    (_, hp)              => { events().spawnBoss(hp); return events().getStatus() })
ipcMain.handle("events:startLottery", (_, price)           => { events().startLottery(price); return events().getStatus() })
ipcMain.handle("events:drawLottery",  ()                   => events().drawLottery())
ipcMain.handle("events:random",       ()                   => events().randomEvent())
ipcMain.handle("events:chaos",        ()                   => events().chaosMode())
`

// insertar antes del IPC de juegos
c = c.replace(
  'ipcMain.handle("games:bj:open"',
  eventsIPC + '\nipcMain.handle("games:bj:open"'
)

fs.writeFileSync('main.cjs', c)
console.log('events IPC added:', c.includes('events:rainPoints'))
