// services/gacha-trades.js — ofertas de tradeo del gachapon entre viewers.
//
// Una oferta dice que da quien la manda (personajes y/o puntos) y que pide a
// cambio. La otra persona la acepta o la rechaza; caduca a las 24 h. Nada se
// retiene al enviarla: al aceptar se comprueba que los dos siguen teniendo
// todo y se mueve en una sola transaccion (si falta algo, no se mueve nada y
// la oferta queda como "fallida").
const { randomUUID } = require("node:crypto")

const TRADE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CARDS_PER_SIDE = 10
const MAX_QTY = 99
const MAX_POINTS = 1_000_000_000
const MAX_PENDING_OUT = 10
const HISTORY_SIZE = 10
const SLEEVE_PATTERN = /^[a-z]{1,20}$/

class TradeError extends Error {
  constructor(reason) { super(reason); this.reason = reason }
}

// {cards:[{id,qty,sleeve,rank}], points} validado; null si no es valido. Junta ids
// repetidos (las copias con funda o rango subido cuentan aparte de las normales).
function normalizeSide(input) {
  if (!input || typeof input !== "object") return null
  const points = input.points === undefined ? 0 : Number(input.points)
  if (!Number.isSafeInteger(points) || points < 0 || points > MAX_POINTS) return null
  const rawCards = input.cards === undefined ? [] : input.cards
  if (!Array.isArray(rawCards)) return null
  const byKey = new Map()
  for (const item of rawCards) {
    const id = item && typeof item.id === "string" ? item.id.slice(0, 120) : ""
    const qty = item && item.qty === undefined ? 1 : Number(item && item.qty)
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null
    if (item.sleeve && !SLEEVE_PATTERN.test(String(item.sleeve))) return null
    if (item.rank && !SLEEVE_PATTERN.test(String(item.rank))) return null
    const sleeve = item.sleeve ? String(item.sleeve) : null
    const rank = item.rank ? String(item.rank) : null
    const key = `${rank || ""}|${sleeve || ""}|${id}`
    const previous = byKey.get(key)
    byKey.set(key, { id, sleeve, rank, qty: Math.min(MAX_QTY, (previous ? previous.qty : 0) + qty) })
  }
  if (byKey.size > MAX_CARDS_PER_SIDE) return null
  return {
    cards: [...byKey.values()].map(card => ({ id: card.id, qty: card.qty, ...(card.sleeve ? { sleeve: card.sleeve } : {}), ...(card.rank ? { rank: card.rank } : {}) })),
    points,
  }
}

function isEmpty(side) { return !side.cards.length && !side.points }

function createGachaTrades({ platform, getChannel, now = Date.now }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso(offsetMs = 0) { return new Date(now() + offsetMs).toISOString() }

  // Copias de esa variante (funda y/o rango) o, sin ninguna, las copias normales.
  function ownedQty(channelId, viewerId, cardId, sleeve, rank) {
    if (!sleeve && !rank) return platform.profiles.plainCopies(channelId, viewerId, cardId)
    const row = db.prepare("SELECT quantity FROM viewer_card_variants WHERE channel_id=? AND viewer_id=? AND card_id=? AND rank=? AND sleeve=?")
      .get(channelId, viewerId, cardId, rank || "", sleeve || "")
    return row ? row.quantity : 0
  }

  function cardsExist(channelId, side) {
    const exists = db.prepare("SELECT 1 FROM cards_local WHERE id=? AND channel_id=?")
    return side.cards.every(card => exists.get(card.id, channelId))
  }

  function hasSide(channelId, viewerId, side) {
    if (!side.cards.every(card => ownedQty(channelId, viewerId, card.id, card.sleeve, card.rank) >= card.qty)) return false
    return !side.points || platform.economy.getBalance(channelId, viewerId).balance >= side.points
  }

  function expireOld() {
    db.prepare("UPDATE gacha_trades SET status='expired', closed_at=? WHERE channel_id=? AND status='pending' AND expires_at<=?")
      .run(iso(), activeChannel(), iso())
  }

  function create(fromId, toId, giveInput, wantInput) {
    const channelId = activeChannel()
    const give = normalizeSide(giveInput)
    const want = normalizeSide(wantInput)
    if (!give || !want) return { ok: false, reason: "bad-offer" }
    if (isEmpty(give) || isEmpty(want)) return { ok: false, reason: "empty-side" }
    if (fromId === toId) return { ok: false, reason: "self" }
    if (!cardsExist(channelId, give) || !cardsExist(channelId, want)) return { ok: false, reason: "bad-offer" }
    if (!hasSide(channelId, fromId, give)) return { ok: false, reason: "you-lack" }
    expireOld()
    const pending = db.prepare("SELECT COUNT(*) AS n FROM gacha_trades WHERE channel_id=? AND from_id=? AND status='pending'").get(channelId, fromId).n
    if (pending >= MAX_PENDING_OUT) return { ok: false, reason: "too-many" }
    const id = randomUUID()
    db.prepare(`INSERT INTO gacha_trades(id, channel_id, from_id, to_id, give_json, want_json, created_at, expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, channelId, fromId, toId, JSON.stringify(give), JSON.stringify(want), iso(), iso(TRADE_TTL_MS))
    return { ok: true, tradeId: id }
  }

  function pendingFor(tradeId) {
    expireOld()
    return db.prepare("SELECT * FROM gacha_trades WHERE id=? AND channel_id=?").get(String(tradeId), activeChannel())
  }

  function close(tradeId, status) {
    db.prepare("UPDATE gacha_trades SET status=?, closed_at=? WHERE id=?").run(status, iso(), tradeId)
  }

  function movePoints(channelId, trade, payerId, payeeId, points, label) {
    if (!points) return
    const base = { channelId, sourceType: "gacha-trade", sourceId: trade.id }
    platform.economy.applyMovement({ ...base, viewerId: payerId, balanceDelta: -points, idempotencyKey: `tradeo:${trade.id}:${label}:paga`, reason: "Tradeo del gachapon" })
    platform.economy.applyMovement({ ...base, viewerId: payeeId, balanceDelta: points, idempotencyKey: `tradeo:${trade.id}:${label}:cobra`, reason: "Tradeo del gachapon" })
  }

  function moveCards(channelId, trade, fromId, toId, cards, missingReason) {
    for (const card of cards) {
      const variant = { sleeve: card.sleeve || null, rank: card.rank || null }
      if (!platform.profiles.takeCard(channelId, fromId, card.id, card.qty, variant)) throw new TradeError(missingReason)
      platform.profiles.grantCard(channelId, toId, card.id, card.qty, `tradeo:${trade.id}`, variant)
    }
  }

  function accept(trade) {
    const channelId = activeChannel()
    const give = JSON.parse(trade.give_json)
    const want = JSON.parse(trade.want_json)
    try {
      db.transaction(() => {
        moveCards(channelId, trade, trade.from_id, trade.to_id, give.cards, "from-lacks")
        moveCards(channelId, trade, trade.to_id, trade.from_id, want.cards, "you-lack")
        try { movePoints(channelId, trade, trade.from_id, trade.to_id, give.points, "da") } catch (error) {
          if (/saldo insuficiente/i.test(error.message)) throw new TradeError("from-lacks")
          throw error
        }
        try { movePoints(channelId, trade, trade.to_id, trade.from_id, want.points, "pide") } catch (error) {
          if (/saldo insuficiente/i.test(error.message)) throw new TradeError("you-lack")
          throw error
        }
        close(trade.id, "accepted")
        platform.activity.record(channelId, trade.from_id, "market", 1)
        platform.activity.record(channelId, trade.to_id, "market", 1)
      })()
      return { ok: true }
    } catch (error) {
      if (!(error instanceof TradeError)) throw error
      // Si al que la mando le falta algo, la oferta ya no sirve. Si le falta a
      // quien la recibe, sigue pendiente (puede conseguirlo y aceptarla luego).
      if (error.reason === "from-lacks") close(trade.id, "failed")
      return { ok: false, reason: error.reason }
    }
  }

  function respond(viewerId, tradeId, doAccept) {
    const trade = pendingFor(tradeId)
    if (!trade || trade.status !== "pending") return { ok: false, reason: "gone" }
    if (trade.to_id !== viewerId) return { ok: false, reason: "not-yours" }
    if (!doAccept) { close(trade.id, "rejected"); return { ok: true } }
    return accept(trade)
  }

  function cancel(viewerId, tradeId) {
    const trade = pendingFor(tradeId)
    if (!trade || trade.status !== "pending") return { ok: false, reason: "gone" }
    if (trade.from_id !== viewerId) return { ok: false, reason: "not-yours" }
    close(trade.id, "cancelled")
    return { ok: true }
  }

  const TRADE_SELECT = `SELECT t.*, f.display AS from_display, f.username AS from_username, d.display AS to_display, d.username AS to_username
    FROM gacha_trades t JOIN viewer_identities f ON f.id=t.from_id JOIN viewer_identities d ON d.id=t.to_id`

  function parse(row) {
    return { ...row, give: JSON.parse(row.give_json), want: JSON.parse(row.want_json) }
  }

  // Ofertas del viewer: recibidas y enviadas pendientes, y las ultimas cerradas.
  function listFor(viewerId) {
    expireOld()
    const channelId = activeChannel()
    const incoming = db.prepare(`${TRADE_SELECT} WHERE t.channel_id=? AND t.to_id=? AND t.status='pending' ORDER BY t.created_at DESC`).all(channelId, viewerId)
    const outgoing = db.prepare(`${TRADE_SELECT} WHERE t.channel_id=? AND t.from_id=? AND t.status='pending' ORDER BY t.created_at DESC`).all(channelId, viewerId)
    const history = db.prepare(`${TRADE_SELECT} WHERE t.channel_id=? AND (t.from_id=? OR t.to_id=?) AND t.status<>'pending'
      ORDER BY t.closed_at DESC LIMIT ?`).all(channelId, viewerId, viewerId, HISTORY_SIZE)
    return { incoming: incoming.map(parse), outgoing: outgoing.map(parse), history: history.map(parse) }
  }

  return { create, respond, cancel, listFor, expireOld }
}

module.exports = { createGachaTrades, normalizeSide, TRADE_TTL_MS, MAX_PENDING_OUT, MAX_CARDS_PER_SIDE }
