const fs = require('fs')
let c = fs.readFileSync('src/services/events.js', 'utf8')

c = c.replace(
  `  return { ok: true, bossHp: boss.hp, maxHp: boss.maxHp }`,
  `  return { ok: true, bossHp: boss.hp, maxHp: boss.maxHp, participants: participantCount }`
)

fs.writeFileSync('src/services/events.js', c)
console.log('fixed:', c.includes('participants: participantCount'))
