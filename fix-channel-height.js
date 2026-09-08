const fs = require('fs')
let c = fs.readFileSync('mod-panel/index.html', 'utf8')

// Agregar min-height al channel-screen y ch-content inline
c = c.replace(
  '<div id="channel-screen" style="display:none">',
  '<div id="channel-screen" style="display:none;min-height:100vh;display:flex;flex-direction:column">'
)

// ch-content debe tener flex:1 y overflow auto
c = c.replace(
  '<div id="ch-content">',
  '<div id="ch-content" style="flex:1;overflow-y:auto;padding:24px 32px">'
)

fs.writeFileSync('mod-panel/index.html', c)
console.log('channel-screen fixed:', c.includes('min-height:100vh'))
console.log('ch-content fixed:', c.includes('flex:1;overflow-y'))
