// services/ranks.js — rangos de viewer por plataforma (superfan, vip, mod, sub).
//
// Regla de oro: un rango SIEMPRE va calificado por plataforma ("tiktok:superfan",
// "twitch:vip"). Son rangos distintos y nunca se mezclan: un evento de Twitch
// solo puede tener rangos "twitch:*". Cruzarlos exige listarlos explicitamente
// en los permisos de un comando (ver command-config.js).
//
// Superfan: se calcula por monedas regaladas en el MES CALENDARIO en curso
// (tabla `donations`, zona horaria local) contra un umbral por plataforma. El
// rango caduca solo al cambiar de mes, porque el total del mes nuevo empieza en 0.
// Override manual (`rank_overrides`): pisa el calculo mientras no caduque, ya
// sea para conceder (grant) o para negar (deny) el rango.
//
// Cuando alguien entra o sale del rango se emite un evento `rank_change` al
// bus, para poder anunciarlo en overlay o chat.
const { randomUUID } = require("node:crypto")
const { monthKeyOf } = require("./gifts.js")

const PLATFORMS = ["twitch", "youtube", "tiktok", "kick"]
const RANKS = ["superfan", "vip", "mod", "sub"]
const AUTO_RANK = "superfan"
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const MAX_THRESHOLD_COINS = 1_000_000_000
const RANK_ID_PATTERN = /^(twitch|youtube|tiktok|kick):(superfan|vip|mod|sub)$/

const PLATFORM_LABELS = { twitch: "Twitch", youtube: "YouTube", tiktok: "TikTok", kick: "Kick" }
const RANK_LABELS = { superfan: "Superfan", vip: "VIP", mod: "Moderador", sub: "Suscriptor" }

function isValidRankId(value) {
  return typeof value === "string" && RANK_ID_PATTERN.test(value)
}

function rankLabel(rankId) {
  const [platformName, rank] = String(rankId).split(":")
  return `${RANK_LABELS[rank] || rank} de ${PLATFORM_LABELS[platformName] || platformName}`
}

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

// "2026-10-31" se interpreta como el final de ese dia en hora local.
function parseExpiry(value) {
  if (value === null || value === undefined || value === "") return null
  const raw = String(value).trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59)
    : new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error("Fecha de caducidad inválida")
  return date.toISOString()
}

function createRankService({ platform, getChannel, emit = () => {}, now = () => new Date(), isVipEvent = () => false, log = console }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function normalizePlatform(value) {
    const result = cleanText(value, 30).toLowerCase()
    if (!PLATFORMS.includes(result)) throw new Error("Plataforma no válida")
    return result
  }

  // ── Configuracion: umbral de superfan (monedas en el mes) por plataforma ──
  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), "ranks") || {}
    return { superfanThresholds: { ...(saved.superfanThresholds || {}) } }
  }

  function setSuperfanThreshold(platformName, coins) {
    const value = Number(coins)
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_THRESHOLD_COINS) throw new Error("Umbral inválido")
    const current = getConfig()
    const next = { superfanThresholds: { ...current.superfanThresholds, [normalizePlatform(platformName)]: value } }
    platform.moderation.setConfig(activeChannel(), "ranks", next)
    sweep()
    return next
  }

  // ── Calculo ─────────────────────────────────────────────────────────────
  function monthlyCoins(channelId, viewerId) {
    return db.prepare("SELECT COALESCE(SUM(coins), 0) AS total FROM donations WHERE channel_id=? AND viewer_id=? AND month_key=?")
      .get(channelId, viewerId, monthKeyOf(now())).total
  }

  function activeOverride(channelId, viewerId, rank) {
    return db.prepare(`SELECT * FROM rank_overrides
      WHERE channel_id=? AND viewer_id=? AND rank=? AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY granted_at DESC, rowid DESC LIMIT 1`).get(channelId, viewerId, rank, now().toISOString())
  }

  function autoSuperfan(channelId, viewer) {
    const threshold = getConfig().superfanThresholds[viewer.platform] || 0
    return threshold > 0 && monthlyCoins(channelId, viewer.id) >= threshold
  }

  // El override manda; sin override, el calculo automatico.
  function evaluateSuperfan(channelId, viewer) {
    const override = activeOverride(channelId, viewer.id, AUTO_RANK)
    if (override) return { holds: override.effect === "grant", cause: "override" }
    return { holds: autoSuperfan(channelId, viewer), cause: "auto" }
  }

  function findViewer(channelId, event) {
    const platformName = String(event?.platform || "").toLowerCase()
    const username = cleanText(event?.actor?.username, 80).toLowerCase()
    const userId = cleanText(event?.actor?.platformUserId, 160)
    if (!PLATFORMS.includes(platformName) || (!userId && !username)) return null
    return db.prepare(`SELECT * FROM viewer_identities WHERE platform=? AND (platform_user_id=? OR platform_user_id=?)
      ORDER BY (platform_user_id=?) DESC LIMIT 1`).get(platformName, userId, `legacy:${username}`, userId) || null
  }

  // Rangos calificados que tiene el autor de un evento. No crea identidades:
  // consultar permisos no debe tener efectos secundarios.
  function getEventRanks(event) {
    const platformName = String(event?.platform || "").toLowerCase()
    if (!PLATFORMS.includes(platformName)) return []
    const channelId = activeChannel()
    const viewer = findViewer(channelId, event)
    const base = {
      mod: event?.actor?.isModerator === true,
      vip: event?.actor?.isVip === true || Boolean(isVipEvent(event)),
      superfan: false,
      // Suscriptor: lo marca el adaptador de la plataforma (insignia de Twitch).
      sub: event?.actor?.isSubscriber === true,
    }
    const held = []
    for (const rank of RANKS) {
      let holds = base[rank]
      if (viewer) {
        if (rank === AUTO_RANK) holds = evaluateSuperfan(channelId, viewer).holds
        else {
          const override = activeOverride(channelId, viewer.id, rank)
          if (override) holds = override.effect === "grant"
        }
      }
      if (holds) held.push(`${platformName}:${rank}`)
    }
    return held
  }

  // ── Estado y eventos de entrada/salida ──────────────────────────────────
  function refreshViewer(viewerId) {
    const viewer = platform.identities.get(viewerId)
    if (!viewer || !PLATFORMS.includes(viewer.platform)) return null
    const channelId = activeChannel()
    const { holds, cause } = evaluateSuperfan(channelId, viewer)
    const state = db.prepare("SELECT is_active FROM rank_state WHERE channel_id=? AND viewer_id=? AND rank=?")
      .get(channelId, viewerId, AUTO_RANK)
    const wasActive = state ? state.is_active === 1 : false
    if (state && wasActive === holds) return null

    db.prepare(`INSERT INTO rank_state(channel_id, viewer_id, rank, is_active, since) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel_id, viewer_id, rank) DO UPDATE SET is_active=excluded.is_active, since=excluded.since`)
      .run(channelId, viewerId, AUTO_RANK, holds ? 1 : 0, now().toISOString())
    // Un viewer nuevo sin el rango solo se registra: no es un "cambio" que anunciar.
    if (holds === wasActive) return null

    const change = holds ? "enter" : "leave"
    try {
      emit({
        platform: viewer.platform,
        type: "rank_change",
        source: "mimiku-ranks",
        actor: { platformUserId: viewer.platform_user_id, username: viewer.username, displayName: viewer.display },
        payload: { rank: AUTO_RANK, rankId: `${viewer.platform}:${AUTO_RANK}`, change, cause, at: now().toISOString() },
      })
    } catch (error) {
      log.error("[ranks] no se pudo emitir rank_change:", error.message)
    }
    return { viewerId, change, cause }
  }

  // Recalcula a todos los viewers con algo que pueda haber cambiado: quienes
  // ya tienen el rango (por si cambio el mes o caduco un override), quienes
  // superan hoy el umbral y quienes tienen overrides.
  function sweep() {
    const channelId = activeChannel()
    const candidates = new Set()
    for (const row of db.prepare("SELECT viewer_id FROM rank_state WHERE channel_id=? AND rank=? AND is_active=1")
      .all(channelId, AUTO_RANK)) candidates.add(row.viewer_id)
    for (const row of db.prepare("SELECT DISTINCT viewer_id FROM rank_overrides WHERE channel_id=? AND rank=?")
      .all(channelId, AUTO_RANK)) candidates.add(row.viewer_id)
    for (const [platformName, threshold] of Object.entries(getConfig().superfanThresholds)) {
      if (!(threshold > 0)) continue
      for (const row of db.prepare(`SELECT viewer_id FROM donations WHERE channel_id=? AND month_key=? AND platform=?
        GROUP BY viewer_id HAVING SUM(coins) >= ?`).all(channelId, monthKeyOf(now()), platformName, threshold)) {
        candidates.add(row.viewer_id)
      }
    }
    let changes = 0
    for (const viewerId of candidates) if (refreshViewer(viewerId)) changes++
    return changes
  }

  // ── Overrides manuales ──────────────────────────────────────────────────
  function addOverride({ platform: platformName, username, rank = AUTO_RANK, effect = "grant", expiresAt, grantedBy, reason }) {
    if (!RANKS.includes(rank)) throw new Error("Rango no válido")
    if (effect !== "grant" && effect !== "deny") throw new Error("Efecto no válido")
    const cleanedUser = cleanText(username, 80).replace(/^@/, "")
    if (!cleanedUser) throw new Error("Escribe el usuario")
    const expiry = parseExpiry(expiresAt)
    if (expiry && new Date(expiry) <= now()) throw new Error("La fecha de caducidad ya pasó")
    // Primero se busca al viewer ya conocido (con su id real de la plataforma);
    // solo si nunca se ha visto se crea una identidad provisional, que
    // identities.resolve() enlaza sola cuando llegue con su id real.
    const platformNameChecked = normalizePlatform(platformName)
    const viewer = platform.identities.byUsername(cleanedUser, platformNameChecked)
      || platform.identities.resolve({ platform: platformNameChecked, username: cleanedUser })
    db.prepare(`INSERT INTO rank_overrides(id, channel_id, viewer_id, rank, effect, expires_at, granted_by, granted_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), activeChannel(), viewer.id, rank, effect, expiry, cleanText(grantedBy, 100) || "streamer",
        now().toISOString(), cleanText(reason, 500))
    if (rank === AUTO_RANK) refreshViewer(viewer.id)
    return listOverrides()
  }

  function removeOverride(id) {
    const row = db.prepare("SELECT viewer_id, rank FROM rank_overrides WHERE id=? AND channel_id=?").get(id, activeChannel())
    if (!row) return listOverrides()
    db.prepare("DELETE FROM rank_overrides WHERE id=?").run(id)
    if (row.rank === AUTO_RANK) refreshViewer(row.viewer_id)
    return listOverrides()
  }

  function listOverrides() {
    const current = now().toISOString()
    return db.prepare(`SELECT o.*, i.username, i.display, i.platform FROM rank_overrides o
      JOIN viewer_identities i ON i.id=o.viewer_id WHERE o.channel_id=? ORDER BY o.granted_at DESC, o.rowid DESC`)
      .all(activeChannel())
      .map(row => ({ ...row, expired: Boolean(row.expires_at && row.expires_at <= current) }))
  }

  let timer = null
  function start(intervalMs = SWEEP_INTERVAL_MS) {
    if (timer) return
    try { sweep() } catch (error) { log.error("[ranks] barrido inicial fallido:", error.message) }
    timer = setInterval(() => {
      try { sweep() } catch (error) { log.error("[ranks] barrido fallido:", error.message) }
    }, intervalMs)
    if (typeof timer.unref === "function") timer.unref()
  }

  function stop() {
    clearInterval(timer)
    timer = null
  }

  return {
    getConfig, setSuperfanThreshold, getEventRanks, refreshViewer, sweep,
    addOverride, removeOverride, listOverrides, start, stop,
  }
}

let defaultService = null
function getDefaultRankService() {
  if (!defaultService) {
    defaultService = createRankService({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      emit: event => require("../core/events/event-engine.js").getDefaultEventEngine().emit(event),
      isVipEvent: event => require("./vips.js").isVip(event),
    })
  }
  return defaultService
}

module.exports = {
  createRankService, getDefaultRankService, isValidRankId, rankLabel,
  PLATFORMS, RANKS, RANK_ID_PATTERN,
}
