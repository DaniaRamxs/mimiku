const fs = require('fs')
let c = fs.readFileSync('main.cjs', 'utf8')

// Inicializar shopRealtime cuando conecta Twitch
c = c.replace(
  `  require("./src/services/events.js").init(channel, evtSay, payload => overlay().broadcast(payload))`,
  `  require("./src/services/events.js").init(channel, evtSay, payload => overlay().broadcast(payload))
  require("./src/services/shopRealtime.js").init(channel, payload => overlay().broadcast(payload))`
)

fs.writeFileSync('main.cjs', c)
console.log('shopRealtime init:', c.includes('shopRealtime'))
