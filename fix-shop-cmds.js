const fs = require('fs')
let c = fs.readFileSync('src/services/twitch.js', 'utf8')

// Agregar import de shop
c = c.replace(
  "const events = require('./events.js')",
  "const events = require('./events.js')\nconst shop   = require('./shop.js')"
)

// Agregar comandos de tienda antes de !comandos
c = c.replace(
  '  if (cmd === "!comandos" || cmd === "!cmds") {',
  `  // !confeti — comprar alerta de confeti (300 pts, cooldown 30s)
  if (cmd === "!confeti" || cmd === "!confetti") {
    const cd = shop.checkCooldown(username, "confeti")
    if (cd > 0) { say(\`@\${display} espera \${Math.ceil(cd/1000)}s para volver a usar confeti.\`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < 300) { say(\`@\${display} necesitas 300 pts para el confeti. Tienes \${viewer?.points ?? 0}.\`); return }
    addPoints(username, -300, "compra-confeti")
    shop.setCooldown(username, "confeti")
    say(\`🎉 @\${display} compró confeti! ¡¡LLUVIA DE CONFETI!!\`)
    sendOverlay({ type: "confetti", duration: 6000 })
    send("twitch:event", { type:"shop", text:\`🎉 \${display} activó confeti!\`, username })
    return
  }

  // !arcoiris — comprar alerta de arcoíris (200 pts, cooldown 30s)
  if (cmd === "!arcoiris" || cmd === "!rainbow") {
    const cd = shop.checkCooldown(username, "arcoiris")
    if (cd > 0) { say(\`@\${display} espera \${Math.ceil(cd/1000)}s.\`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < 200) { say(\`@\${display} necesitas 200 pts. Tienes \${viewer?.points ?? 0}.\`); return }
    addPoints(username, -200, "compra-arcoiris")
    shop.setCooldown(username, "arcoiris")
    say(\`🌈 @\${display} compró un arcoíris! ¡Ahí viene!\`)
    sendOverlay({ type: "rainbow", duration: 5000 })
    send("twitch:event", { type:"shop", text:\`🌈 \${display} activó arcoíris!\`, username })
    return
  }

  // !misterio — evento misterioso (500 pts)
  if (cmd === "!misterio" || cmd === "!mystery") {
    const cd = shop.checkCooldown(username, "misterio")
    if (cd > 0) { say(\`@\${display} espera \${Math.ceil(cd/1000)}s.\`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < 500) { say(\`@\${display} necesitas 500 pts. Tienes \${viewer?.points ?? 0}.\`); return }
    addPoints(username, -500, "compra-misterio")
    shop.setCooldown(username, "misterio")

    // elegir efecto aleatorio
    const roll = Math.random()
    say(\`🎲 @\${display} activó el Evento Misterioso... ¿qué pasará?\`)

    setTimeout(() => {
      if (roll < 0.15) {
        // Lluvia de puntos para todos (50 pts)
        events.rainPoints(50)
      } else if (roll < 0.25) {
        // Boss
        events.spawnBoss(3000)
        sendOverlay({ type: "game_event", event: "boss_spawn", hp: 3000, maxHp: 3000 })
      } else if (roll < 0.40) {
        // Multiplicador x2 por 3 minutos
        events.setMultiplier(2, 3)
        sendOverlay({ type: "alert", text: "🔥 x2 por 3 min (evento misterioso)", duration: 5000 })
      } else if (roll < 0.55) {
        // El comprador pierde 200 pts extra
        addPoints(username, -200, "misterio-mala-suerte")
        say(\`💀 ¡Mala suerte @\${display}! Perdiste 200 pts extra.\`)
        sendOverlay({ type: "alert", text: \`💀 @\${display} tuvo mala suerte en el misterio!\`, duration: 5000 })
      } else if (roll < 0.70) {
        // El comprador gana 1000 pts
        addPoints(username, 1000, "misterio-jackpot")
        say(\`💰 ¡JACKPOT! @\${display} ganó 1000 pts del evento misterioso!\`)
        sendOverlay({ type: "alert", text: \`💰 ¡@\${display} ganó 1000 pts del misterio!\`, duration: 6000 })
      } else if (roll < 0.80) {
        // Confeti
        sendOverlay({ type: "confetti", duration: 6000 })
        say(\`🎉 ¡CONFETI! Resultado del evento misterioso.\`)
      } else if (roll < 0.90) {
        // Arcoíris
        sendOverlay({ type: "rainbow", duration: 5000 })
        say(\`🌈 ¡ARCOÍRIS! Resultado del evento misterioso.\`)
      } else {
        // Robar 30% a un viewer random
        const ranking = getRanking(10)
        const targets = ranking.filter(v => v.username !== username && v.points > 0)
        if (targets.length) {
          const target = targets[Math.floor(Math.random() * targets.length)]
          const stolen = Math.floor(target.points * 0.3)
          addPoints(target.username, -stolen, "misterio-robo")
          addPoints(username, stolen, "misterio-robo-ganado")
          say(\`🥷 ¡El misterio robó \${stolen} pts de @\${target.display||target.username} para @\${display}!\`)
          sendOverlay({ type: "alert", text: \`🥷 @\${display} robó \${stolen} pts por el misterio!\`, duration: 5000 })
        }
      }
    }, 2000)
    return
  }

  if (cmd === "!comandos" || cmd === "!cmds") {`
)

// Actualizar lista de comandos
c = c.replace(
  "say(`Cmds: !puntos !banco !depositar !retirar !daily !work !slots !ruleta !bj !hit !stand !duelo !robar`)",
  "say(`Cmds: !puntos !banco !daily !work !slots !ruleta !bj !moneda !duelo !robar !confeti !arcoiris !misterio`)"
)

fs.writeFileSync('src/services/twitch.js', c)
console.log('shop cmds added:', c.includes('!misterio'))
console.log('confeti cmd:', c.includes('!confeti'))
