// services/gifts.js — regalos de plataformas de directo (hoy, TikTok).
//
// Un regalo cerrado hace DOS cosas independientes:
//   1. Siempre: se convierte a puntos según la tabla de conversión y queda
//      registrado en `donations` (base del rango de superfan, Fase 3).
//   2. Opcionalmente: dispara Mimics según las reglas `gift_mimic_rules`
//      (por tipo de regalo y/o cantidad mínima dentro del combo).
// Ambas partes son idempotentes por `payload.comboId`: reprocesar el mismo
// evento no duplica puntos, donación ni Mimics.
//
// No conoce TikTok: solo lee el evento normalizado `gift` del Event Engine.
const { randomUUID } = require("node:crypto")

const ANY_GIFT = "*"
const DEFAULT_POINTS_PER_COIN = 1
const MAX_POINTS_PER_COIN = 100000
const RATE_PLATFORMS = new Set(["twitch", "youtube", "tiktok", "kick"])

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

// Mes calendario en la zona horaria local del streamer: "2026-09".
function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function createGiftService({ platform, addPointsFor, getChannel, now = () => new Date(), log = console, onDonation = () => {} }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function normalizePlatform(value) {
    const result = cleanText(value, 30).toLowerCase()
    if (!RATE_PLATFORMS.has(result)) throw new Error("Plataforma no válida")
    return result
  }

  // ── Tabla de conversión monedas → puntos ────────────────────────────────
  function getRate(channelId, platformName, giftId) {
    const rows = db.prepare(`SELECT gift_id, points_per_coin FROM gift_point_rates
      WHERE channel_id=? AND platform=? AND gift_id IN (?, ?)`).all(channelId, platformName, String(giftId), ANY_GIFT)
    const specific = rows.find(row => row.gift_id === String(giftId))
    const general = rows.find(row => row.gift_id === ANY_GIFT)
    return (specific || general)?.points_per_coin ?? DEFAULT_POINTS_PER_COIN
  }

  function setRate({ platform: platformName, giftId = ANY_GIFT, pointsPerCoin }) {
    const rate = Number(pointsPerCoin)
    if (!Number.isFinite(rate) || rate < 0 || rate > MAX_POINTS_PER_COIN) throw new Error("Tasa de conversión inválida")
    db.prepare(`INSERT INTO gift_point_rates(channel_id, platform, gift_id, points_per_coin) VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, platform, gift_id) DO UPDATE SET points_per_coin=excluded.points_per_coin, updated_at=datetime('now')`)
      .run(activeChannel(), normalizePlatform(platformName), cleanText(String(giftId), 100) || ANY_GIFT, rate)
    return listRates()
  }

  function removeRate({ platform: platformName, giftId }) {
    db.prepare("DELETE FROM gift_point_rates WHERE channel_id=? AND platform=? AND gift_id=?")
      .run(activeChannel(), normalizePlatform(platformName), cleanText(String(giftId), 100))
    return listRates()
  }

  function listRates() {
    return db.prepare("SELECT platform, gift_id, points_per_coin FROM gift_point_rates WHERE channel_id=? ORDER BY platform, gift_id")
      .all(activeChannel())
  }

  // ── Reglas de Mimic por regalo ──────────────────────────────────────────
  function addRule({ platform: platformName = "tiktok", giftId = ANY_GIFT, minCount = 1, mimicId }) {
    const count = Number(minCount)
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("La cantidad mínima debe ser 1 o más")
    if (!platform.mimics.get(mimicId)) throw new Error("Mimic no encontrado")
    const id = randomUUID()
    db.prepare(`INSERT INTO gift_mimic_rules(id, channel_id, platform, gift_id, min_count, mimic_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, activeChannel(), normalizePlatform(platformName), cleanText(String(giftId), 100) || ANY_GIFT, count, mimicId)
    return listRules()
  }

  function setRuleEnabled(id, enabled) {
    db.prepare("UPDATE gift_mimic_rules SET enabled=? WHERE id=? AND channel_id=?").run(enabled ? 1 : 0, id, activeChannel())
    return listRules()
  }

  function removeRule(id) {
    db.prepare("DELETE FROM gift_mimic_rules WHERE id=? AND channel_id=?").run(id, activeChannel())
    return listRules()
  }

  function listRules() {
    return db.prepare(`SELECT r.*, m.name AS mimic_name FROM gift_mimic_rules r
      JOIN mimics_local m ON m.id=r.mimic_id WHERE r.channel_id=? ORDER BY r.created_at, r.rowid`).all(activeChannel())
  }

  function matchingRules(channelId, platformName, giftId, count) {
    return db.prepare(`SELECT * FROM gift_mimic_rules
      WHERE channel_id=? AND platform=? AND enabled=1 AND gift_id IN (?, ?) AND min_count<=?
      ORDER BY created_at, rowid`).all(channelId, platformName, String(giftId), ANY_GIFT, count)
  }

  // ── Procesado de un evento `gift` ───────────────────────────────────────
  function handleGift(event) {
    const gift = event?.payload
    if (!gift || !gift.comboId) return { skipped: "sin-payload" }
    // Igual que XP y niveles: nunca se otorga nada a una identidad no resuelta.
    if (event.platform === "unknown") return { skipped: "plataforma-desconocida" }

    const channelId = activeChannel()
    const key = `gift:${event.platform}:${gift.comboId}`
    if (db.prepare("SELECT 1 FROM donations WHERE idempotency_key=?").get(key)) return { duplicate: true }

    const viewer = platform.identities.resolve({
      platform: event.platform,
      platformUserId: event.actor.platformUserId,
      username: event.actor.username,
      display: event.actor.displayName,
      avatarUrl: event.actor.avatarUrl,
    })
    const coins = Math.max(0, Math.trunc(Number(gift.coins) || 0))
    const count = Math.max(1, Math.trunc(Number(gift.count) || 1))
    const points = Math.floor(coins * getRate(channelId, event.platform, gift.giftId))

    db.transaction(() => {
      db.prepare(`INSERT INTO donations(id, idempotency_key, channel_id, viewer_id, platform, gift_id, gift_name,
        gift_count, coins, points_awarded, month_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), key, channelId, viewer.id, event.platform, String(gift.giftId || ""),
          cleanText(gift.giftName, 100), count, coins, points, monthKeyOf(now()), now().toISOString())
      if (points > 0) {
        addPointsFor({
          platform: event.platform,
          platformUserId: event.actor.platformUserId,
          username: event.actor.username,
          displayName: event.actor.displayName,
        }, points, "regalo", { idempotencyKey: `${key}:points`, sourceType: "gift", sourceId: gift.comboId })
      }
    })()

    // Avisa de la donacion (p. ej. para recalcular el rango de superfan). Un
    // fallo aqui no debe deshacer puntos ni donacion, igual que con los Mimics.
    try { onDonation(viewer.id, event.platform) } catch (error) {
      log.error("[gifts] onDonation fallo:", error.message)
    }

    // Los Mimics van FUERA de la transacción: un Mimic que falle no debe
    // deshacer los puntos ni el registro de la donación.
    let triggered = 0
    for (const rule of matchingRules(channelId, event.platform, gift.giftId, count)) {
      try {
        platform.mimics.trigger(channelId, viewer.id, rule.mimic_id, `${key}:rule:${rule.id}`)
        triggered++
      } catch (error) {
        log.error(`[gifts] no se pudo disparar el Mimic de la regla ${rule.id}:`, error.message)
      }
    }
    return { duplicate: false, coins, count, points, triggered }
  }

  return { handleGift, getRate, setRate, removeRate, listRates, addRule, setRuleEnabled, removeRule, listRules }
}

function registerGiftConsumer(eventEngine, service) {
  return eventEngine.subscribe("gift", event => service.handleGift(event))
}

let defaultService = null
function getDefaultGiftService() {
  if (!defaultService) {
    const platform = require("./local-runtime.js").getLocalPlatform()
    defaultService = createGiftService({
      platform,
      addPointsFor: (...args) => require("./economy.js").addPointsFor(...args),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      onDonation: viewerId => require("./ranks.js").getDefaultRankService().refreshViewer(viewerId),
    })
  }
  return defaultService
}

module.exports = { createGiftService, registerGiftConsumer, getDefaultGiftService, monthKeyOf, ANY_GIFT }
