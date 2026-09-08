const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Cuando se muestra channel-screen, usar flex
c = c.replace(
  `document.getElementById("home-screen").style.display    = "none"
  document.getElementById("channel-screen").style.display = "block"`,
  `document.getElementById("home-screen").style.display    = "none"
  document.getElementById("channel-screen").style.display = "flex"`
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('channel-screen display flex:', c.includes('"flex"'))
