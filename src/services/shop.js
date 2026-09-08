// services/shop.js — items de tienda (alertas, eventos)
const { randomUUID } = require("node:crypto")
const { getLocalPlatform } = require("./local-runtime.js")

// Cooldowns en memoria: username_itemtype → timestamp
const cooldowns = {}
const COOLDOWN_MS = 30 * 1000 // 30 segundos entre compras del mismo item

function checkCooldown(username, itemType) {
  const key = `${username}_${itemType}`
  const last = cooldowns[key] || 0
  const remaining = Math.max(0, COOLDOWN_MS - (Date.now() - last))
  return remaining
}

function setCooldown(username, itemType) {
  cooldowns[`${username}_${itemType}`] = Date.now()
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

module.exports = { checkCooldown, setCooldown, listItems, createItem, purchase, inventory }
