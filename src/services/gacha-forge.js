// services/gacha-forge.js — forja del gachapon: varias copias de un mismo
// personaje se funden en 1 personaje al azar de la rareza siguiente
// (10 comunes, 7 raros o 5 epicos; ver FORGE_COSTS).
//
// Si la rareza siguiente no tiene personajes se salta a la proxima que tenga
// (comun -> epico si no hay raros). Los legendarios no se pueden forjar.
// Quitar las copias y dar el premio va en una sola transaccion.
const { randomUUID } = require("node:crypto")
const { normalizeRarity } = require("./canje-data.js")

// Copias necesarias segun la rareza del personaje que se funde.
const FORGE_COSTS = { comun: 10, raro: 7, epico: 5 }
const RARITY_STEPS = ["comun", "raro", "epico", "legendario"]

function createGachaForge({ platform, getChannel, random = Math.random }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  // Personajes de la primera rareza por encima de `rarity` que tenga alguno.
  function higherPool(channelId, rarity) {
    const cards = platform.profiles.droppableCards(channelId)
    for (const next of RARITY_STEPS.slice(RARITY_STEPS.indexOf(rarity) + 1)) {
      const pool = cards.filter(card => normalizeRarity(card.rarity) === next)
      if (pool.length) return pool
    }
    return []
  }

  function forge(viewerId, cardId) {
    const channelId = activeChannel()
    const card = db.prepare("SELECT * FROM cards_local WHERE id=? AND channel_id=?").get(String(cardId), channelId)
    if (!card) return { ok: false, reason: "gone" }
    const rarity = normalizeRarity(card.rarity)
    const cost = FORGE_COSTS[rarity]
    if (!cost) return { ok: false, reason: "max-rarity" }
    const pool = higherPool(channelId, rarity)
    if (!pool.length) return { ok: false, reason: "no-higher" }
    const prize = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
    const forged = db.transaction(() => {
      if (!platform.profiles.takeCard(channelId, viewerId, card.id, cost)) return false
      platform.profiles.grantCard(channelId, viewerId, prize.id, 1, `forja:${randomUUID()}`)
      return true
    })()
    if (!forged) return { ok: false, reason: "forge-short" }
    platform.activity.record(channelId, viewerId, "forge", 1)
    return { ok: true, used: { id: card.id, name: card.name, rarity, qty: cost }, card: prize }
  }

  return { forge }
}

module.exports = { createGachaForge, FORGE_COSTS }
