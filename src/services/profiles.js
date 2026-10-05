// Perfiles, cartas, cosméticos y logros respaldados por SQLite local.
const { randomUUID } = require("node:crypto")
const { getLocalPlatform } = require("./local-runtime.js")

// Identidad multiplataforma (Fase 1.4): estas funciones no tienen ningún
// llamador activo todavía (no hay comando de chat conectado a perfiles/
// cartas/cosméticos vía Command Engine), pero se corrige el mismo hardcode
// de "twitch" para que no resurja el bug apenas se conecten.
function resolve(username, display = "", platformUserId = "", platformName = "twitch") {
  return getLocalPlatform().identities.resolve({ platform: platformName, platformUserId, username, display })
}

async function getOrCreateProfile(channelId, username, display = "", avatarUrl = "", platformUserId = "", platformName = "twitch") {
  return getLocalPlatform().profiles.getOrCreate(channelId, {
    platform: platformName, platformUserId, username, display, avatarUrl,
  })
}

async function updateProfile(channelId, username, updates, platformName = "twitch") {
  const viewer = resolve(username, "", "", platformName)
  return getLocalPlatform().profiles.update(channelId, viewer.id, updates)
}

async function addHoursWatched(channelId, username, hours, platformName = "twitch") {
  const profile = await getOrCreateProfile(channelId, username, "", "", "", platformName)
  return getLocalPlatform().profiles.update(channelId, profile.viewer_id, {
    hoursWatched: profile.hours_watched + Math.max(0, Number(hours) || 0),
  })
}

async function getCards(channelId) { return getLocalPlatform().profiles.listCards(channelId) }
async function createCard(channelId, name, description, imagePath, rarity, exclusive = "") {
  return getLocalPlatform().profiles.createCard(channelId, { name, description, imagePath, rarity, exclusive })
}
async function deleteCard(cardId) { return getLocalPlatform().profiles.removeCard(cardId) }
async function getPacks(channelId) { return getLocalPlatform().profiles.listPacks(channelId) }
async function createPack(channelId, name, description, price, tier) {
  return getLocalPlatform().profiles.createPack(channelId, { name, description, price: Number(price), tier, cardsCount: 3 })
}

function pickCard(cards, tier) {
  const weights = tier === "premium"
    ? { common: 30, rare: 35, epic: 25, legendary: 10 }
    : { common: 60, rare: 25, epic: 12, legendary: 3 }
  const roll = Math.random() * 100
  const rarity = roll < weights.legendary ? "legendary"
    : roll < weights.legendary + weights.epic ? "epic"
      : roll < weights.legendary + weights.epic + weights.rare ? "rare" : "common"
  const pool = cards.filter(card => card.rarity === rarity)
  const source = pool.length ? pool : cards
  return source[Math.floor(Math.random() * source.length)]
}

async function openPack(channelId, username, packId, idempotencyKey = `pack:${randomUUID()}`, platformName = "twitch") {
  const platform = getLocalPlatform()
  const viewer = resolve(username, "", "", platformName)
  const pack = platform.profiles.listPacks(channelId).find(item => item.id === packId)
  if (!pack) return { error: "Sobre no encontrado." }
  const cards = platform.profiles.listCards(channelId)
  if (!cards.length) return { error: "Este canal no tiene cartas configuradas aún." }
  try {
    return platform.db.transaction(() => {
      const itemId = `pack:${pack.id}`
      let item = platform.db.prepare("SELECT * FROM shop_items_local WHERE id=?").get(itemId)
      if (!item) item = platform.shop.createItem(channelId, { id: itemId, name: pack.name, itemType: "card_pack", itemRef: pack.id, price: pack.price })
      const purchase = platform.shop.purchase({ channelId, viewerId: viewer.id, itemId: item.id, idempotencyKey })
      const existing = platform.db.prepare("SELECT payload_json FROM local_outbox WHERE aggregate_id=? AND event_type='pack_opened'").get(purchase.id)
      if (existing) return JSON.parse(existing.payload_json)
      const drawn = Array.from({ length: pack.cards_count }, () => pickCard(cards, pack.tier))
      for (const card of drawn) platform.profiles.grantCard(channelId, viewer.id, card.id, 1)
      const result = { ok: true, cards: drawn, pack, purchaseId: purchase.id }
      platform.db.prepare("INSERT INTO local_outbox(id,event_type,aggregate_id,payload_json,status) VALUES(?,?,?,?,?)")
        .run(randomUUID(), "pack_opened", purchase.id, JSON.stringify(result), "processed")
      return result
    })()
  } catch (error) { return { error: error.message } }
}

async function getViewerCards(channelId, username, platformName = "twitch") {
  const viewer = resolve(username, "", "", platformName)
  return getLocalPlatform().profiles.getCards(channelId, viewer.id)
}

async function getCosmetics(channelId) { return getLocalPlatform().profiles.listCosmetics(channelId) }
async function createCosmetic(channelId, name, type, imagePath, color, price) {
  return getLocalPlatform().profiles.createCosmetic(channelId, { name, type, imagePath, color, price: Number(price) })
}

async function buyCosmetic(channelId, username, cosmeticId, idempotencyKey = `cosmetic:${randomUUID()}`, platformName = "twitch") {
  const platform = getLocalPlatform()
  const viewer = resolve(username, "", "", platformName)
  const cosmetic = platform.profiles.listCosmetics(channelId).find(item => item.id === cosmeticId)
  if (!cosmetic) return { error: "Cosmético no encontrado." }
  try {
    return platform.db.transaction(() => {
      if (platform.profiles.getCosmetics(channelId, viewer.id).some(item => item.cosmetic_id === cosmeticId)) return { error: "Ya tenés este cosmético." }
      const itemId = `cosmetic:${cosmetic.id}`
      let item = platform.db.prepare("SELECT * FROM shop_items_local WHERE id=?").get(itemId)
      if (!item) item = platform.shop.createItem(channelId, { id: itemId, name: cosmetic.name, itemType: "cosmetic", itemRef: cosmetic.id, price: cosmetic.price })
      platform.shop.purchase({ channelId, viewerId: viewer.id, itemId: item.id, idempotencyKey })
      platform.profiles.grantCosmetic(channelId, viewer.id, cosmetic.id, `grant:${idempotencyKey}`)
      return { ok: true, cosmetic }
    })()
  } catch (error) { return { error: error.message } }
}

async function equipCosmetic(channelId, username, cosmeticId, platformName = "twitch") {
  const viewer = resolve(username, "", "", platformName)
  const cosmetic = getLocalPlatform().profiles.equipCosmetic(channelId, viewer.id, cosmeticId)
  const fields = { frame: "frameUrl", banner: "bannerUrl", badge: "badgeUrl", name_color: "nameColor" }
  if (fields[cosmetic.type]) getLocalPlatform().profiles.update(channelId, viewer.id, { [fields[cosmetic.type]]: cosmetic.image_path || cosmetic.color })
  return { ok: true }
}

async function checkAchievements(channelId, username, platformName = "twitch") {
  const platform = getLocalPlatform()
  const viewer = resolve(username, "", "", platformName)
  const economy = require("./economy.js").getViewer(username, platformName)
  const profile = await getOrCreateProfile(channelId, username, "", "", "", platformName)
  const owned = new Set(platform.profiles.getAchievements(channelId, viewer.id).map(item => item.achievement_id))
  const unlocked = []
  for (const achievement of platform.profiles.listAchievements()) {
    if (owned.has(achievement.id)) continue
    const value = achievement.condition === "messages" ? economy?.messages || 0
      : achievement.condition === "hours" ? profile.hours_watched : economy?.points || 0
    if (value >= achievement.threshold) {
      platform.profiles.grantAchievement(channelId, viewer.id, achievement.id, `achievement:${viewer.id}:${achievement.id}`)
      unlocked.push(achievement)
    }
  }
  return unlocked
}

async function getViewerAchievements(channelId, username, platformName = "twitch") {
  const viewer = resolve(username, "", "", platformName)
  return getLocalPlatform().profiles.getAchievements(channelId, viewer.id)
}

module.exports = {
  getOrCreateProfile, updateProfile, addHoursWatched,
  getCards, createCard, deleteCard,
  getPacks, createPack, openPack, getViewerCards,
  getCosmetics, createCosmetic, buyCosmetic, equipCosmetic,
  checkAchievements, getViewerAchievements,
}
