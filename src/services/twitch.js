// services/twitch.js — cliente tmi.js con economía, comandos y minijuegos
const tmi = require("tmi.js")
const { onMessage, addPoints, getViewer, getRanking, claimDaily, claimWork, depositar, retirar, verBanco, robar } = require("./economy.js")
const games  = require("./games.js")
const events = require("./events.js")

let client   = null
let _win     = null
let _channel = null
let _broadcast = null

// Contador de mensajes en sesión (se resetea al conectar)
const sessionMsgs = {}  // username → { display, count }
let kingUpdateTimer = null

function addSessionMsg(username, display) {
  if (!sessionMsgs[username]) sessionMsgs[username] = { display: display || username, count: 0 }
  sessionMsgs[username].count++
  sessionMsgs[username].display = display || username

  // actualizar rey del chat cada 5 mensajes o 10 segundos
  clearTimeout(kingUpdateTimer)
  kingUpdateTimer = setTimeout(broadcastKing, 500)
}

function broadcastKing() {
  const entries = Object.entries(sessionMsgs)
  if (!entries.length) return
  const [username, data] = entries.sort((a, b) => b[1].count - a[1].count)[0]
  if (_broadcast) _broadcast({ type: "king_update", username, display: data.display, messages: data.count })
}

function resetSessionMsgs() {
  Object.keys(sessionMsgs).forEach(k => delete sessionMsgs[k])
}  // función para mandar al overlay WS

function setWindow(win) { _win = win }
function setBroadcast(fn) { _broadcast = fn }

function send(event, data) {
  if (_win && !_win.isDestroyed()) _win.webContents.send(event, data)
}

function sendOverlay(payload) {
  if (_broadcast) _broadcast(payload)
}

function say(msg) {
  if (client && _channel) client.say(_channel, msg).catch(() => {})
}

function isMod(tags) {
  return tags.mod || tags.badges?.broadcaster === "1" || tags["user-type"] === "mod"
}

// ── Comandos ──────────────────────────────────────────────────────────────────
async function handleCommand(ch, tags, message) {
  const parts    = message.trim().split(/\s+/)
  const cmd      = parts[0].toLowerCase()
  const username = tags.username || "anon"
  const display  = tags["display-name"] || username

  if (cmd === "!puntos") {
    const viewer = getViewer(username)
    say(`@${display} tenés ${(viewer?.points ?? 0).toLocaleString()} puntos ✦`)
    return
  }

  if (cmd === "!level" || cmd === "!nivel" || cmd === "!xp") {
    const levels = require("./levels.js")
    levels.getViewerLevel(_channel, username).then(info => {
      const title = levels.titleForLevel(info.level, null)
      say(`${title.icon} @${display} — Nivel ${info.level} (${title.title}) · ${info.into}/${info.needed} XP para el siguiente`)
    }).catch(() => {})
    return
  }

  if (cmd === "!ranking") {
    const top  = getRanking(5)
    if (!top.length) { say("Sin datos de ranking aún."); return }
    const list = top.map((v, i) => `${i+1}. ${v.display||v.username} (${v.points.toLocaleString()})`).join(" | ")
    say(`🏆 ${list}`)
    return
  }

  if (cmd === "!dar") {
    if (!isMod(tags)) { say(`@${display} solo los mods pueden dar puntos.`); return }
    const target = parts[1]?.replace("@","").toLowerCase()
    const amount = parseInt(parts[2])
    if (!target || isNaN(amount) || amount <= 0) { say(`Uso: !dar [usuario] [cantidad]`); return }
    const viewer = addPoints(target, amount, `regalo de ${username}`)
    say(`✦ @${target} recibió ${amount} pts de @${display}! Total: ${viewer?.points?.toLocaleString() ?? 0}`)
    send("twitch:event", { type:"dar", text:`✦ ${display} dio ${amount} pts a ${target}`, username })
    return
  }

  if (cmd === "!quitar") {
    if (!isMod(tags)) return
    const target = parts[1]?.replace("@","").toLowerCase()
    const amount = parseInt(parts[2])
    if (!target || isNaN(amount) || amount <= 0) { say(`Uso: !quitar [usuario] [cantidad]`); return }
    const viewer = addPoints(target, -amount, `quita de ${username}`)
    say(`@${target} ahora tiene ${viewer?.points?.toLocaleString() ?? 0} pts.`)
    return
  }

  if (cmd === "!ruleta") {
    const amount  = parseInt(parts[1])
    const betType = parts[2] || "rojo"
    if (isNaN(amount) || amount <= 0) { say(`Uso: !ruleta [cantidad] [rojo|negro|par|impar|alto|bajo|número]`); return }
    const result = games.rouletteSpin(username, betType, amount)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    send("game:roulette", result)
    // mandar al overlay
    sendOverlay({
      type: "game_roulette",
      number: result.number,
      color: result.color,
      win: result.win,
      username: display,
      msg: result.win
        ? `🎡 ${display} apostó ${betType} y ganó ${result.gained} pts!`
        : `🎡 ${display} apostó ${betType} y perdió ${amount} pts`,
    })
    return
  }

  if (cmd === "!bj" || cmd === "!blackjack") {
    if (!games.bjIsOpen()) { say(`@${display} el Blackjack no está activo ahora.`); return }
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(`Uso: !bj [cantidad]`); return }
    const result = games.bjJoin(username, amount)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    send("game:bj", { action:"join", username, display, ...result })
    return
  }

  if (cmd === "!hit") {
    const result = games.bjHit(username)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    send("game:bj", { action:"hit", username, display, ...result })
    // si terminó mandar al overlay
    if (result.result) {
      sendOverlay({ type: "game_bj", username: display, result: result.result, msg: result.msg, bet: result.bet, payout: result.payout })
    }
    return
  }

  if (cmd === "!stand" || cmd === "!plantarse") {
    const result = games.bjStand(username)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    send("game:bj", { action:"stand", username, display, ...result })
    sendOverlay({ type: "game_bj", username: display, result: result.result, msg: result.msg, bet: result.bet, payout: result.payout })
    return
  }

  if (cmd === "!duel" || cmd === "!duelo") {
    const target = parts[1]?.replace("@","").toLowerCase()
    const amount = parseInt(parts[2])
    if (!target || isNaN(amount) || amount <= 0) { say(`Uso: !duelo [@usuario] [cantidad]`); return }
    const challenger = getViewer(username)
    const opponent   = getViewer(target)
    if (!challenger || challenger.points < amount) { say(`@${display} no tenés suficientes puntos.`); return }
    if (!opponent || opponent.points < amount)     { say(`@${target} no tiene suficientes puntos.`); return }
    const win    = Math.random() < 0.5
    const winner = win ? username : target
    const loser  = win ? target : username
    addPoints(winner,  amount, "duelo-ganador")
    addPoints(loser,  -amount, "duelo-perdedor")
    const winnerV = getViewer(winner)
    say(`⚔️ ¡${win ? display : target} venció a ${win ? target : display} y ganó ${amount} pts! Total: ${winnerV?.points?.toLocaleString() ?? 0} ✦`)
    send("twitch:event", { type:"duel", text:`⚔️ ${winner} venció en duelo a ${loser}!`, username })
    return
  }

  if (cmd === "!slots" || cmd === "!tragamonedas") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(`Uso: !slots [apuesta]`); return }
    const result = games.playSlots(username, amount)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    send("game:slots", { ...result, username, display })
    sendOverlay({ type: "game_slots", ...result, username, display })
    return
  }

  if (cmd === "!depositar" || cmd === "!dep") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(`Uso: !depositar [cantidad]`); return }
    const result = depositar(username, display, amount)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    return
  }

  if (cmd === "!retirar" || cmd === "!ret") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(`Uso: !retirar [cantidad]`); return }
    const result = retirar(username, display, amount)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    return
  }

  if (cmd === "!banco" || cmd === "!bank") {
    const result = verBanco(username, display)
    say(result.msg)
    return
  }

  if (cmd === "!robar" || cmd === "!steal") {
    const target = parts[1]?.replace("@","").toLowerCase()
    if (!target) { say(`Uso: !robar @usuario`); return }
    const result = robar(username, display, target)
    if (result.error) { say(`@${display} ${result.error}`); return }
    say(result.msg)
    send("twitch:event", { type:"robar", text: result.msg, username, result: result.result })
    return
  }

  if (cmd === "!moneda" || cmd === "!coin" || cmd === "!caracruz") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(`Uso: !moneda [apuesta]`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < amount) { say(`@${display} no tienes suficientes puntos. Tienes ${viewer?.points ?? 0}.`); return }
    const win  = Math.random() < 0.5
    const side = win ? "🪙 CARA" : "🟤 CRUZ"
    if (win) {
      addPoints(username, amount, "moneda-ganada")
      say(`${side} ¡@${display} ganó ${amount} pts! Total: ${getViewer(username)?.points?.toLocaleString()} ✦`)
    } else {
      addPoints(username, -amount, "moneda-perdida")
      say(`${side} @${display} perdió ${amount} pts. Total: ${getViewer(username)?.points?.toLocaleString()}`)
    }
    send("game:coin", { username, display, amount, win, side })
    sendOverlay({ type: "game_coin", username: display, amount, win, side })
    return
  }

  if (cmd === "!daily") {
    const result = claimDaily(username, display)
    say(result.msg)
    if (result.ok) send("twitch:event", { type:"daily", text: result.msg, username })
    return
  }

  if (cmd === "!work") {
    const result = claimWork(username, display)
    say(result.msg)
    if (result.ok) send("twitch:event", { type:"work", text: result.msg, username })
    return
  }

  if (cmd === "!atacar") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(`Uso: !atacar [cantidad]`); return }
    const result = events.attackBoss(username, display, amount)
    if (result.error) { say(`@${display} ${result.error}`); return }
    if (result.defeated) {
      send("twitch:event", { type:"boss", text:"¡Boss derrotado!", username })
      sendOverlay({ type: "game_event", event: "boss_attack", bossHp: 0, maxHp: result.maxHp || 5000, participants: 0 })
    } else {
      sendOverlay({ type: "game_event", event: "boss_attack", bossHp: result.bossHp, maxHp: result.maxHp, participants: result.participants || 1 })
    }
    return
  }

  if (cmd === "!boleto") {
    const result = events.buyLotteryTicket(username, display)
    if (result.error) { say(`@${display} ${result.error}`); return }
    send("twitch:event", { type:"lottery", text:`@${display} compró boleto`, username })
    return
  }

  if (cmd === "!coin") {
    const amount = parseInt(parts[1])
    if (isNaN(amount) || amount <= 0) { say(`@${display} Uso: !coin [cantidad]`); return }
    const result = events.flipCoin(username, display, amount)
    if (result.error) { say(`@${display} ${result.error}`); return }
    const emoji = result.result === "cara" ? "🪙" : "✨"
    say(`${emoji} @${display} sacó ${result.result.toUpperCase()}! ${result.won ? `+${amount} pts` : `-${amount} pts`}`)
    send("twitch:event", { type:"coin", text:`${emoji} ${display} sacó ${result.result}!`, username })
    return
  }

  // !confeti — comprar alerta de confeti (300 pts, cooldown 30s)
  if (cmd === "!confeti" || cmd === "!confetti") {
    const cd = shop.checkCooldown(username, "confeti")
    if (cd > 0) { say(`@${display} espera ${Math.ceil(cd/1000)}s para volver a usar confeti.`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < 300) { say(`@${display} necesitas 300 pts para el confeti. Tienes ${viewer?.points ?? 0}.`); return }
    addPoints(username, -300, "compra-confeti")
    shop.setCooldown(username, "confeti")
    say(`🎉 @${display} compró confeti! ¡¡LLUVIA DE CONFETI!!`)
    sendOverlay({ type: "confetti", duration: 6000 })
    send("twitch:event", { type:"shop", text:`🎉 ${display} activó confeti!`, username })
    return
  }

  // !arcoiris — comprar alerta de arcoíris (200 pts, cooldown 30s)
  if (cmd === "!arcoiris" || cmd === "!rainbow") {
    const cd = shop.checkCooldown(username, "arcoiris")
    if (cd > 0) { say(`@${display} espera ${Math.ceil(cd/1000)}s.`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < 200) { say(`@${display} necesitas 200 pts. Tienes ${viewer?.points ?? 0}.`); return }
    addPoints(username, -200, "compra-arcoiris")
    shop.setCooldown(username, "arcoiris")
    say(`🌈 @${display} compró un arcoíris! ¡Ahí viene!`)
    sendOverlay({ type: "rainbow", duration: 5000 })
    send("twitch:event", { type:"shop", text:`🌈 ${display} activó arcoíris!`, username })
    return
  }

  // !misterio — evento misterioso (500 pts)
  if (cmd === "!misterio" || cmd === "!mystery") {
    const cd = shop.checkCooldown(username, "misterio")
    if (cd > 0) { say(`@${display} espera ${Math.ceil(cd/1000)}s.`); return }
    const viewer = getViewer(username)
    if (!viewer || viewer.points < 500) { say(`@${display} necesitas 500 pts. Tienes ${viewer?.points ?? 0}.`); return }
    addPoints(username, -500, "compra-misterio")
    shop.setCooldown(username, "misterio")

    // elegir efecto aleatorio
    const roll = Math.random()
    say(`🎲 @${display} activó el Evento Misterioso... ¿qué pasará?`)

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
        say(`💀 ¡Mala suerte @${display}! Perdiste 200 pts extra.`)
        sendOverlay({ type: "alert", text: `💀 @${display} tuvo mala suerte en el misterio!`, duration: 5000 })
      } else if (roll < 0.70) {
        // El comprador gana 1000 pts
        addPoints(username, 1000, "misterio-jackpot")
        say(`💰 ¡JACKPOT! @${display} ganó 1000 pts del evento misterioso!`)
        sendOverlay({ type: "alert", text: `💰 ¡@${display} ganó 1000 pts del misterio!`, duration: 6000 })
      } else if (roll < 0.80) {
        // Confeti
        sendOverlay({ type: "confetti", duration: 6000 })
        say(`🎉 ¡CONFETI! Resultado del evento misterioso.`)
      } else if (roll < 0.90) {
        // Arcoíris
        sendOverlay({ type: "rainbow", duration: 5000 })
        say(`🌈 ¡ARCOÍRIS! Resultado del evento misterioso.`)
      } else {
        // Robar 30% a un viewer random
        const ranking = getRanking(10)
        const targets = ranking.filter(v => v.username !== username && v.points > 0)
        if (targets.length) {
          const target = targets[Math.floor(Math.random() * targets.length)]
          const stolen = Math.floor(target.points * 0.3)
          addPoints(target.username, -stolen, "misterio-robo")
          addPoints(username, stolen, "misterio-robo-ganado")
          say(`🥷 ¡El misterio robó ${stolen} pts de @${target.display||target.username} para @${display}!`)
          sendOverlay({ type: "alert", text: `🥷 @${display} robó ${stolen} pts por el misterio!`, duration: 5000 })
        }
      }
    }, 2000)
    return
  }

  if (cmd === "!comandos" || cmd === "!cmds") {
    say(`Comandos: !puntos !daily !work !ranking !slots [pts] !ruleta [pts] [tipo] !bj [pts] !hit !stand !duelo [@user] [pts] !coin [pts]`)
    return
  }
}

// ── Conexión ──────────────────────────────────────────────────────────────────
function connect(channel, token) {
  if (client) { client.disconnect().catch(() => {}); client = null }
  _channel = channel.toLowerCase()

  client = new tmi.Client({
    options: { debug: false },
    identity: token ? { username: channel, password: token } : undefined,
    channels: [channel],
  })

  client.on("message", (ch, tags, message, self) => {
    if (self) return
    const username = tags.username || "anon"
    const display  = tags["display-name"] || username
    if (message.startsWith("!")) {
      // comandos solo-idle (afk) tienen prioridad si el modo está activo
      try {
        if (require("./afk.js").handleCommand(username, display, message)) return
      } catch (e) {}
      handleCommand(ch, tags, message); return
    }
    // contador comunitario del modo AFK (números pelados)
    try { require("./afk.js").onMessage(username, display, message) } catch (e) {}
    addSessionMsg(username, display)
    try { require("./levels.js").onMessage(username, tags["user-id"] || "") } catch (e) {}
    try { require("./emoteSounds.js").onMessage(message, tags) } catch (e) {}
    try { require("./widgets.js").onChatMessage(username, display, tags.color).catch(() => {}) } catch (e) {}
    checkChallenge(username, message)
    const mult = events.getMultiplier()
    if (events.isEconomyFrozen()) {
      send("twitch:message", { username, display, message, color: tags.color||"#7c6ef5", points: 0, badges: tags.badges||{} })
      return
    }
    const viewer = onMessage(username, display, 2 * mult, tags["user-id"] || "")
    send("twitch:message", {
      username, display, message,
      color: tags.color || "#7c6ef5",
      points: viewer?.points ?? 0,
      badges: tags.badges || {},
    })
  })

  client.on("subscription", (ch, username, method, msg, tags) => {
    const display = tags["display-name"] || username
    addPoints(username, 150, "sub")
    send("twitch:event", { type:"sub", text:`🎉 ${display} se suscribió`, username, display })
    sendOverlay({ type:"alert", text:`🎉 ${display} se suscribió!`, duration:5000 })
  })

  client.on("resub", (ch, username, months, msg, tags) => {
    const display = tags["display-name"] || username
    addPoints(username, 80, "resub")
    send("twitch:event", { type:"resub", text:`🔁 ${display} resubscribió (${months} meses)`, username, display, months })
    sendOverlay({ type:"alert", text:`🔁 ${display} resubscribió (${months} meses)!`, duration:5000 })
  })

  client.on("cheer", (ch, tags, msg) => {
    const username = tags.username || "anon"
    const display  = tags["display-name"] || username
    const bits     = tags.bits || 0
    addPoints(username, Math.floor(bits / 10) * 3, "bits")
    send("twitch:event", { type:"cheer", text:`💎 ${display} donó ${bits} bits`, username, display, bits })
    sendOverlay({ type:"alert", text:`💎 ${display} donó ${bits} bits!`, duration:5000 })
  })

  client.on("raided", (ch, username, viewers) => {
    addPoints(username, Math.min(viewers, 500), "raid")
  send("twitch:event", { type:"raid", text:`⚡ ${username} raid con ${viewers} viewers!`, username, viewers })
    sendOverlay({ type:"alert", text:`⚡ ${username} raid con ${viewers} viewers!`, duration:6000 })
  })

  client.on("follow", (ch, username, methods) => {
    const display = username
    addPoints(username, 20, "follow")
    send("twitch:event", { type:"follow", text:`❤️ ${display} siguió el canal!`, username, display })
    sendOverlay({ type:"alert", text:`❤️ ${display} siguió el canal!`, duration:4000 })
  })

  // resetear contador de sesión al conectar
  resetSessionMsgs()

  client.on("connected", () => {
    send("twitch:status", { connected: true, channel })
    say(`mimiku activo ✦ Comandos: !puntos !daily !work !slots !ruleta !bj !duelo`)
  })

  client.on("disconnected", () => send("twitch:status", { connected: false }))
  client.connect().catch(err => send("twitch:status", { connected: false, error: err.message }))
}

function disconnect() {
  client?.disconnect().catch(() => {})
  client = null
}

function sayPublic(msg) { say(msg) }

function getActiveViewers() {
  // viewers que han mandado al menos un mensaje en la sesión actual
  return Object.keys(sessionMsgs)
}

// ── Mini-reto: quien escriba la palabra en X segundos gana puntos ──
let _challenge = null
function startMiniChallenge(word, seconds, reward) {
  _challenge = {
    word: (word || "🔥").toLowerCase(),
    reward: reward || 100,
    winners: new Set(),
    endsAt: Date.now() + (seconds || 30) * 1000,
  }
  setTimeout(() => {
    if (_challenge) {
      const n = _challenge.winners.size
      say(`⚡ ¡Reto terminado! ${n} viewer${n !== 1 ? "s" : ""} ganaron ${_challenge.reward} puntos.`)
      _challenge = null
    }
  }, (seconds || 30) * 1000)
}

function checkChallenge(username, message) {
  if (!_challenge) return
  if (Date.now() > _challenge.endsAt) return
  if (_challenge.winners.has(username)) return
  if (message.toLowerCase().includes(_challenge.word)) {
    _challenge.winners.add(username)
    try { require("./economy.js").addPoints(username, _challenge.reward, "mini-reto") } catch (e) {}
  }
}

module.exports = { connect, disconnect, setWindow, setBroadcast, say: sayPublic, getActiveViewers, startMiniChallenge }
