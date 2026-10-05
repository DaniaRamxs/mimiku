// services/plinko.js — minijuego Plinko de la pagina de canje.
//
// El viewer paga el precio y la bola cae en una de 9 casillas. El servidor
// decide la casilla (la pagina solo anima la caida hasta ella):
//   bordes = legendario, luego epico, luego raro, y las 3 del centro = nada.
// El premio es un personaje del gachapon o un Mimic de esa rareza, al azar
// entre todos los que existan. Las rarezas sin nada que dar no pueden salir.
// Cobrar y entregar el premio va en una sola transaccion.
const { normalizeRarity } = require("./canje-data.js")

const CONFIG_KEY = "plinko"
const DEFAULT_PRICE = 150
const MAX_PRICE = 1_000_000
// Casillas de izquierda a derecha.
const SLOTS = ["legendario", "epico", "raro", "nada", "nada", "nada", "raro", "epico", "legendario"]
// Probabilidad (peso) de cada resultado.
const ODDS = { nada: 62, raro: 25, epico: 10, legendario: 3 }
const PRIZE_TIERS = ["raro", "epico", "legendario"]
const TIER_LABELS = { nada: "Nada", raro: "Raro", epico: "Épico", legendario: "Legendario" }

function pickWeighted(weights, random) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let cursor = random() * total
  for (const [name, weight] of entries) {
    cursor -= weight
    if (cursor < 0) return name
  }
  return entries[entries.length - 1][0]
}

function pickOne(list, random) {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))]
}

function createPlinko({ platform, getChannel, random = Math.random }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    const price = Math.trunc(Number(saved.price))
    return { price: Number.isFinite(price) && price >= 1 && price <= MAX_PRICE ? price : DEFAULT_PRICE }
  }

  function setConfig(input = {}) {
    const price = Number(input.price)
    if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) throw new Error("El precio del Plinko debe ser un número entero de al menos 1")
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, { price })
    return getConfig()
  }

  // Premios posibles por rareza: personajes del gachapon y Mimics.
  function prizePools(channelId) {
    const pools = Object.fromEntries(PRIZE_TIERS.map(tier => [tier, []]))
    for (const card of platform.profiles.droppableCards(channelId)) {
      const rarity = normalizeRarity(card.rarity)
      if (pools[rarity]) pools[rarity].push({ kind: "card", row: card })
    }
    for (const mimic of platform.mimics.list(channelId)) {
      const rarity = normalizeRarity(mimic.rarity)
      if (pools[rarity]) pools[rarity].push({ kind: "mimic", row: mimic })
    }
    return pools
  }

  // Probabilidades en % de lo que puede salir ahora mismo.
  function odds() {
    const pools = prizePools(activeChannel())
    const weights = Object.fromEntries(Object.entries(ODDS).filter(([tier]) => tier === "nada" || pools[tier].length))
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
    return Object.fromEntries(Object.entries(ODDS).map(([tier]) => [tier, weights[tier] ? Math.round((weights[tier] / total) * 1000) / 10 : 0]))
  }

  function play(viewerId, idempotencyKey) {
    const channelId = activeChannel()
    const { price } = getConfig()
    const pools = prizePools(channelId)
    const weights = Object.fromEntries(Object.entries(ODDS).filter(([tier]) => tier === "nada" || pools[tier].length))
    const tier = pickWeighted(weights, random)
    const slot = pickOne(SLOTS.map((name, index) => [name, index]).filter(([name]) => name === tier), random)[1]
    const prize = tier === "nada" ? null : pickOne(pools[tier], random)
    // Una bola gratis (Pase Sub) se gasta antes que los puntos.
    let free = false
    try {
      db.transaction(() => {
        free = platform.tickets.use(channelId, viewerId, "plinko")
        if (!free) {
          platform.economy.applyMovement({
            channelId, viewerId, balanceDelta: -price, idempotencyKey,
            reason: "Plinko", sourceType: "minigame", sourceId: "plinko",
          })
        }
        if (prize && prize.kind === "card") platform.profiles.grantCard(channelId, viewerId, prize.row.id, 1, idempotencyKey)
        if (prize && prize.kind === "mimic") platform.mimics.grant(channelId, viewerId, prize.row.id, 1, idempotencyKey)
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
    platform.activity.record(channelId, viewerId, "plinko", 1)
    // Un personaje legendario del Plinko cuenta en Destacados de la semana.
    if (prize && prize.kind === "card" && normalizeRarity(prize.row.rarity) === "legendario") platform.activity.record(channelId, viewerId, "legendary", 1)
    return { ok: true, price: free ? 0 : price, free, slot, tier, prize }
  }

  // Para el comando !plinko del chat: juega con la identidad del que escribe.
  function playAs(identity, idempotencyKey) {
    const viewer = platform.identities.resolve({
      platform: identity.platform, platformUserId: identity.platformUserId, username: identity.username, display: identity.displayName,
    })
    const result = play(viewer.id, idempotencyKey)
    const balance = platform.economy.getBalance(activeChannel(), viewer.id).balance
    return result.ok ? { ...result, balance } : { ...result, price: getConfig().price, balance }
  }

  return { getConfig, setConfig, odds, play, playAs }
}

let defaultPlinko = null
function getDefaultPlinko() {
  if (!defaultPlinko) {
    defaultPlinko = createPlinko({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
    })
  }
  return defaultPlinko
}

module.exports = { createPlinko, getDefaultPlinko, SLOTS, ODDS, DEFAULT_PRICE, CONFIG_KEY, TIER_LABELS }
