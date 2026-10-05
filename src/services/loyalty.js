// services/loyalty.js — tarjeta de fidelidad semanal (comando !claim).
//
// Cada viewer puede sellar su tarjeta UNA vez por directo. La tarjeta es
// semanal (lunes a domingo, hora local): al llegar al numero de sellos
// configurado se entregan los puntos de premio una sola vez y la tarjeta
// queda completa hasta el lunes siguiente.
//
// Que es "un directo" lo decide stream-sessions.js (Twitch en vivo, hueco sin
// chat o inicio manual desde el panel).
//
// El sello, la tarjeta completa y los puntos van en una misma transaccion, y
// los UNIQUE de la base impiden doble sello o doble premio aunque dos
// mensajes lleguen a la vez.
const { randomUUID } = require("node:crypto")
const { createStreamSessions } = require("./stream-sessions.js")

const CONFIG_KEY = "loyalty"
const POSITIONS = ["bottom-left", "bottom-right", "top-left", "top-right", "center"]
const THEMES = ["noche", "pastel"]
const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  stamps: 10,
  rewardPoints: 100000,
  streamGapHours: 3,
  position: "bottom-right",
  durationSeconds: 7,
  theme: "noche",
  title: "Tarjeta de fidelidad",
})
const LIMITS = {
  stampsMin: 2, stampsMax: 14,
  rewardMax: 10_000_000,
  gapMin: 1, gapMax: 12,
  durationMin: 3, durationMax: 30,
  titleMax: 40,
}

function clampInt(value, fallback, min, max) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function normalizeConfig(input = {}) {
  const title = typeof input.title === "string" ? input.title.trim().slice(0, LIMITS.titleMax) : ""
  return {
    enabled: input.enabled !== false,
    stamps: clampInt(input.stamps, DEFAULT_CONFIG.stamps, LIMITS.stampsMin, LIMITS.stampsMax),
    rewardPoints: clampInt(input.rewardPoints, DEFAULT_CONFIG.rewardPoints, 0, LIMITS.rewardMax),
    streamGapHours: clampInt(input.streamGapHours, DEFAULT_CONFIG.streamGapHours, LIMITS.gapMin, LIMITS.gapMax),
    position: POSITIONS.includes(input.position) ? input.position : DEFAULT_CONFIG.position,
    durationSeconds: clampInt(input.durationSeconds, DEFAULT_CONFIG.durationSeconds, LIMITS.durationMin, LIMITS.durationMax),
    theme: THEMES.includes(input.theme) ? input.theme : DEFAULT_CONFIG.theme,
    title: title || DEFAULT_CONFIG.title,
  }
}

function pad(value) { return String(value).padStart(2, "0") }

// Lunes (hora local) de la semana de `date`, como "AAAA-MM-DD".
function weekKey(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}

// `sessions`: servicio de directos compartido (stream-sessions.js). Si no se
// pasa, se crea uno con `liveStatus` y el hueco configurado en la tarjeta.
function createLoyaltyService({ platform, getChannel, now = () => new Date(), liveStatus = () => null, sessions = null }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    return normalizeConfig(platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {})
  }

  function setConfig(updates) {
    const next = normalizeConfig({ ...getConfig(), ...(updates || {}) })
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, next)
    return next
  }

  const streams = sessions || createStreamSessions({
    db, getChannel, now, liveStatus, getGapHours: () => getConfig().streamGapHours,
  })

  // Cualquier mensaje de chat mantiene vivo el directo actual (modo sin Twitch).
  function noteActivity() { streams.resolve() }

  function startNewStream() { return streams.startNew() }

  function stampsThisWeek(channelId, viewerId, week) {
    return db.prepare("SELECT COUNT(*) AS n FROM loyalty_claims WHERE channel_id=? AND viewer_id=? AND week_key=?")
      .get(channelId, viewerId, week).n
  }

  function overlayPayload(config, { displayName, avatarUrl, filled, justStamped, completed, week }) {
    return {
      type: "loyalty_card",
      title: config.title,
      user: displayName,
      avatar: avatarUrl || null,
      total: config.stamps,
      filled,
      justStamped,
      completed,
      rewardPoints: config.rewardPoints,
      week,
      position: config.position,
      theme: config.theme,
      duration: config.durationSeconds * 1000,
    }
  }

  // `identity`: { platform, platformUserId, username, displayName, avatarUrl }
  function claim(identity) {
    const config = getConfig()
    if (!config.enabled) return { ok: false, reason: "disabled" }
    const channelId = activeChannel()
    const viewer = platform.identities.resolve({
      platform: identity.platform,
      platformUserId: identity.platformUserId,
      username: identity.username,
      display: identity.displayName,
      avatarUrl: identity.avatarUrl,
    })
    const displayName = identity.displayName || identity.username
    const avatarUrl = identity.avatarUrl || viewer.avatar_url || null
    const at = now()
    const week = weekKey(at)

    return db.transaction(() => {
      const stream = streams.resolve()
      const filled = stampsThisWeek(channelId, viewer.id, week)
      const done = db.prepare("SELECT 1 FROM loyalty_completions WHERE channel_id=? AND viewer_id=? AND week_key=?")
        .get(channelId, viewer.id, week)
      if (done) return { ok: false, reason: "completed", filled, total: config.stamps }
      const already = db.prepare("SELECT 1 FROM loyalty_claims WHERE channel_id=? AND viewer_id=? AND stream_id=?")
        .get(channelId, viewer.id, stream.id)
      if (already) return { ok: false, reason: "already", filled, total: config.stamps }

      const stampNumber = filled + 1
      db.prepare(`INSERT INTO loyalty_claims(id, channel_id, viewer_id, stream_id, week_key, stamp_number, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), channelId, viewer.id, stream.id, week, stampNumber, at.toISOString())

      // Si el streamer baja el numero de sellos a mitad de semana, quien ya
      // lo supera completa en su siguiente sello.
      const completed = stampNumber >= config.stamps
      if (completed) {
        db.prepare(`INSERT INTO loyalty_completions(id, channel_id, viewer_id, week_key, reward_points, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), channelId, viewer.id, week, config.rewardPoints, at.toISOString())
        if (config.rewardPoints > 0) {
          platform.economy.applyMovement({
            channelId, viewerId: viewer.id, balanceDelta: config.rewardPoints,
            reason: "tarjeta-fidelidad",
            idempotencyKey: `loyalty:${channelId}:${viewer.id}:${week}`,
            sourceType: "loyalty", sourceId: week,
          })
        }
      }
      const shown = Math.min(stampNumber, config.stamps)
      return {
        ok: true, filled: shown, total: config.stamps, completed, rewardPoints: completed ? config.rewardPoints : 0,
        overlay: overlayPayload(config, { displayName, avatarUrl, filled: shown, justStamped: shown, completed, week }),
      }
    })()
  }

  // Tarjeta de un viewer para la pagina de canje: sellos de la semana, si ya
  // sello en este directo y si ahora hay directo (fuera de directo no se sella).
  function viewerStatus(viewerId) {
    const config = getConfig()
    const channelId = activeChannel()
    const week = weekKey(now())
    const current = streams.current()
    const filled = viewerId ? stampsThisWeek(channelId, viewerId, week) : 0
    const completed = !!(viewerId && db.prepare("SELECT 1 FROM loyalty_completions WHERE channel_id=? AND viewer_id=? AND week_key=?").get(channelId, viewerId, week))
    const claimedThisStream = !!(viewerId && current && db.prepare("SELECT 1 FROM loyalty_claims WHERE channel_id=? AND viewer_id=? AND stream_id=?").get(channelId, viewerId, current.id))
    return {
      enabled: config.enabled, title: config.title, total: config.stamps, filled: Math.min(filled, config.stamps), completed,
      // Directo: hay uno activo (chat reciente) o Twitch dice que esta en vivo
      // aunque nadie haya escrito todavia.
      claimedThisStream, live: !!current || streams.isTwitchLive(), rewardPoints: config.rewardPoints, week,
    }
  }

  // Estado para el panel: directo actual y tarjetas completas de la semana.
  function status() {
    const channelId = activeChannel()
    const week = weekKey(now())
    const current = streams.current()
    const streamClaims = current
      ? db.prepare("SELECT COUNT(*) AS n FROM loyalty_claims WHERE stream_id=?").get(current.id).n : 0
    const completions = db.prepare(`SELECT c.id, c.reward_points, c.delivered_at, c.created_at,
        i.platform, i.username, i.display
      FROM loyalty_completions c JOIN viewer_identities i ON i.id = c.viewer_id
      WHERE c.channel_id=? AND c.week_key=? ORDER BY c.created_at ASC`).all(channelId, week)
    return {
      week,
      twitchLive: streams.isTwitchLive(),
      stream: current ? { id: current.id, startedAt: current.started_at, source: current.source, claims: streamClaims } : null,
      completions: completions.map(row => ({
        id: row.id, platform: row.platform, username: row.username, displayName: row.display || row.username,
        rewardPoints: row.reward_points, deliveredAt: row.delivered_at, completedAt: row.created_at,
      })),
    }
  }

  // Marca (o desmarca) que el streamer ya entrego el premio externo (p. ej. cofres de Streamloots).
  function setDelivered(completionId, delivered) {
    const result = db.prepare("UPDATE loyalty_completions SET delivered_at=? WHERE id=? AND channel_id=?")
      .run(delivered ? now().toISOString() : null, String(completionId || ""), activeChannel())
    if (!result.changes) throw new Error("Tarjeta no encontrada")
    return status()
  }

  // Tarjeta de ejemplo para probar el overlay: no guarda nada.
  function preview({ completed = false } = {}) {
    const config = getConfig()
    const filled = completed ? config.stamps : Math.max(1, Math.ceil(config.stamps / 2))
    return overlayPayload(config, { displayName: "ViewerDemo", avatarUrl: null, filled, justStamped: filled, completed, week: weekKey(now()) })
  }

  return { getConfig, setConfig, claim, noteActivity, startNewStream, status, viewerStatus, setDelivered, preview }
}

let defaultService = null
function getDefaultLoyaltyService() {
  if (!defaultService) {
    defaultService = createLoyaltyService({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      sessions: require("./stream-sessions.js").getDefaultStreamSessions(),
    })
  }
  return defaultService
}

module.exports = { createLoyaltyService, getDefaultLoyaltyService, normalizeConfig, weekKey, DEFAULT_CONFIG }
