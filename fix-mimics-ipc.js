const fs = require('fs')
let c = fs.readFileSync('main.cjs', 'utf8')

// Inicializar mimics cuando conecta Twitch
c = c.replace(
  `  require("./src/services/shopRealtime.js").init(channel, payload => overlay().broadcast(payload))`,
  `  require("./src/services/shopRealtime.js").init(channel, payload => overlay().broadcast(payload))
  require("./src/services/mimics.js").init(channel, payload => overlay().broadcast(payload))`
)

// Agregar IPC handlers de mimics antes de los de eventos
const mimicsIPC = `
// ── IPC: Mimics ───────────────────────────────────────────────────────────────
const mimicsService = require("./src/services/mimics.js")
ipcMain.handle("mimics:list",        (_, ch)          => mimicsService.listMimics(ch))
ipcMain.handle("mimics:create",      (_, { ch, m })   => mimicsService.createMimic(ch, m))
ipcMain.handle("mimics:update",      (_, { id, u })   => mimicsService.updateMimic(id, u))
ipcMain.handle("mimics:delete",      (_, id)          => mimicsService.deleteMimic(id))
ipcMain.handle("mimics:listBoxes",   (_, ch)          => mimicsService.listBoxes(ch))
ipcMain.handle("mimics:createBox",   (_, { ch, b })   => mimicsService.createBox(ch, b))
ipcMain.handle("mimics:deleteBox",   (_, id)          => mimicsService.deleteBox(id))

`

c = c.replace(
  '// ── IPC: Panel de Eventos ─────────────────────────────────────────────────────',
  mimicsIPC + '// ── IPC: Panel de Eventos ─────────────────────────────────────────────────────'
)

fs.writeFileSync('main.cjs', c)
console.log('mimics init:', c.includes('mimics.js").init'))
console.log('mimics IPC:', c.includes('mimics:create'))
