const fs = require('fs')
let c = fs.readFileSync('app.js', 'utf8')

c = c.replace(
  `document.getElementById("home-screen").style.display = "none"
  document.getElementById("channel-screen").classList.add("visible")`,
  `document.getElementById("home-screen").style.display = "none"
  const cs = document.getElementById("channel-screen")
  cs.style.display = ""
  cs.classList.add("visible")`
)

fs.writeFileSync('app.js', c)
console.log('fixed:', c.includes('cs.style.display = ""'))
