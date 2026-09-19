// services/shop.js — items de tienda (alertas, eventos)
const { randomUUID } = require("node:crypto")
const { getLocalPlatform } = require("./local-runtime.js")
const { viewerIdentityKey } = require("../core/identity/viewer-identity.js")

// Cooldowns en memoria: platform:username_itemtype → timestamp.
// Namespaced por plataforma (Fase 1.4) — sin esto, "!confeti" en Twitch
// dejaba en cooldown al mismo username en YouTube/TikTok, aunque fueran
// identidades distintas.
const COOLDOWN_MS = 30 * 1000 // 30 segundos entre compras del mismo item

function legacyIdentity(usernameOrIdentity, platformName, platformUserId = "") {
  if (usernameOrIdentity && typeof usernameOrIdentity === "object") return usernameOrIdentity
  return { username: usernameOrIdentity, platform: platformName || "twitch", platformUserId }
}

function createCooldownStore({ now = Date.now, cooldownMs = COOLDOWN_MS } = {}) {
  const cooldowns = new Map()

  function key(identity, itemType) {
    return `${viewerIdentityKey(identity)}:${String(itemType || "").toLowerCase()}`
  }

  function check(identity, itemType) {
    const last = cooldowns.get(key(identity, itemType))
    if (last === undefined) return 0
    return Math.max(0, cooldownMs - (now() - last))
  }

  function set(identity, itemType) {
    cooldowns.set(key(identity, itemType), now())
  }

  return { check, set }
}

const defaultCooldowns = createCooldownStore()

function checkCooldown(usernameOrIdentity, itemType, platformName = "twitch", platformUserId = "") {
  return defaultCooldowns.check(legacyIdentity(usernameOrIdentity, platformName, platformUserId), itemType)
}

function setCooldown(usernameOrIdentity, itemType, platformName = "twitch", platformUserId = "") {
  defaultCooldowns.set(legacyIdentity(usernameOrIdentity, platformName, platformUserId), itemType)
}

function listItems(channelId) { return getLocalPlatform().shop.list(channelId) }
function createItem(channelId, item) { return getLocalPlatform().shop.createItem(channelId, item) }
function purchase(channelId, identity, itemId, idempotencyKey = randomUUID(), quantity = 1) {
  const platform = getLocalPlatform()
  const viewer = platform.identities.resolve(identity)
  return platform.shop.purchase({ channelId, viewerId: viewer.id, itemId, idempotencyKey, quantity })
}
function inventory(channelId, identity) {
  const platform = getLocalPlatform()
  const viewer = platform.identities.resolve(identity)
  return platform.shop.inventory(channelId, viewer.id)
}

module.exports = { createCooldownStore, checkCooldown, setCooldown, listItems, createItem, purchase, inventory }
