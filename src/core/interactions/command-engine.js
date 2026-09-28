// Command Engine: consume eventos Mimiku normalizados de tipo "chat_message"
// y decide si disparan un comando. No importa tmi.js, ningún SDK de Twitch,
// ni Social Stream Ninja: solo trabaja con el contrato de evento y con los
// servicios de dominio de Mimiku (economía, juegos, eventos de canal, tienda).
//
// Extraído de src/services/twitch.js (handleCommand). Comportamiento
// preservado 1:1 salvo un bug preexistente corregido de forma incidental:
// "!confeti" / "!arcoiris" / "!misterio" referenciaban una variable global
// "shop" que nunca se importaba en twitch.js (lanzaba ReferenceError). Aquí
// se importa shop.js correctamente, usando las mismas funciones que ya
// exportaba ese archivo.

const { findLiveEffect, EFFECT_GLOBAL_SPACING_MS } = require("./live-effects.js")

function createCommandEngine(overrides = {}) {
  const economy = overrides.economy || require("../../services/economy.js")
  const games = overrides.games || require("../../services/games.js")
  const events = overrides.events || require("../../services/events.js")
  const shop = overrides.shop || require("../../services/shop.js")
  const afk = overrides.afk || require("../../services/afk.js")
  const vipService = overrides.vipService || require("../../services/vips.js")
  const notify = overrides.notify || (() => {})
  const overlay = overrides.overlay || (() => {})
  const replyRouter = overrides.replyRouter || require("./reply-router.js").createReplyRouter({
    notifyLocal: payload => notify("chat:response", payload),
    showOnOverlay: payload => overlay(payload),
  })
  // Perezoso: roulette.js arrastra la base de datos, que solo existe en el proceso principal.
  const rouletteService = () => overrides.roulette || require("../../services/roulette.js").getDefaultRouletteService()
  const boxService = () => overrides.boxes || require("../../services/boxes.js").getDefaultBoxService()
  const loyaltyService = () => overrides.loyalty || require("../../services/loyalty.js").getDefaultLoyaltyService()
  const commandConfig = overrides.commandConfig || { evaluate: () => ({ allowed: true }), record: () => {} }

  const now = overrides.now || Date.now
  let lastEffectAt = -Infinity

  const { getViewer, getViewerFor, addPoints, getRanking, claimDaily, claimWork, depositar, retirar, verBanco, robar } = economy

  function handle(event) {
    const text = event.message && event.message.text
    if (!text) return
    const trimmed = text.trim()
    if (!trimmed.startsWith("!")) return

    const parts = trimmed.split(/\s+/)
    const cmd = parts[0].toLowerCase()
    const username = event.actor.username || "anon"
    const display = event.actor.displayName || username
    const say = msg => replyRouter.send(event, msg)
    const isMod = () => event.actor.isModerator
    // Identidad multiplataforma (Fase 1.4): platform SIEMPRE viaja explícito
    // desde event.platform. Nunca se asume "twitch" acá — los defaults
    // "twitch" que quedan en economy/games/events/shop son solo compatibilidad
    // hacia atrás para otros llamadores, no una decisión de este motor.
    const platform = event.platform
    const actorIdentity = {
      platform,
      platformUserId: event.actor.platformUserId,
      username,
      displayName: display,
      avatarUrl: event.actor.avatarUrl,
    }
    // Efectos de directo: el espaciado global va ANTES de evaluar/registrar, para
    // que un efecto descartado por saturacion no gaste el cooldown del viewer.
    const effect = findLiveEffect(cmd)
    if (effect && now() - lastEffectAt < EFFECT_GLOBAL_SPACING_MS) return

    const policy = commandConfig.evaluate ? commandConfig.evaluate(cmd, event) : { allowed: true }
    if (!policy.allowed) {
      if (policy.rankDenied) {
        const labels = (policy.requiredRanks || []).map(rank => require("../../services/ranks.js").rankLabel(rank)).join(" o ")
        say(`@${display} ${cmd} es solo para: ${labels}.`)
        return
      }
      if (policy.remainingMs) say(`@${display} espera ${Math.ceil(policy.remainingMs / 1000)}s para volver a usar ${cmd}.`)
      return
    }
    if (commandConfig.record) commandConfig.record(cmd, event)

    if (effect) {
      lastEffectAt = now()
      for (const payload of effect.overlay) overlay({ ...payload })
      say(`@${display} activó ${effect.label}`)
      return
    }

    // Comandos "solo-idle" de AFK (Fase 1.6): no tocan identidad ni economía,
    // solo responden con el estado del contador — multiplataforma desde ya.
    const idleReply = afk.getIdleCommandReply(trimmed)
    if (idleReply !== null) { say(idleReply); return }

    if (cmd === "!puntos") {
      const viewer = getViewerFor ? getViewerFor(actorIdentity) : getViewer(username, platform)
      say(`@${display} tenés ${(viewer?.points ?? 0).toLocaleString()} puntos ✦`)
      return
    }

    if (cmd === "!level" || cmd === "!nivel" || cmd === "!xp") {
      const levels = overrides.levels || require("../../services/levels.js")
      // Twitch trae su canal en metadata.channel; TikTok y SSN no. Sin este
      // respaldo el comando fallaba en silencio para esas plataformas.
      const channelId = (event.metadata && event.metadata.channel) || require("../../services/currentChannel.js").get()
      levels.getViewerLevel(channelId, username, event.actor.platformUserId, platform).then(info => {
        const title = levels.titleForLevel(info.level, null)
        say(`${title.icon} @${display} — Nivel ${info.level} (${title.title}) · ${info.into}/${info.needed} XP para el siguiente`)
      }).catch(() => {})
      return
    }

    if (cmd === "!ranking") {
      const top = getRanking(5)
      if (!top.length) { say("Sin datos de ranking aún."); return }
      const list = top.map((v, i) => `${i + 1}. ${v.display || v.username} (${v.points.toLocaleString()})`).join(" | ")
      say(`🏆 ${list}`)
      return
    }

    if (cmd === "!dar") {
      if (!isMod()) { say(`@${display} solo los mods pueden dar puntos.`); return }
      const target = parts[1]?.replace("@", "").toLowerCase()
      const amount = parseInt(parts[2])
      if (!target || isNaN(amount) || amount <= 0) { say(`Uso: !dar [usuario] [cantidad]`); return }
      const viewer = addPoints(target, amount, `regalo de ${username}`, { platform })
      say(`✦ @${target} recibió ${amount} pts de @${display}! Total: ${viewer?.points?.toLocaleString() ?? 0}`)
      notify("twitch:event", { type: "dar", text: `✦ ${display} dio ${amount} pts a ${target}`, username })
      return
    }

    if (cmd === "!quitar") {
      if (!isMod()) return
      const target = parts[1]?.replace("@", "").toLowerCase()
      const amount = parseInt(parts[2])
      if (!target || isNaN(amount) || amount <= 0) { say(`Uso: !quitar [usuario] [cantidad]`); return }
      const viewer = addPoints(target, -amount, `quita de ${username}`, { platform })
      say(`@${target} ahora tiene ${viewer?.points?.toLocaleString() ?? 0} pts.`)
      return
    }

    if (cmd === "!ruleta") {
      const amount = parseInt(parts[1])
      const betType = parts[2] || "rojo"
      if (isNaN(amount) || amount <= 0) { say(`Uso: !ruleta [cantidad] [rojo|negro|par|impar|alto|bajo|número]`); return }
      const result = games.rouletteSpin(username, betType, amount, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      notify("game:roulette", result)
      overlay({
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

    if (cmd === "!cofres") {
      const owned = boxService().inventory(actorIdentity)
      const total = owned.reduce((sum, row) => sum + row.quantity, 0)
      if (!total) { say(`@${display} no tienes cofres sin abrir.`); return }
      const detail = owned.map(row => `${row.quantity} ${row.name}`).join(", ")
      say(`@${display} tienes ${total} ${total === 1 ? "cofre" : "cofres"} sin abrir (${detail}). Usa !abrircofre para abrirlos.`)
      return
    }

    if (cmd === "!abrircofre" || cmd === "!abrir") {
      const requested = parts[1] === undefined ? 1 : parseInt(parts[1])
      if (Number.isNaN(requested) || requested <= 0) { say(`Uso: !abrircofre [cantidad]`); return }
      const result = boxService().open(actorIdentity, requested)
      if (!result.ok) {
        say(result.reason === "no-mimics"
          ? `@${display} todavia no hay Mimics para repartir desde los cofres.`
          : `@${display} no tienes cofres sin abrir.`)
        return
      }
      const prizes = result.rewards.map(reward => reward.quantity > 1 ? `${reward.name} x${reward.quantity}` : reward.name).join(", ")
      const message = `@${display} abrio ${result.opened} ${result.opened === 1 ? "cofre" : "cofres"} y obtuvo: ${prizes}. Le quedan ${result.remaining}.`
      say(message)
      overlay({ type: "mimic_message", text: `${display} abrio ${result.opened === 1 ? "un cofre" : result.opened + " cofres"} y obtuvo: ${prizes}`, duration: 6000 })
      return
    }

    // Ruleta de cofres: es distinta de "!ruleta" (casino con apuesta de puntos).
    if (cmd === "!ruletacofres") {
      const result = rouletteService().spin(actorIdentity)
      if (!result.ok) {
        if (result.reason === "cooldown") say(`@${display} espera ${formatRemaining(result.remainingMs)} para volver a girar la ruleta.`)
        else say(`@${display} la ruleta de cofres no está disponible ahora.`)
        return
      }
      say(`@${display} giró la ruleta y ganó ${result.chests} ${result.chests === 1 ? "cofre" : "cofres"} (${result.label}).`)
      overlay(result.overlay)
      return
    }

    // Tarjeta de fidelidad semanal: un sello por directo.
    if (cmd === "!claim") {
      const result = loyaltyService().claim(actorIdentity)
      if (!result.ok) {
        if (result.reason === "already") say(`@${display} ya sellaste tu tarjeta en este directo (${result.filled}/${result.total}). Vuelve en el próximo.`)
        else if (result.reason === "completed") say(`@${display} ya completaste tu tarjeta de esta semana. Se renueva el lunes.`)
        return
      }
      overlay(result.overlay)
      if (result.completed) {
        say(`@${display} completó su tarjeta de fidelidad semanal y ganó ${result.rewardPoints.toLocaleString()} puntos.`)
      } else {
        say(`@${display} sellaste tu tarjeta de fidelidad: ${result.filled}/${result.total}.`)
      }
      notify("loyalty:update", { completed: result.completed })
      return
    }

    if (cmd === "!bj" || cmd === "!blackjack") {
      if (!games.bjIsOpen()) { say(`@${display} el Blackjack no está activo ahora.`); return }
      const amount = parseInt(parts[1])
      if (isNaN(amount) || amount <= 0) { say(`Uso: !bj [cantidad]`); return }
      const result = games.bjJoin(username, amount, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      notify("game:bj", { action: "join", username, display, ...result })
      return
    }

    if (cmd === "!hit") {
      const result = games.bjHit(username, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      notify("game:bj", { action: "hit", username, display, ...result })
      if (result.result) {
        overlay({ type: "game_bj", username: display, result: result.result, msg: result.msg, bet: result.bet, payout: result.payout })
      }
      return
    }

    if (cmd === "!stand" || cmd === "!plantarse") {
      const result = games.bjStand(username, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      notify("game:bj", { action: "stand", username, display, ...result })
      overlay({ type: "game_bj", username: display, result: result.result, msg: result.msg, bet: result.bet, payout: result.payout })
      return
    }

    if (cmd === "!duel" || cmd === "!duelo") {
      const target = parts[1]?.replace("@", "").toLowerCase()
      const amount = parseInt(parts[2])
      if (!target || isNaN(amount) || amount <= 0) { say(`Uso: !duelo [@usuario] [cantidad]`); return }
      const challenger = getViewerFor ? getViewerFor(actorIdentity) : getViewer(username, platform)
      const opponent = getViewer(target, platform)
      if (!challenger || challenger.points < amount) { say(`@${display} no tenés suficientes puntos.`); return }
      if (!opponent || opponent.points < amount) { say(`@${target} no tiene suficientes puntos.`); return }
      const win = Math.random() < 0.5
      const winner = win ? username : target
      const loser = win ? target : username
      addPoints(winner, amount, "duelo-ganador", { platform })
      addPoints(loser, -amount, "duelo-perdedor", { platform })
      const winnerV = getViewer(winner, platform)
      say(`⚔️ ¡${win ? display : target} venció a ${win ? target : display} y ganó ${amount} pts! Total: ${winnerV?.points?.toLocaleString() ?? 0} ✦`)
      notify("twitch:event", { type: "duel", text: `⚔️ ${winner} venció en duelo a ${loser}!`, username })
      return
    }

    if (cmd === "!slots" || cmd === "!tragamonedas") {
      const amount = parseInt(parts[1])
      if (isNaN(amount) || amount <= 0) { say(`Uso: !slots [apuesta]`); return }
      const result = games.playSlots(username, amount, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      notify("game:slots", { ...result, username, display })
      overlay({ type: "game_slots", ...result, username, display })
      return
    }

    if (cmd === "!depositar" || cmd === "!dep") {
      const amount = parseInt(parts[1])
      if (isNaN(amount) || amount <= 0) { say(`Uso: !depositar [cantidad]`); return }
      const result = depositar(username, display, amount, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      return
    }

    if (cmd === "!retirar" || cmd === "!ret") {
      const amount = parseInt(parts[1])
      if (isNaN(amount) || amount <= 0) { say(`Uso: !retirar [cantidad]`); return }
      const result = retirar(username, display, amount, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      return
    }

    if (cmd === "!banco" || cmd === "!bank") {
      const result = verBanco(username, display, platform, event.actor.platformUserId)
      say(result.msg)
      return
    }

    if (cmd === "!robar" || cmd === "!steal") {
      const target = parts[1]?.replace("@", "").toLowerCase()
      if (!target) { say(`Uso: !robar @usuario`); return }
      const result = robar(username, display, target, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      say(result.msg)
      notify("twitch:event", { type: "robar", text: result.msg, username, result: result.result })
      return
    }

    if (cmd === "!moneda" || cmd === "!coin" || cmd === "!caracruz") {
      const amount = parseInt(parts[1])
      if (isNaN(amount) || amount <= 0) { say(`Uso: !moneda [apuesta]`); return }
      const viewer = getViewerFor ? getViewerFor(actorIdentity) : getViewer(username, platform)
      if (!viewer || viewer.points < amount) { say(`@${display} no tienes suficientes puntos. Tienes ${viewer?.points ?? 0}.`); return }
      const win = Math.random() < 0.5
      const side = win ? "🪙 CARA" : "🟤 CRUZ"
      if (win) {
        addPoints(username, amount, "moneda-ganada", { platform, platformUserId: event.actor.platformUserId })
        say(`${side} ¡@${display} ganó ${amount} pts! Total: ${getViewer(username, platform)?.points?.toLocaleString()} ✦`)
      } else {
        addPoints(username, -amount, "moneda-perdida", { platform, platformUserId: event.actor.platformUserId })
        say(`${side} @${display} perdió ${amount} pts. Total: ${getViewer(username, platform)?.points?.toLocaleString()}`)
      }
      notify("game:coin", { username, display, amount, win, side })
      overlay({ type: "game_coin", username: display, amount, win, side })
      return
    }

    if (cmd === "!daily") {
      const result = claimDaily(username, display, platform, event.actor.platformUserId)
      say(result.msg)
      if (result.ok) notify("twitch:event", { type: "daily", text: result.msg, username })
      return
    }

    if (cmd === "!work") {
      const result = claimWork(username, display, platform, event.actor.platformUserId)
      say(result.msg)
      if (result.ok) notify("twitch:event", { type: "work", text: result.msg, username })
      return
    }

    if (cmd === "!atacar") {
      const amount = parseInt(parts[1])
      if (isNaN(amount) || amount <= 0) { say(`Uso: !atacar [cantidad]`); return }
      const result = events.attackBoss(username, display, amount, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      if (result.defeated) {
        notify("twitch:event", { type: "boss", text: "¡Boss derrotado!", username })
        overlay({ type: "game_event", event: "boss_attack", bossHp: 0, maxHp: result.maxHp || 5000, participants: 0 })
      } else {
        overlay({ type: "game_event", event: "boss_attack", bossHp: result.bossHp, maxHp: result.maxHp, participants: result.participants || 1 })
      }
      return
    }

    if (cmd === "!boleto") {
      const result = events.buyLotteryTicket(username, display, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      notify("twitch:event", { type: "lottery", text: `@${display} compró boleto`, username })
      return
    }

    if (cmd === "!coin") {
      const amount = parseInt(parts[1])
      if (isNaN(amount) || amount <= 0) { say(`@${display} Uso: !coin [cantidad]`); return }
      const result = events.flipCoin(username, display, amount, platform, event.actor.platformUserId)
      if (result.error) { say(`@${display} ${result.error}`); return }
      const emoji = result.result === "cara" ? "🪙" : "✨"
      say(`${emoji} @${display} sacó ${result.result.toUpperCase()}! ${result.won ? `+${amount} pts` : `-${amount} pts`}`)
      notify("twitch:event", { type: "coin", text: `${emoji} ${display} sacó ${result.result}!`, username })
      return
    }

    // !confeti — comprar alerta de confeti (300 pts, cooldown 30s)
    if (cmd === "!confeti" || cmd === "!confetti") {
      const cd = shop.checkCooldown(actorIdentity, "confeti")
      if (cd > 0) { say(`@${display} espera ${Math.ceil(cd / 1000)}s para volver a usar confeti.`); return }
      const viewer = getViewerFor ? getViewerFor(actorIdentity) : getViewer(username, platform)
      if (!viewer || viewer.points < 300) { say(`@${display} necesitas 300 pts para el confeti. Tienes ${viewer?.points ?? 0}.`); return }
      addPoints(username, -300, "compra-confeti", { platform, platformUserId: event.actor.platformUserId })
      shop.setCooldown(actorIdentity, "confeti")
      say(`🎉 @${display} compró confeti! ¡¡LLUVIA DE CONFETI!!`)
      overlay({ type: "confetti", duration: 6000 })
      notify("twitch:event", { type: "shop", text: `🎉 ${display} activó confeti!`, username })
      return
    }

    // !arcoiris — comprar alerta de arcoíris (200 pts, cooldown 30s)
    if (cmd === "!arcoiris" || cmd === "!rainbow") {
      const cd = shop.checkCooldown(actorIdentity, "arcoiris")
      if (cd > 0) { say(`@${display} espera ${Math.ceil(cd / 1000)}s.`); return }
      const viewer = getViewerFor ? getViewerFor(actorIdentity) : getViewer(username, platform)
      if (!viewer || viewer.points < 200) { say(`@${display} necesitas 200 pts. Tienes ${viewer?.points ?? 0}.`); return }
      addPoints(username, -200, "compra-arcoiris", { platform, platformUserId: event.actor.platformUserId })
      shop.setCooldown(actorIdentity, "arcoiris")
      say(`🌈 @${display} compró un arcoíris! ¡Ahí viene!`)
      overlay({ type: "rainbow", duration: 5000 })
      notify("twitch:event", { type: "shop", text: `🌈 ${display} activó arcoíris!`, username })
      return
    }

    // !misterio — evento misterioso (500 pts)
    if (cmd === "!misterio" || cmd === "!mystery") {
      const cd = shop.checkCooldown(actorIdentity, "misterio")
      if (cd > 0) { say(`@${display} espera ${Math.ceil(cd / 1000)}s.`); return }
      const viewer = getViewerFor ? getViewerFor(actorIdentity) : getViewer(username, platform)
      if (!viewer || viewer.points < 500) { say(`@${display} necesitas 500 pts. Tienes ${viewer?.points ?? 0}.`); return }
      addPoints(username, -500, "compra-misterio", { platform, platformUserId: event.actor.platformUserId })
      shop.setCooldown(actorIdentity, "misterio")

      const roll = Math.random()
      say(`🎲 @${display} activó el Evento Misterioso... ¿qué pasará?`)

      setTimeout(() => {
        if (roll < 0.15) {
          events.rainPoints(50)
        } else if (roll < 0.25) {
          events.spawnBoss(3000)
          overlay({ type: "game_event", event: "boss_spawn", hp: 3000, maxHp: 3000 })
        } else if (roll < 0.40) {
          events.setMultiplier(2, 3)
          overlay({ type: "alert", text: "🔥 x2 por 3 min (evento misterioso)", duration: 5000 })
        } else if (roll < 0.55) {
          addPoints(username, -200, "misterio-mala-suerte", { platform, platformUserId: event.actor.platformUserId })
          say(`💀 ¡Mala suerte @${display}! Perdiste 200 pts extra.`)
          overlay({ type: "alert", text: `💀 @${display} tuvo mala suerte en el misterio!`, duration: 5000 })
        } else if (roll < 0.70) {
          addPoints(username, 1000, "misterio-jackpot", { platform, platformUserId: event.actor.platformUserId })
          say(`💰 ¡JACKPOT! @${display} ganó 1000 pts del evento misterioso!`)
          overlay({ type: "alert", text: `💰 ¡@${display} ganó 1000 pts del misterio!`, duration: 6000 })
        } else if (roll < 0.80) {
          overlay({ type: "confetti", duration: 6000 })
          say(`🎉 ¡CONFETI! Resultado del evento misterioso.`)
        } else if (roll < 0.90) {
          overlay({ type: "rainbow", duration: 5000 })
          say(`🌈 ¡ARCOÍRIS! Resultado del evento misterioso.`)
        } else {
          const ranking = getRanking(10)
          const targets = ranking.filter(v => v.username !== username && v.points > 0)
          if (targets.length) {
            const target = targets[Math.floor(Math.random() * targets.length)]
            const stolen = Math.floor(target.points * 0.3)
            addPoints(target.username, -stolen, "misterio-robo", { platform: target.platform, platformUserId: target.platform_user_id })
            addPoints(username, stolen, "misterio-robo-ganado", { platform, platformUserId: event.actor.platformUserId })
            say(`🥷 ¡El misterio robó ${stolen} pts de @${target.display || target.username} para @${display}!`)
            overlay({ type: "alert", text: `🥷 @${display} robó ${stolen} pts por el misterio!`, duration: 5000 })
          }
        }
      }, 2000)
      return
    }

    if (cmd === "!info") {
      const vipCommands = typeof vipService.getCommandNames === "function"
        ? vipService.getCommandNames(platform)
        : []
      say(formatVipInfo(vipCommands))
      return
    }

    if (cmd === "!comandos" || cmd === "!cmds") {
      say(`Comandos: !puntos !daily !work !ranking !slots [pts] !ruleta [pts] [tipo] !bj [pts] !hit !stand !duelo [@user] [pts] !coin [pts] !info`)
      return
    }
  }

  return { handle }
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.ceil(totalSeconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function formatVipInfo(commands, maxLength = 450) {
  const unique = []
  for (const command of Array.isArray(commands) ? commands : []) {
    const normalized = String(command || "").trim()
    if (normalized && !unique.includes(normalized)) unique.push(normalized)
  }
  if (!unique.length) return "No hay comandos VIP activos."

  const prefix = "💎 Comandos VIP (solo VIP):"
  let text = prefix
  let shown = 0
  for (; shown < unique.length; shown++) {
    const candidate = `${text} ${unique[shown]}`
    if (candidate.length > maxLength) break
    text = candidate
  }

  const remaining = unique.length - shown
  if (!remaining) return text

  const suffix = ` … +${remaining} más`
  while (text.length + suffix.length > maxLength && shown > 0) {
    shown--
    text = prefix + unique.slice(0, shown).map(command => ` ${command}`).join("")
  }
  return text + suffix
}

function registerCommandEngine(eventEngine, overrides = {}) {
  const engine = createCommandEngine({
    commandConfig: require("../../services/command-config.js"),
    ...overrides,
  })
  eventEngine.subscribe("chat_message", engine.handle)
  return engine
}

module.exports = { createCommandEngine, registerCommandEngine }
