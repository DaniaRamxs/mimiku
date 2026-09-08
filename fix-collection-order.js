const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

c = c.replace(
  `.eq("username", state.twitchUser.login.toLowerCase())
    .order("obtained_at", { ascending: false })`,
  `.eq("username", state.twitchUser.login.toLowerCase())`
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('order removed:', !c.includes('order("obtained_at"'))
