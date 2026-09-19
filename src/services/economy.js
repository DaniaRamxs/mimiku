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

function createEconomyService(platform, getChannel) {
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

  function claimDaily(username, display = "", platformName = "twitch", platformUserId = "") {
    ensureViewer(username, display, platformUserId, platformName)
    const cooldown = getCooldown(username, "daily", platformName)
    if (cooldown) {
      const remaining = 86400 - secondsSince(cooldown.last_used)
      if (remaining > 0) return { ok: false, msg: `@${display} ya reclamaste tu daily. Volvé en ${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m ⏳` }
    }
    setCooldown(username, "daily", platformName, platformUserId)
    const viewer = addPoints(username, 500, "daily", {
      display, platform: platformName, platformUserId, idempotencyKey: `daily:${activeChannel()}:${platformName}:${username}:${new Date().toISOString().slice(0, 10)}`,
    })
    return { ok: true, msg: `📅 @${display} reclamó su daily y recibió 500 puntos! Total: ${viewer.points.toLocaleString()} ✦`, points: 500 }
  }

  function claimWork(username, display = "", platformName = "twitch", platformUserId = "") {
    ensureViewer(username, display, platformUserId, platformName)
    const cooldown = getCooldown(username, "work", platformName)
    if (cooldown) {
      const remaining = 900 - secondsSince(cooldown.last_used)
      if (remaining > 0) return { ok: false, msg: `@${display} ya trabajaste. Descansá ${Math.floor(remaining / 60)}m ${Math.floor(remaining % 60)}s ⏳` }
    }
    const jobs = [
      ["moderó el chat", 20, 60], ["jugó con el chat", 30, 80], ["hizo un raid épico", 40, 100],
      ["se durmió en stream", 10, 40], ["ganó un torneo", 60, 150], ["ayudó al broadcaster", 25, 70],
    ]
    const [job, min, max] = jobs[Math.floor(Math.random() * jobs.length)]
    const reward = Math.floor(Math.random() * (max - min + 1)) + min
    setCooldown(username, "work", platformName, platformUserId)
    const viewer = addPoints(username, reward, "work", { display, platform: platformName, platformUserId })
    return { ok: true, msg: `💼 @${display} ${job} y ganó ${reward} puntos! Total: ${viewer.points.toLocaleString()} ✦`, points: reward }
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

  function robar(username, display, targetUsername, platformName = "twitch", platformUserId = "") {
    const attacker = ensureViewer(username, display, platformUserId, platformName)
    const target = getViewer(targetUsername, platformName)
    if (!target) return { error: `@${targetUsername} no está registrado.` }
    if (attacker.id === target.id) return { error: "No podés robarte a vos mismo." }
    if (target.points <= 0) return { error: `@${targetUsername} no tiene puntos en mano para robar.` }
    const possible = Math.max(1, Math.floor(target.points * 0.3))
    if (Math.random() < 0.3) {
      addPoints(targetUsername, -possible, `robado por ${username}`, { platform: platformName })
      addPoints(username, possible, `robo exitoso a ${targetUsername}`, { platform: platformName, platformUserId })
      return { ok: true, result: "success", stolen: possible, msg: `🥷 @${display} robó ${possible} pts de @${targetUsername}!` }
    }
    const penalty = Math.max(1, Math.floor(possible * 0.5))
    addPoints(username, -penalty, `fallo de robo a ${targetUsername}`, { platform: platformName, platformUserId })
    return { ok: true, result: "fail", penalty, msg: `🥷 @${display} intentó robar a @${targetUsername} pero lo cacharon!` }
  }

  return {
    ensureViewer, addPoints, addPointsFor, onMessage, getViewer, getViewerFor, getRanking, getLog, getStats,
    getCooldown, setCooldown, claimDaily, claimWork, depositar, retirar, verBanco, robar,
  }
}

let defaultService = null
function service() {
  if (!defaultService) {
    const platform = require("./local-runtime.js").getLocalPlatform()
    defaultService = createEconomyService(platform, () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel)
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
  claimWork: (...args) => service().claimWork(...args),
  depositar: (...args) => service().depositar(...args),
  retirar: (...args) => service().retirar(...args),
  verBanco: (...args) => service().verBanco(...args),
  robar: (...args) => service().robar(...args),
}
