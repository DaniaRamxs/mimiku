// Economía local-first: wallet y ledger se actualizan en la misma transacción SQLite.
//
// Identidad multiplataforma (Fase 1.4): toda función que resuelve un viewer
// por username acepta un `platform` explícito (default "twitch" solo por
// compatibilidad con los llamadores que aún no lo pasan — Command Engine SÍ
// lo pasa siempre, tomándolo de `event.platform`). Sin esto, un mismo
// username en dos plataformas distintas terminaba compartiendo el mismo
// bucket de identidad "twitch". Ver docs/social-stream-ninja-integration.md
// y el informe de la Fase 1.4 para el detalle completo.
const { randomUUID } = require("node:crypto")

// `feed`: tablon "En vivo" (robos y regalos avisan a la victima / a quien lo recibe).
// `isShielded(viewerId, channelId)`: inmunidad de la tienda (tambien protege los puntos).
function createEconomyService(platform, getChannel, { feed = null, isShielded = () => false } = {}) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function identity(username, display = "", platformUserId = "", platformName = "twitch") {
    return platform.identities.resolve({ platform: platformName, platformUserId, username, display })
  }

  function identityFrom(input) {
    return platform.identities.resolve({
      platform: input.platform,
      platformUserId: input.platformUserId || "",
      username: input.username,
      display: input.displayName || input.display || input.username,
      avatarUrl: input.avatarUrl || "",
    })
  }

  function getViewerById(viewerId) {
    const viewer = platform.identities.get(viewerId)
    if (!viewer) return undefined
    const ch = activeChannel()
    const wallet = platform.economy.getBalance(ch, viewerId)
    const activity = db.prepare("SELECT messages,last_seen FROM viewer_activity_local WHERE channel_id=? AND viewer_id=?")
      .get(ch, viewerId) || { messages: 0, last_seen: viewer.updated_at }
    return { ...viewer, points: wallet.balance, bank: wallet.bank_balance, messages: activity.messages, last_seen: activity.last_seen }
  }

  function ensureViewer(username, display = "", platformUserId = "", platformName = "twitch") {
    const viewer = identity(username, display, platformUserId, platformName)
    platform.economy.getBalance(activeChannel(), viewer.id)
    return getViewerById(viewer.id)
  }

  function addPointsFor(input, delta, reason = "", options = {}) {
    const requested = Number(delta)
    if (!Number.isSafeInteger(requested)) throw new Error("Movimiento inválido")
    const viewer = identityFrom(input)
    const wallet = platform.economy.getBalance(activeChannel(), viewer.id)
    const applied = requested < 0 ? Math.max(requested, -wallet.balance) : requested
    platform.economy.applyMovement({
      channelId: activeChannel(), viewerId: viewer.id, balanceDelta: applied,
      reason: reason || "movement",
      idempotencyKey: options.idempotencyKey || `${reason || "movement"}:${randomUUID()}`,
      sourceType: options.sourceType || "", sourceId: options.sourceId || "",
    })
    return getViewerById(viewer.id)
  }

  function addPoints(username, delta, reason = "", options = {}) {
    return addPointsFor({
      username,
      displayName: options.display || username,
      platformUserId: options.platformUserId || "",
      platform: options.platform || "twitch",
    }, delta, reason, options)
  }

  // Concedido por mensaje de chat. Hasta la Fase 1.5 solo lo invocaba el
  // Twitch Adapter directamente; ahora también lo invoca el XP Consumer
  // agnóstico de plataforma (src/core/interactions/chat-activity-consumers.js).
  function onMessage(username, display = "", pointsPerMsg = 2, platformUserId = "", platformName = "twitch") {
    const viewer = identity(username, display, platformUserId, platformName)
    const ch = activeChannel()
    db.prepare(`INSERT INTO viewer_activity_local(channel_id,viewer_id,messages) VALUES(?,?,1)
      ON CONFLICT(channel_id,viewer_id) DO UPDATE SET messages=messages+1,last_seen=datetime('now')`).run(ch, viewer.id)
    return addPoints(username, Number(pointsPerMsg), "chat", {
      display, platform: platformName, platformUserId, idempotencyKey: `chat:${viewer.id}:${randomUUID()}`,
    })
  }

  function getViewer(username, platformName = "twitch") {
    const viewer = platform.identities.byUsername(username, platformName)
    return viewer ? getViewerById(viewer.id) : undefined
  }

  function getViewerFor(input) {
    const viewer = identityFrom(input)
    return getViewerById(viewer.id)
  }

  function getRanking(limit = 10) {
    return platform.economy.ranking(activeChannel(), limit).map(row => ({
      ...row, points: row.balance, bank: row.bank_balance,
      messages: db.prepare("SELECT messages FROM viewer_activity_local WHERE channel_id=? AND viewer_id=?")
        .get(activeChannel(), row.id)?.messages || 0,
    }))
  }

  function getLog(limit = 50) {
    return db.prepare(`SELECT l.*, i.username, l.balance_delta AS delta FROM economy_ledger l
      JOIN viewer_identities i ON i.id=l.viewer_id WHERE l.channel_id=?
      ORDER BY l.created_at DESC,l.rowid DESC LIMIT ?`)
      .all(activeChannel(), Math.min(1000, Math.max(1, Number(limit) || 50)))
  }

  function getStats() {
    const ch = activeChannel()
    const totals = db.prepare("SELECT COUNT(*) total_viewers, COALESCE(SUM(balance),0) total_points FROM wallets WHERE channel_id=?").get(ch)
    const events = db.prepare("SELECT COUNT(*) total_events FROM economy_ledger WHERE channel_id=?").get(ch)
    return { ...totals, total_events: events.total_events }
  }

  // Cooldowns por viewer: la clave real es (channel_id, viewer_id, action) en
  // SQLite — ya estaba correctamente aislada por viewer_id. Lo que faltaba
  // era resolver el viewer_id con la plataforma correcta antes de llegar acá.
  function getCooldown(username, action, platformName = "twitch") {
    const viewer = platform.identities.byUsername(username, platformName)
    if (!viewer) return undefined
    return db.prepare("SELECT last_used FROM cooldowns_local WHERE channel_id=? AND viewer_id=? AND action=?")
      .get(activeChannel(), viewer.id, action)
  }

  function setCooldown(username, action, platformName = "twitch", platformUserId = "") {
    const viewer = identity(username, "", platformUserId, platformName)
    db.prepare(`INSERT INTO cooldowns_local(channel_id,viewer_id,action,last_used) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(channel_id,viewer_id,action) DO UPDATE SET last_used=datetime('now')`)
      .run(activeChannel(), viewer.id, action)
  }

  function secondsSince(isoStr) { return (Date.now() - new Date(`${isoStr}Z`).getTime()) / 1000 }

  // Daily: 10.000 puntos cada 24 h; los subs de Twitch, 30.000.
  const DAILY_REWARD = 10000
  const DAILY_REWARD_SUB = 30000
  const DAILY_COOLDOWN_SECONDS = 86400

  function dailyReward(sub) { return sub ? DAILY_REWARD_SUB : DAILY_REWARD }

  // Para la pagina de canje: si el daily esta listo y cuanto falta si no.
  function dailyStatus(username, platformName = "twitch", { sub = false } = {}) {
    const cooldown = getCooldown(username, "daily", platformName)
    const remaining = cooldown ? Math.max(0, Math.ceil(DAILY_COOLDOWN_SECONDS - secondsSince(cooldown.last_used))) : 0
    return { ready: remaining === 0, remainingSeconds: remaining, cooldownSeconds: DAILY_COOLDOWN_SECONDS, reward: dailyReward(sub), sub: !!sub, subReward: DAILY_REWARD_SUB, baseReward: DAILY_REWARD }
  }

  // `sub`: el viewer es sub del canal (insignia en el chat o sub verificado en la web).
  function claimDaily(username, display = "", platformName = "twitch", platformUserId = "", { sub = false } = {}) {
    ensureViewer(username, display, platformUserId, platformName)
    const cooldown = getCooldown(username, "daily", platformName)
    if (cooldown) {
      const remaining = DAILY_COOLDOWN_SECONDS - secondsSince(cooldown.last_used)
      if (remaining > 0) return { ok: false, msg: `@${display} ya reclamaste tu daily. Volvé en ${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m ⏳` }
    }
    setCooldown(username, "daily", platformName, platformUserId)
    const reward = dailyReward(sub)
    const viewer = addPoints(username, reward, "daily", {
      display, platform: platformName, platformUserId, idempotencyKey: `daily:${activeChannel()}:${platformName}:${username}:${new Date().toISOString().slice(0, 10)}`,
    })
    return { ok: true, msg: `📅 @${display} reclamó su daily${sub ? " de sub" : ""} y recibió ${reward.toLocaleString()} puntos! Total: ${viewer.points.toLocaleString()} ✦`, points: reward, sub: !!sub }
  }

  // Trabajo (!work): entre 500 y 2.000 puntos cada 15 minutos, segun el oficio que toque.
  const WORK_COOLDOWN_SECONDS = 900
  const WORK_JOBS = [
    ["moderó el chat", 600, 1400], ["jugó con el chat", 500, 1200], ["hizo un raid épico", 900, 2000],
    ["se durmió en stream", 500, 900], ["ganó un torneo", 1200, 2000], ["ayudó al broadcaster", 700, 1600],
  ]

  function workStatus(username, platformName = "twitch") {
    const cooldown = getCooldown(username, "work", platformName)
    const remaining = cooldown ? Math.max(0, Math.ceil(WORK_COOLDOWN_SECONDS - secondsSince(cooldown.last_used))) : 0
    return { ready: remaining === 0, remainingSeconds: remaining, cooldownSeconds: WORK_COOLDOWN_SECONDS, min: 500, max: 2000 }
  }

  function claimWork(username, display = "", platformName = "twitch", platformUserId = "") {
    ensureViewer(username, display, platformUserId, platformName)
    const cooldown = getCooldown(username, "work", platformName)
    if (cooldown) {
      const remaining = WORK_COOLDOWN_SECONDS - secondsSince(cooldown.last_used)
      if (remaining > 0) return { ok: false, msg: `@${display} ya trabajaste. Descansá ${Math.floor(remaining / 60)}m ${Math.floor(remaining % 60)}s ⏳` }
    }
    const [job, min, max] = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)]
    const reward = Math.floor(Math.random() * (max - min + 1)) + min
    setCooldown(username, "work", platformName, platformUserId)
    const viewer = addPoints(username, reward, "work", { display, platform: platformName, platformUserId })
    return { ok: true, msg: `💼 @${display} ${job} y ganó ${reward.toLocaleString()} puntos! Total: ${viewer.points.toLocaleString()} ✦`, points: reward, job }
  }

  function moveBetweenWalletAndBank(username, display, amount, direction, platformName = "twitch", platformUserId = "") {
    const quantity = Number(amount)
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return { error: "La cantidad debe ser mayor a 0." }
    const viewer = identity(username, display, platformUserId, platformName)
    try {
      platform.economy.applyMovement({
        channelId: activeChannel(), viewerId: viewer.id,
        balanceDelta: direction === "deposit" ? -quantity : quantity,
        bankDelta: direction === "deposit" ? quantity : -quantity,
        reason: direction === "deposit" ? "deposito" : "retiro",
        idempotencyKey: `${direction}:${viewer.id}:${randomUUID()}`,
      })
    } catch (error) { return { error: error.message } }
    const updated = getViewerById(viewer.id)
    return { ok: true, msg: `🏦 @${display} — En mano: ${updated.points.toLocaleString()} | Banco: ${updated.bank.toLocaleString()} ✦` }
  }

  function depositar(username, display, amount, platformName = "twitch", platformUserId = "") { return moveBetweenWalletAndBank(username, display, amount, "deposit", platformName, platformUserId) }
  function retirar(username, display, amount, platformName = "twitch", platformUserId = "") { return moveBetweenWalletAndBank(username, display, amount, "withdraw", platformName, platformUserId) }
  function verBanco(username, display, platformName = "twitch", platformUserId = "") {
    const viewer = ensureViewer(username, display, platformUserId, platformName)
    return { ok: true, msg: `🏦 @${display} — En mano: ${viewer.points.toLocaleString()} pts | Banco: ${viewer.bank.toLocaleString()} pts` }
  }

  // Robar (!robar, y "Robar" en la Comunidad de la web). 30 % de probabilidad de
  // llevarse el 30 % de los puntos en mano de la victima (tope ROB_MAX); si falla,
  // pierde la mitad de eso. Protecciones: espera entre robos del ladron, la
  // victima queda protegida un rato tras un robo, y la inmunidad de la tienda
  // tambien protege los puntos. El banco nunca se toca.
  const ROB_CHANCE = 0.3
  const ROB_SHARE = 0.3
  const ROB_MAX = 20000
  const ROB_COOLDOWN_SECONDS = 600
  const ROB_VICTIM_SHIELD_SECONDS = 1800

  function remainingOf(viewerId, action, seconds) {
    const row = db.prepare("SELECT last_used FROM cooldowns_local WHERE channel_id=? AND viewer_id=? AND action=?").get(activeChannel(), viewerId, action)
    return row ? Math.max(0, Math.ceil(seconds - secondsSince(row.last_used))) : 0
  }

  function markCooldown(viewerId, action) {
    db.prepare(`INSERT INTO cooldowns_local(channel_id,viewer_id,action,last_used) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(channel_id,viewer_id,action) DO UPDATE SET last_used=datetime('now')`).run(activeChannel(), viewerId, action)
  }

  function minutes(seconds) { return Math.max(1, Math.ceil(seconds / 60)) }

  function report(event) {
    if (!feed) return
    try { feed.record(activeChannel(), event) } catch (error) { /* el tablon nunca debe romper un movimiento */ }
  }

  function robStatus(username, platformName = "twitch") {
    const viewer = platform.identities.byUsername(username, platformName)
    const remaining = viewer ? remainingOf(viewer.id, "robar", ROB_COOLDOWN_SECONDS) : 0
    return { ready: remaining === 0, remainingSeconds: remaining, chance: ROB_CHANCE, share: ROB_SHARE, max: ROB_MAX }
  }

  function robar(username, display, targetUsername, platformName = "twitch", platformUserId = "", { random = Math.random } = {}) {
    const attacker = ensureViewer(username, display, platformUserId, platformName)
    const target = getViewer(targetUsername, platformName)
    if (!target) return { error: `@${targetUsername} no está registrado.`, reason: "unknown-target" }
    if (attacker.id === target.id) return { error: "No podés robarte a vos mismo.", reason: "self" }
    const wait = remainingOf(attacker.id, "robar", ROB_COOLDOWN_SECONDS)
    if (wait) return { error: `esperá ${minutes(wait)} min antes de volver a robar.`, reason: "cooldown", remainingSeconds: wait }
    const shieldLeft = remainingOf(target.id, "robado", ROB_VICTIM_SHIELD_SECONDS)
    if (shieldLeft) return { error: `@${targetUsername} acaba de ser robado: está protegido ${minutes(shieldLeft)} min más.`, reason: "protected", remainingSeconds: shieldLeft }
    if (isShielded(target.id, activeChannel())) return { error: `@${targetUsername} tiene inmunidad a robos.`, reason: "shielded" }
    if (target.points <= 0) return { error: `@${targetUsername} no tiene puntos en mano para robar.`, reason: "empty" }
    const possible = Math.min(ROB_MAX, Math.max(1, Math.floor(target.points * ROB_SHARE)))
    markCooldown(attacker.id, "robar")
    const victimName = target.display || target.username || targetUsername
    if (random() < ROB_CHANCE) {
      // Se mueve la cartera REAL de la victima (por su id). Antes se buscaba por
      // nombre sin id de plataforma y el descuento caia en una identidad vacia:
      // el ladron ganaba puntos y a la victima no le faltaba ninguno.
      const key = `robo:${randomUUID()}`
      db.transaction(() => {
        platform.economy.applyMovement({ channelId: activeChannel(), viewerId: target.id, balanceDelta: -possible, reason: `robado por ${username}`, idempotencyKey: `${key}:victima`, sourceType: "robo", sourceId: attacker.id })
        platform.economy.applyMovement({ channelId: activeChannel(), viewerId: attacker.id, balanceDelta: possible, reason: `robo exitoso a ${targetUsername}`, idempotencyKey: `${key}:ladron`, sourceType: "robo", sourceId: target.id })
      })()
      markCooldown(target.id, "robado")
      report({ game: "robar", kind: "rob", viewerId: attacker.id, who: display || username, ownerId: target.id, owner: victimName, label: `Le robó a ${victimName}`, net: possible, outcome: "win" })
      return { ok: true, result: "success", stolen: possible, msg: `🥷 @${display} robó ${possible.toLocaleString()} pts de @${targetUsername}!` }
    }
    const penalty = Math.max(1, Math.floor(possible * 0.5))
    addPoints(username, -penalty, `fallo de robo a ${targetUsername}`, { platform: platformName, platformUserId })
    report({ game: "robar", kind: "rob-fail", viewerId: attacker.id, who: display || username, ownerId: target.id, owner: victimName, label: `Intentó robar a ${victimName}`, net: -penalty, outcome: "lose" })
    return { ok: true, result: "fail", penalty, msg: `🥷 @${display} intentó robar a @${targetUsername} pero lo cacharon!` }
  }

  // ── Regalar puntos (!regalar y "Regalar" en la Comunidad de la web) ─────────
  // Limites para que no sirva para pasar puntos de cuentas secundarias: minimo y
  // maximo por regalo, tope de lo enviado en 24 h y una comision que se pierde.
  const GIFT_MIN = 100
  const GIFT_MAX = 50000
  const GIFT_DAILY_CAP = 100000
  const GIFT_FEE = 0.05

  function giftedLastDay(viewerId) {
    return db.prepare(`SELECT COALESCE(SUM(-balance_delta), 0) AS sent FROM economy_ledger
      WHERE channel_id=? AND viewer_id=? AND source_type='regalo-envio' AND created_at >= datetime('now', '-1 day')`).get(activeChannel(), viewerId).sent
  }

  function giftStatus(username, platformName = "twitch") {
    const viewer = platform.identities.byUsername(username, platformName)
    const sent = viewer ? giftedLastDay(viewer.id) : 0
    return { min: GIFT_MIN, max: GIFT_MAX, dailyCap: GIFT_DAILY_CAP, sentLastDay: sent, left: Math.max(0, GIFT_DAILY_CAP - sent), feePercent: GIFT_FEE * 100 }
  }

  function regalar(username, display, targetUsername, amount, platformName = "twitch", platformUserId = "") {
    const quantity = Math.trunc(Number(amount))
    if (!Number.isSafeInteger(quantity) || quantity < GIFT_MIN || quantity > GIFT_MAX) {
      return { error: `Regala entre ${GIFT_MIN.toLocaleString()} y ${GIFT_MAX.toLocaleString()} puntos.`, reason: "bad-amount" }
    }
    const sender = ensureViewer(username, display, platformUserId, platformName)
    const target = getViewer(targetUsername, platformName)
    if (!target) return { error: `@${targetUsername} no está registrado.`, reason: "unknown-target" }
    if (sender.id === target.id) return { error: "No te puedes regalar puntos a ti mismo.", reason: "self" }
    const left = GIFT_DAILY_CAP - giftedLastDay(sender.id)
    if (quantity > left) return { error: `Solo puedes regalar ${Math.max(0, left).toLocaleString()} puntos más en las próximas 24 h.`, reason: "cap", left: Math.max(0, left) }
    const fee = Math.ceil(quantity * GIFT_FEE)
    const received = quantity - fee
    const key = `regalo:${randomUUID()}`
    try {
      db.transaction(() => {
        platform.economy.applyMovement({ channelId: activeChannel(), viewerId: sender.id, balanceDelta: -quantity, reason: `regalo a ${targetUsername}`, idempotencyKey: `${key}:envio`, sourceType: "regalo-envio", sourceId: target.id })
        platform.economy.applyMovement({ channelId: activeChannel(), viewerId: target.id, balanceDelta: received, reason: `regalo de ${username}`, idempotencyKey: `${key}:recibo`, sourceType: "regalo", sourceId: sender.id })
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { error: "No tienes tantos puntos en mano.", reason: "insufficient" }
      throw error
    }
    const receiverName = target.display || target.username || targetUsername
    report({ game: "regalo", kind: "gift", viewerId: sender.id, who: display || username, ownerId: target.id, owner: receiverName, label: `Regalo a ${receiverName}`, net: received, outcome: "win" })
    return { ok: true, sent: quantity, received, fee, msg: `@${display} le regaló ${received.toLocaleString()} puntos a @${targetUsername} (comisión ${fee.toLocaleString()}).` }
  }

  return {
    ensureViewer, addPoints, addPointsFor, onMessage, getViewer, getViewerFor, getRanking, getLog, getStats,
    getCooldown, setCooldown, claimDaily, dailyStatus, claimWork, workStatus, depositar, retirar, verBanco, robar, robStatus, regalar, giftStatus,
  }
}

let defaultService = null
function service() {
  if (!defaultService) {
    const platform = require("./local-runtime.js").getLocalPlatform()
    const getChannel = () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel
    const { createEffectsShop } = require("./effects-shop.js")
    const effects = createEffectsShop({ platform, getChannel })
    defaultService = createEconomyService(platform, getChannel, {
      feed: require("./live-feed.js").getDefaultLiveFeed(),
      isShielded: (viewerId, channelId) => effects.isActive(viewerId, "anti-robo", channelId),
    })
  }
  return defaultService
}

module.exports = {
  createEconomyService,
  ensureViewer: (...args) => service().ensureViewer(...args),
  addPoints: (...args) => service().addPoints(...args),
  addPointsFor: (...args) => service().addPointsFor(...args),
  onMessage: (...args) => service().onMessage(...args),
  getViewer: (...args) => service().getViewer(...args),
  getViewerFor: (...args) => service().getViewerFor(...args),
  getRanking: (...args) => service().getRanking(...args),
  getLog: (...args) => service().getLog(...args),
  getStats: (...args) => service().getStats(...args),
  getCooldown: (...args) => service().getCooldown(...args),
  setCooldown: (...args) => service().setCooldown(...args),
  claimDaily: (...args) => service().claimDaily(...args),
  dailyStatus: (...args) => service().dailyStatus(...args),
  claimWork: (...args) => service().claimWork(...args),
  workStatus: (...args) => service().workStatus(...args),
  robStatus: (...args) => service().robStatus(...args),
  regalar: (...args) => service().regalar(...args),
  giftStatus: (...args) => service().giftStatus(...args),
  depositar: (...args) => service().depositar(...args),
  retirar: (...args) => service().retirar(...args),
  verBanco: (...args) => service().verBanco(...args),
  robar: (...args) => service().robar(...args),
}
