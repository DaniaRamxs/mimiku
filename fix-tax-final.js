const fs = require('fs')
let c = fs.readFileSync('src/services/events.js', 'utf8')

// Fix: collectTax debe ser async y retornar bien
c = c.replace(
  `async function collectTax(percent = 10) {`,
  `function collectTax(percent = 10) {`
)

// Fix: el IPC handler debe manejar el resultado
let m = fs.readFileSync('main.cjs', 'utf8')
m = m.replace(
  `ipcMain.handle("events:tax",        (_, percent)         => events().collectTax(percent))`,
  `ipcMain.handle("events:tax",        async (_, percent)   => {
  try {
    const result = events().collectTax(percent)
    console.log("[events:tax] result:", result)
    return result
  } catch(e) {
    console.error("[events:tax] error:", e.message)
    return { error: e.message }
  }
})`
)

fs.writeFileSync('src/services/events.js', c)
fs.writeFileSync('main.cjs', m)
console.log('tax fixed')
