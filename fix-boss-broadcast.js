const fs = require('fs')
let c = fs.readFileSync('main.cjs', 'utf8')

// Fix: el IPC de spawnBoss también broadcastea directamente al overlay
c = c.replace(
  `ipcMain.handle("events:spawnBoss",    (_, hp)              => { events().spawnBoss(hp); return events().getStatus() })`,
  `ipcMain.handle("events:spawnBoss",    (_, hp)              => {
  events().spawnBoss(hp)
  overlay().broadcast({ type: "game_event", event: "boss_spawn", hp, maxHp: hp })
  return events().getStatus()
})`
)

// Fix: rainPoints también broadcastea
c = c.replace(
  `ipcMain.handle("events:rainPoints",   (_, amount)          => events().rainPoints(amount))`,
  `ipcMain.handle("events:rainPoints",   async (_, amount)    => {
  const result = await events().rainPoints(amount)
  overlay().broadcast({ type: "alert", text: "🎉 ¡Lluvia de " + amount + " puntos!", duration: 6000 })
  return result
})`
)

// Fix: multiplier también broadcastea
c = c.replace(
  `ipcMain.handle("events:multiplier",   (_, { value, mins }) => { events().setMultiplier(value, mins); return events().getStatus() })`,
  `ipcMain.handle("events:multiplier",   (_, { value, mins }) => {
  events().setMultiplier(value, mins)
  overlay().broadcast({ type: "alert", text: "🔥 x" + value + " de recompensas por " + mins + " min!", duration: 6000 })
  overlay().broadcast({ type: "game_event", event: "multiplier", value, minutes: mins })
  return events().getStatus()
})`
)

fs.writeFileSync('main.cjs', c)
console.log('boss broadcast fixed:', c.includes('boss_spawn'))
