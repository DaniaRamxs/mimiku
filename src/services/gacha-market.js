// services/gacha-market.js — mercado del gachapon a precio fijo.
//
// Un viewer pone un personaje a la venta por X puntos. La carta sale de su
// coleccion y queda retenida en la venta (asi no se puede regalar, robar ni
// vender dos veces). El primero que compra se la lleva; el vendedor recibe el
// precio menos la comision del canal (por defecto 5%, esos puntos desaparecen).
// Si la retira, la carta vuelve a su coleccion.
const { randomUUID } = require("node:crypto")

const CONFIG_KEY = "gacha_market"
const DEFAULT_FEE_PERCENT = 5
const MAX_FEE_PERCENT = 50
const MAX_PRICE = 1_000_000_000
const MAX_OPEN_PER_SELLER = 20
const RECENT_SALES = 10

class MarketError extends Error {
  constructor(reason) { super(reason); this.reason = reason }
}

function validPrice(value) {
  const price = Number(value)
  return Number.isSafeInteger(price) && price >= 1 && price <= MAX_PRICE ? price : 0
}

function createGachaMarket({ platform, getChannel, now = Date.now }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso() { return new Date(now()).toISOString() }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    const fee = Math.trunc(Number(saved.feePercent))
    return { feePercent: Number.isFinite(fee) && fee >= 0 && fee <= MAX_FEE_PERCENT ? fee : DEFAULT_FEE_PERCENT }
  }

  function setConfig(input = {}) {
    const fee = Number(input.feePercent)
    if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE_PERCENT) throw new Error(`La comisión va de 0 a ${MAX_FEE_PERCENT}%`)
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, { feePercent: fee })
    return getConfig()
  }

  function feeFor(price) {
    return Math.floor((price * getConfig().feePercent) / 100)
  }

  // Pone a la venta 1 copia de `cardId` (con `sleeve`/`rank`, una copia con esa
  // funda y/o ese rango, que el comprador recibe igual). Devuelve { ok, listingId } o { ok:false, reason }.
  function list(sellerId, cardId, priceInput, { sleeve = null, rank = null } = {}) {
    const channelId = activeChannel()
    const price = validPrice(priceInput)
    if (!price) return { ok: false, reason: "bad-price" }
    const open = db.prepare("SELECT COUNT(*) AS n FROM gacha_listings WHERE channel_id=? AND seller_id=? AND status='open'").get(channelId, sellerId).n
    if (open >= MAX_OPEN_PER_SELLER) return { ok: false, reason: "too-many" }
    const id = randomUUID()
    const moved = db.transaction(() => {
      if (!platform.profiles.takeCard(channelId, sellerId, String(cardId), 1, { sleeve, rank })) return false
      db.prepare(`INSERT INTO gacha_listings(id, channel_id, seller_id, card_id, price, sleeve, rank, created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(id, channelId, sellerId, String(cardId), price, sleeve || null, rank || null, iso())
      return true
    })()
    return moved ? { ok: true, listingId: id, price } : { ok: false, reason: "not-owned" }
  }

  function cancel(sellerId, listingId) {
    const channelId = activeChannel()
    return db.transaction(() => {
      const row = db.prepare("SELECT * FROM gacha_listings WHERE id=? AND channel_id=?").get(String(listingId), channelId)
      if (!row || row.status !== "open") return { ok: false, reason: "gone" }
      if (row.seller_id !== sellerId) return { ok: false, reason: "not-yours" }
      db.prepare("UPDATE gacha_listings SET status='cancelled', closed_at=? WHERE id=?").run(iso(), row.id)
      platform.profiles.grantCard(channelId, sellerId, row.card_id, 1, `mercado:${row.id}:retirada`, { sleeve: row.sleeve, rank: row.rank })
      return { ok: true }
    })()
  }

  // El cobro al comprador, el pago al vendedor y la entrega de la carta van en
  // una transaccion: si el comprador no tiene saldo no cambia nada.
  function buy(buyerId, listingId) {
    const channelId = activeChannel()
    try {
      return db.transaction(() => {
        const row = db.prepare("SELECT * FROM gacha_listings WHERE id=? AND channel_id=?").get(String(listingId), channelId)
        if (!row || row.status !== "open") throw new MarketError("gone")
        if (row.seller_id === buyerId) throw new MarketError("own")
        const fee = feeFor(row.price)
        const card = db.prepare("SELECT name FROM cards_local WHERE id=?").get(row.card_id)
        const name = card ? card.name : "personaje"
        db.prepare("UPDATE gacha_listings SET status='sold', buyer_id=?, fee=?, closed_at=? WHERE id=?").run(buyerId, fee, iso(), row.id)
        platform.economy.applyMovement({
          channelId, viewerId: buyerId, balanceDelta: -row.price, idempotencyKey: `mercado:${row.id}:compra`,
          reason: `Mercado: compra de ${name}`, sourceType: "gacha-market", sourceId: row.id,
        })
        platform.economy.applyMovement({
          channelId, viewerId: row.seller_id, balanceDelta: row.price - fee, idempotencyKey: `mercado:${row.id}:venta`,
          reason: `Mercado: venta de ${name}`, sourceType: "gacha-market", sourceId: row.id,
        })
        platform.profiles.grantCard(channelId, buyerId, row.card_id, 1, `mercado:${row.id}:entrega`, { sleeve: row.sleeve, rank: row.rank })
        platform.activity.record(channelId, buyerId, "market", 1)
        platform.activity.record(channelId, row.seller_id, "market", 1)
        return { ok: true, name, price: row.price, fee }
      })()
    } catch (error) {
      if (error instanceof MarketError) return { ok: false, reason: error.reason }
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
  }

  const LISTING_COLUMNS = `l.id, l.price, l.fee, l.status, l.sleeve, l.rank, l.created_at, l.closed_at, l.seller_id, l.buyer_id,
    c.id AS card_id, c.name, c.rarity, c.image_path, c.description,
    s.display AS seller_display, s.username AS seller_username, b.display AS buyer_display, b.username AS buyer_username`
  const LISTING_JOINS = `FROM gacha_listings l JOIN cards_local c ON c.id=l.card_id
    JOIN viewer_identities s ON s.id=l.seller_id LEFT JOIN viewer_identities b ON b.id=l.buyer_id`

  function openListings() {
    return db.prepare(`SELECT ${LISTING_COLUMNS} ${LISTING_JOINS} WHERE l.channel_id=? AND l.status='open' ORDER BY l.created_at DESC LIMIT 200`).all(activeChannel())
  }

  function recentSales() {
    return db.prepare(`SELECT ${LISTING_COLUMNS} ${LISTING_JOINS} WHERE l.channel_id=? AND l.status='sold' ORDER BY l.closed_at DESC LIMIT ?`).all(activeChannel(), RECENT_SALES)
  }

  return { getConfig, setConfig, feeFor, list, cancel, buy, openListings, recentSales }
}

module.exports = { createGachaMarket, DEFAULT_FEE_PERCENT, MAX_OPEN_PER_SELLER, MAX_PRICE }
