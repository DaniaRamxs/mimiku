const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

c = c.replace(
  `  if (content) {
    content.style.display = "block"
    content.classList.add("active")
  }`,
  `  if (content) {
    content.style.display = "block"
    content.style.minHeight = "400px"
    content.style.width = "100%"
    content.style.boxSizing = "border-box"
    content.classList.add("active")
  }`
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('fixed:', c.includes('minHeight'))
