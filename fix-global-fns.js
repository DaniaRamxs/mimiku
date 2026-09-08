const fs = require('fs')
let c = fs.readFileSync('src/app.js', 'utf8')

// Exponer deleteCard globalmente
c = c.replace(
  'window.cardsPage    = cardsPage',
  `window.cardsPage    = cardsPage
window.deleteCard   = (id) => cardsPage.deleteCard(id)
window.uploadCardImage = (file) => cardsPage.uploadCardImage(file)`
)

fs.writeFileSync('src/app.js', c)
console.log('deleteCard exposed:', c.includes('window.deleteCard'))
