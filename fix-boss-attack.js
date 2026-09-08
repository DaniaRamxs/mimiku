const fs = require('fs')
let c = fs.readFileSync('src/services/twitch.js', 'utf8')

c = c.replace(
  `    const result = events.attackBoss(username, display, amount)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    if (result.defeated) send("twitch:event", { type:"boss", text:"¡Boss derrotado!", username })
    return`,
  `    const result = events.attackBoss(username, display, amount)
    if (result.error) { say(\`@\${display} \${result.error}\`); return }
    if (result.defeated) {
      send("twitch:event", { type:"boss", text:"¡Boss derrotado!", username })
      sendOverlay({ type: "game_event", event: "boss_attack", bossHp: 0, maxHp: result.maxHp || 5000, participants: 0 })
    } else {
      sendOverlay({ type: "game_event", event: "boss_attack", bossHp: result.bossHp, maxHp: result.maxHp, participants: result.participants || 1 })
    }
    return`
)

fs.writeFileSync('src/services/twitch.js', c)
console.log('boss attack overlay fixed:', c.includes('boss_attack'))
