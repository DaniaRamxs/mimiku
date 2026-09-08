const fs = require('fs')
let c = fs.readFileSync('src/pages/games.js', 'utf8')

// agregar listener de slots en initGames
c = c.replace(
  "  ipcRenderer.on('game:bj', (_, data) => addBjEvent(data))",
  "  ipcRenderer.on('game:bj', (_, data) => addBjEvent(data))\n  ipcRenderer.on('game:slots', (_, data) => addSlotsEvent(data))"
)

// agregar función addSlotsEvent
c = c.replace(
  'module.exports = { initGames, toggleBj }',
  `function addSlotsEvent(data) {
  const feed = document.getElementById("slots-feed")
  if (!feed) return
  const empty = feed.querySelector(".empty")
  if (empty) empty.remove()

  const icons = { jackpot:"🎰", par:"✨", miss:"💸" }
  const colors = { jackpot:"#7c6ef5", par:"#22c55e", miss:"#f87171" }
  const labels = { jackpot:\`JACKPOT \${data.multiplier}x\`, par:"Par 2x", miss:"Sin suerte" }

  const el = document.createElement("div")
  el.className = "game-event"
  el.innerHTML = \`
    <span class="game-event-icon">\${icons[data.result]||"🎰"}</span>
    <span style="font-size:11px;color:var(--text-muted)">[\${data.s1}|\${data.s2}|\${data.s3}]</span>
    <span style="flex:1;font-size:12px">\${data.display||data.username}</span>
    <span style="color:\${colors[data.result]||'#e8e8f0'};font-weight:600;font-size:12px">\${labels[data.result]||""}</span>
  \`
  feed.prepend(el)
  if (feed.children.length > 20) feed.lastChild.remove()
}

module.exports = { initGames, toggleBj }`
)

fs.writeFileSync('src/pages/games.js', c)
console.log('slots feed:', c.includes('addSlotsEvent'))
