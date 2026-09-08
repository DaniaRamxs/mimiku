const fs = require('fs')
let c = fs.readFileSync('src/services/events.js', 'utf8')

// Al invocar boss, mandar boss_spawn
c = c.replace(
  `  say(\`👾 ¡¡BOSS INVOCADO!! HP: \${hp} — Usa !atacar [cantidad] para atacar con tus puntos!\`)
  overlay({ type: "alert", text: \`👾 ¡BOSS INVOCADO! HP: \${hp}\`, duration: 8000 })
  overlay({ type: "game_event", event: "boss_spawn", hp })`,
  `  say(\`👾 ¡¡BOSS INVOCADO!! HP: \${hp} — Usa !atacar [cantidad] para atacar con tus puntos!\`)
  overlay({ type: "alert", text: \`👾 ¡BOSS INVOCADO! HP: \${hp}\`, duration: 5000 })
  overlay({ type: "game_event", event: "boss_spawn", hp, maxHp: hp })`
)

// Al atacar boss, mandar boss_attack con datos actualizados
c = c.replace(
  `  const hpBar = Math.round((boss.hp / boss.maxHp) * 20)
  const bar   = "█".repeat(hpBar) + "░".repeat(20 - hpBar)
  say(\`👾 @\${display} atacó por \${amount} pts! Boss HP: [\${bar}] \${boss.hp}/\${boss.maxHp}\`)
  return { ok: true, bossHp: boss.hp, maxHp: boss.maxHp }`,
  `  const hpBar = Math.round((boss.hp / boss.maxHp) * 20)
  const bar   = "█".repeat(hpBar) + "░".repeat(20 - hpBar)
  const participantCount = Object.keys(boss.participants).length
  say(\`👾 @\${display} atacó por \${amount} pts! Boss HP: [\${bar}] \${boss.hp}/\${boss.maxHp}\`)
  overlay({ type: "game_event", event: "boss_attack", bossHp: boss.hp, maxHp: boss.maxHp, participants: participantCount })
  return { ok: true, bossHp: boss.hp, maxHp: boss.maxHp }`
)

// Al derrotar boss, mandar boss_defeat
c = c.replace(
  `    say(\`👾 ¡BOSS DERROTADO!! Repartiendo \${rewardPool} puntos entre \${participants.length} héroes…\`)
    overlay({ type: "alert", text: \`👾 ¡BOSS DERROTADO! ¡Victoria!\`, duration: 8000 })`,
  `    say(\`👾 ¡BOSS DERROTADO!! Repartiendo \${rewardPool} puntos entre \${participants.length} héroes…\`)
    overlay({ type: "alert", text: \`👾 ¡BOSS DERROTADO! ¡Victoria!\`, duration: 5000 })
    overlay({ type: "game_event", event: "boss_defeat", reward: rewardPool })`
)

fs.writeFileSync('src/services/events.js', c)
console.log('boss events fixed:', c.includes('boss_attack'))
