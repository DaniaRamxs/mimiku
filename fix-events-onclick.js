const fs = require('fs')
let c = fs.readFileSync('src/index.html', 'utf8')

// Corregir todos los onclick de eventos
const fixes = [
  ['onclick="window.eventsPage.rainPoints()"',        'onclick="window.eventsPage.rainPoints()"'],
  ['onclick="ipcRenderer.invoke(\'events:gift500\').then(()=>showToast(\'💸 ¡500 pts para todos!\'))"', 'onclick="window.eventsPage.gift500()"'],
  ['onclick="window.eventsPage.activateMultiplier()"', 'onclick="window.eventsPage.activateMultiplier()"'],
  ['onclick="ipcRenderer.invoke(\'events:equalizer\', 5).then(()=>showToast(\'🧲 ¡Equilibrador activado!\'))"', 'onclick="window.eventsPage.activateEqualizer()"'],
  ['onclick="window.eventsPage.spawnBoss()"',          'onclick="window.eventsPage.spawnBoss()"'],
  ['onclick="window.eventsPage.startLottery()"',       'onclick="window.eventsPage.startLottery()"'],
  ['onclick="window.eventsPage.drawLottery()"',        'onclick="window.eventsPage.drawLottery()"'],
  ['onclick="ipcRenderer.invoke(\'events:freezeEco\', 5).then(()=>showToast(\'🛑 Economía congelada\'))"', 'onclick="window.eventsPage.freezeEconomy()"'],
  ['onclick="ipcRenderer.invoke(\'events:freezeBets\', 5).then(()=>showToast(\'❄ Apuestas congeladas\'))"', 'onclick="window.eventsPage.freezeBets()"'],
  ['onclick="ipcRenderer.invoke(\'events:shield\', 5).then(()=>showToast(\'🛡 Escudo activado\'))"', 'onclick="window.eventsPage.activateShield()"'],
  ['onclick="ipcRenderer.invoke(\'events:random\').then(()=>showToast(\'🌟 ¡Evento aleatorio!\'))"', 'onclick="window.eventsPage.randomEvent()"'],
  ['onclick="ipcRenderer.invoke(\'events:chaos\').then(()=>showToast(\'🎭 ¡MODO CAOS!\'))"', 'onclick="window.eventsPage.chaosMode()"'],
  // Funciones no existentes
  ['onclick="window.eventsPage.activateHappyHour()"', 'onclick="window.eventsPage.activateMultiplier()"'],
  ['onclick="window.eventsPage.activateMuerte()"',    'onclick="window.eventsPage.randomEvent()"'],
  ['onclick="window.eventsPage.activateTax()"',       'onclick="window.eventsPage.freezeEconomy()"'],
  ['onclick="window.eventsPage.crownKing()"',         'onclick="window.eventsPage.activateEqualizer()"'],
  ['onclick="window.eventsPage.toggleCoin()"',        'onclick="window.eventsPage.gift500()"'],
]

for (const [old, newStr] of fixes) {
  c = c.split(old).join(newStr)
}

fs.writeFileSync('src/index.html', c)
console.log('onclick fixes applied')
