const fs = require('fs')
let c = fs.readFileSync('src/app.js', 'utf8')

c = c.replace(
  "const gamesPage = require('./pages/games.js')",
  "const gamesPage = require('./pages/games.js')\nconst cardsPage = require('./pages/cards.js')"
)

c = c.replace(
  "window.gamesPage    = gamesPage",
  "window.gamesPage    = gamesPage\nwindow.cardsPage    = cardsPage"
)

c = c.replace(
  "  gamesPage.initGames()",
  "  gamesPage.initGames()\n  cardsPage.initCards()"
)

fs.writeFileSync('src/app.js', c)
console.log('cardsPage:', c.includes('cardsPage'))
