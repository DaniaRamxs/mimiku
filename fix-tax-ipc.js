const fs = require('fs')

// main.cjs — agregar IPC de tax
let m = fs.readFileSync('main.cjs', 'utf8')
m = m.replace(
  'ipcMain.handle("events:chaos",',
  'ipcMain.handle("events:tax",        (_, percent)         => events().collectTax(percent))\nipcMain.handle("events:chaos",'
)
fs.writeFileSync('main.cjs', m)
console.log('tax IPC:', m.includes('events:tax'))

// events-panel.js — agregar función collectTax
let e = fs.readFileSync('src/pages/events-panel.js', 'utf8')
e = e.replace(
  'async function chaosMode() {',
  `async function collectTax() {
  const percent = parseInt(document.getElementById("ev-tax-percent")?.value) || 10
  const result = await ipcRenderer.invoke("events:tax", percent)
  if (result?.error) { showToast(result.error); return }
  showToast(\`🏛 ¡Impuesto del \${percent}% cobrado! \${result.totalCollected} pts recaudados\`)
  await refreshStatus()
}

async function chaosMode() {`
)

e = e.replace(
  'module.exports = {\n  initEvents,\n  rainPoints, gift500, activateMultiplier, activateEqualizer,\n  freezeEconomy, freezeBets, activateShield,\n  spawnBoss, startLottery, drawLottery,\n  randomEvent, chaosMode,\n}',
  'module.exports = {\n  initEvents,\n  rainPoints, gift500, activateMultiplier, activateEqualizer,\n  collectTax,\n  freezeEconomy, freezeBets, activateShield,\n  spawnBoss, startLottery, drawLottery,\n  randomEvent, chaosMode,\n}'
)
fs.writeFileSync('src/pages/events-panel.js', e)
console.log('collectTax fn:', e.includes('collectTax'))
