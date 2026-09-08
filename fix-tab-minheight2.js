const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

c = c.replace(
  'if (content) { content.classList.add("active"); content.style.display = "block" }',
  'if (content) { content.classList.add("active"); content.style.display = "block"; content.style.minHeight = "400px"; content.style.width = "100%"; }'
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('fixed:', c.includes('minHeight'))
