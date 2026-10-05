// services/canje-gacha.js — maquina, mercado y tradeos del gachapon en la pagina de canje.
//
// Traduce la sesion de Twitch del viewer a su identidad en Mimiku, limita
// cuantas acciones hace por minuto y devuelve solo datos publicos (nombres a
// mostrar, cartas con su imagen servible). Las reglas estan en
// gacha-market.js y gacha-trades.js; las rutas HTTP, en handleGachaApi.
const { createGachaMarket } = require("./gacha-market.js")
const { createGachaTrades } = require("./gacha-trades.js")
const { createGachaForge, FORGE_COSTS } = require("./gacha-forge.js")
const { createCardRanks } = require("./card-ranks.js")
const { publicImage, normalizeRarity } = require("./canje-data.js")

const MAX_ACTIONS_PER_MINUTE = 20
const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/

const GACHA_ROUTES = {
  "/api/gacha": "GET",
  "/api/gacha/viewer": "GET",
  "/api/gacha/machine": "GET",
  "/api/gacha/pull": "POST",
  "/api/market/list": "POST",
  "/api/market/cancel": "POST",
  "/api/market/buy": "POST",
  "/api/trade/create": "POST",
  "/api/trade/respond": "POST",
  "/api/trade/cancel": "POST",
  "/api/forge": "POST",
  "/api/card/ascend": "POST",
}

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Vas muy rápido, espera un minuto.",
  "bad-price": "Pon un precio de al menos 1 punto.",
  "too-many": "Tienes demasiadas cosas abiertas. Cierra alguna antes.",
  "not-owned": "Ya no tienes ese personaje.",
  gone: "Eso ya no está disponible.",
  "not-yours": "Eso no es tuyo.",
  own: "No puedes comprar tu propia venta.",
  insufficient: "No te alcanzan los puntos.",
  "bad-offer": "La oferta no es válida.",
  "empty-side": "Tienes que dar algo y pedir algo.",
  self: "No puedes tradear contigo.",
  "unknown-target": "No conozco a esa persona: tiene que haber escrito en el chat del canal.",
  "you-lack": "Te falta algo de lo que pide la oferta (personajes o puntos).",
  "offer-lacks": "No tienes todo lo que ofreces (personajes o puntos).",
  "from-lacks": "La otra persona ya no tiene lo que ofrecía. La oferta se canceló.",
  "forge-short": "No tienes suficientes copias de ese personaje para forjar.",
  "ascend-short": "Te faltan copias normales de esa carta para subirla de rango.",
  "max-rank": "Esa carta ya es mítica: es el rango más alto.",
  "max-rarity": "Los legendarios ya son el rango más alto: no se pueden forjar.",
  "no-higher": "Todavía no hay personajes de un rango superior para forjar.",
  "no-prizes": "El gachapon todavía no tiene personajes.",
  funds: "No te alcanzan los puntos para esa tirada.",
  "bad-count": "Elige tirar 1 o 10 veces.",
}

// `gachapon`: el mismo servicio que usa !gachapon en el chat (comparten las
// tiradas abiertas a !robarpj y el aviso al overlay).
function createCanjeGacha({ platform, getChannel, gachapon = null, now = Date.now, random = Math.random }) {
  const db = platform.db
  const market = createGachaMarket({ platform, getChannel, now })
  const trades = createGachaTrades({ platform, getChannel, now })
  const forgery = createGachaForge({ platform, getChannel, random })
  const ranks = createCardRanks({ platform, getChannel })
  const recentActions = new Map()

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function underLimit(twitchId) {
    const since = now() - 60_000
    const recent = (recentActions.get(twitchId) || []).filter(time => time > since)
    if (recent.length >= MAX_ACTIONS_PER_MINUTE) { recentActions.set(twitchId, recent); return false }
    recentActions.set(twitchId, [...recent, now()])
    return true
  }

  function displayOf(display, username) { return String(display || username || "?").slice(0, 40) }

  function publicCard(row) {
    return { id: row.id, name: row.name, rarity: normalizeRarity(row.rarity), image: publicImage(row.image_path), description: row.description || "" }
  }

  function cardIndex() {
    return new Map(platform.profiles.listCards(activeChannel()).map(row => [row.id, publicCard(row)]))
  }

  function publicSide(side, cards) {
    return {
      cards: side.cards.map(item => {
        const card = cards.get(item.id) || { id: item.id, name: "Personaje borrado", rarity: "comun", image: null, description: "" }
        return { ...card, rarity: item.rank || card.rarity, qty: item.qty, sleeve: item.sleeve || null, rank: item.rank || null }
      }),
      points: side.points,
    }
  }

  function publicListing(row, viewerId) {
    return {
      id: row.id, price: row.price, at: row.created_at, mine: row.seller_id === viewerId, sleeve: row.sleeve || null, rank: row.rank || null,
      seller: displayOf(row.seller_display, row.seller_username),
      card: publicCard({ id: row.card_id, name: row.name, rarity: row.rank || row.rarity, image_path: row.image_path, description: row.description }),
    }
  }

  function publicTrade(row, viewerId, cards) {
    const incoming = row.to_id === viewerId
    return {
      id: row.id, status: row.status, incoming, at: row.created_at, expiresAt: row.expires_at, closedAt: row.closed_at,
      with: incoming ? displayOf(row.from_display, row.from_username) : displayOf(row.to_display, row.to_username),
      give: publicSide(row.give, cards), want: publicSide(row.want, cards),
    }
  }

  // Todo lo de la pestana Gachapon: ventas abiertas, tus ventas, ultimas ventas y tus tradeos.
  function state(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return null
    const cards = cardIndex()
    const listings = market.openListings().map(row => publicListing(row, viewer.id))
    const tradeRows = trades.listFor(viewer.id)
    const toTrade = rows => rows.map(row => publicTrade(row, viewer.id, cards))
    return {
      feePercent: market.getConfig().feePercent,
      forgeCosts: FORGE_COSTS,
      ascendCosts: ranks.getConfig(),
      listings: listings.filter(item => !item.mine),
      myListings: listings.filter(item => item.mine),
      sales: market.recentSales().map(row => ({ ...publicListing(row, viewer.id), buyer: displayOf(row.buyer_display, row.buyer_username), at: row.closed_at })),
      trades: { incoming: toTrade(tradeRows.incoming), outgoing: toTrade(tradeRows.outgoing), history: toTrade(tradeRows.history) },
    }
  }

  function identityOf(viewer) {
    return { platform: "twitch", platformUserId: viewer.platform_user_id, username: viewer.username, displayName: viewer.display || viewer.username }
  }

  // Numero de cada personaje en el album (mismo orden que canje-data.js).
  function albumNumbers() {
    const rows = db.prepare("SELECT id FROM cards_local WHERE channel_id=? ORDER BY created_at, rowid").all(activeChannel())
    return { numberOf: new Map(rows.map((row, index) => [row.id, index + 1])), total: rows.length }
  }

  function machine(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer || !gachapon) return { ok: false, reason: viewer ? "no-prizes" : "unknown-viewer" }
    const balance = platform.economy.getBalance(activeChannel(), viewer.id).balance
    return { ok: true, ...gachapon.machine(identityOf(viewer)), points: balance }
  }

  // Tirada desde la web: 1 o 10. Marca como "nuevo" lo que no tenia antes.
  function pull(twitchId, count, key) {
    const viewer = findViewer(twitchId)
    if (!viewer || !gachapon) return { ok: false, reason: viewer ? "no-prizes" : "unknown-viewer" }
    if (!underLimit(twitchId)) return { ok: false, reason: "rate-limit" }
    const owned = new Set(platform.profiles.getCards(activeChannel(), viewer.id).map(row => row.card_id))
    const identity = identityOf(viewer)
    // Desde la web solo se pueden robar los legendarios (decision del streamer).
    const result = gachapon.pullMany(identity, count, `gachapon:web:${twitchId}:${key}`, { stealOnlyLegendary: true })
    if (!result.ok) return result
    const { numberOf, total } = albumNumbers()
    const cards = cardIndex()
    const order = { comun: 0, raro: 1, epico: 2, legendario: 3 }
    const results = result.results.map(item => {
      const isNew = !owned.has(item.prize.id)
      owned.add(item.prize.id)
      const card = cards.get(item.prize.id) || { id: item.prize.id, name: item.prize.name, rarity: item.prize.rarity, image: null, description: "" }
      return { card: { ...card, number: numberOf.get(item.prize.id) || 0 }, isNew, free: item.free, guaranteed: !!item.pity.guaranteed }
    })
    // Al directo solo va la mejor tirada (un x10 no llena el overlay de avisos).
    const best = result.results.reduce((top, item) => (order[item.prize.rarity] > order[top.prize.rarity] ? item : top))
    const stealable = result.results.filter(item => item.stealSeconds > 0)
    Promise.resolve(gachapon.show(identity, best)).catch(() => {})
    return {
      ok: true, results, total, pity: result.pity, spent: result.spent,
      points: platform.economy.getBalance(activeChannel(), viewer.id).balance,
      stealSeconds: stealable.length ? stealable[0].stealSeconds : 0,
    }
  }

  // Coleccion de otro viewer, para elegir que pedirle en un tradeo.
  function collectionOf(login) {
    const name = String(login || "").trim().replace(/^@/, "").toLowerCase()
    if (!LOGIN_PATTERN.test(name)) return { ok: false, reason: "unknown-target" }
    const target = platform.identities.byUsername(name, "twitch")
    if (!target) return { ok: false, reason: "unknown-target" }
    // Las copias con funda o rango subido salen aparte (una entrada por variante), para poder pedirlas.
    const variants = platform.profiles.getCardVariants(activeChannel(), target.id)
    const cards = platform.profiles.getCards(activeChannel(), target.id).flatMap(row => {
      const card = publicCard({ ...row, id: row.card_id })
      const own = variants.filter(item => item.card_id === row.card_id)
      const plain = row.quantity - own.reduce((sum, item) => sum + item.quantity, 0)
      return [
        ...(plain > 0 ? [{ ...card, qty: plain, sleeve: null, rank: null }] : []),
        ...own.map(item => ({ ...card, rarity: item.rank || card.rarity, qty: item.quantity, sleeve: item.sleeve || null, rank: item.rank || null })),
      ]
    })
    return { ok: true, login: target.username, display: displayOf(target.display, target.username), cards }
  }

  // Envuelve una accion: viewer conocido + limite por minuto.
  function act(twitchId, run) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    return run(viewer)
  }

  function createTrade(twitchId, toLogin, give, want) {
    return act(twitchId, viewer => {
      const target = collectionOf(toLogin)
      if (!target.ok) return target
      const targetRow = platform.identities.byUsername(target.login, "twitch")
      const result = trades.create(viewer.id, targetRow.id, give, want)
      return result.reason === "you-lack" ? { ok: false, reason: "offer-lacks" } : result
    })
  }

  // Funde las copias que pida FORGE_COSTS en un personaje de rango superior y lo devuelve listo para mostrar.
  function forge(twitchId, cardId) {
    return act(twitchId, viewer => {
      const result = forgery.forge(viewer.id, cardId)
      return result.ok ? { ok: true, used: result.used, card: publicCard(result.card) } : result
    })
  }

  return {
    state, collectionOf, createTrade, forge, machine, pull,
    list: (twitchId, cardId, price, variant) => act(twitchId, viewer => market.list(viewer.id, cardId, price, variant)),
    ascend: (twitchId, cardId, variant) => act(twitchId, viewer => ranks.ascend(viewer.id, cardId, variant)),
    cancelListing: (twitchId, listingId) => act(twitchId, viewer => market.cancel(viewer.id, listingId)),
    buy: (twitchId, listingId) => act(twitchId, viewer => market.buy(viewer.id, listingId)),
    respondTrade: (twitchId, tradeId, accept) => act(twitchId, viewer => trades.respond(viewer.id, tradeId, accept)),
    cancelTrade: (twitchId, tradeId) => act(twitchId, viewer => trades.cancel(viewer.id, tradeId)),
  }
}

function text(value, max = 120) {
  return typeof value === "string" ? value.slice(0, max) : ""
}

// { sleeve, rank } de una peticion (solo letras minusculas; si no, null).
function variantOf(body) {
  const clean = value => (typeof value === "string" && /^[a-z]{1,20}$/.test(value) ? value : null)
  return { sleeve: clean(body.sleeve), rank: clean(body.rank) }
}

// Atiende una ruta de GACHA_ROUTES ya autenticada. `readJson()` lee el cuerpo.
// Devuelve [status, json].
async function handleGachaApi({ pathname, url, readJson, user, gacha }) {
  const reply = result => result.ok
    ? [200, result]
    : [result.reason === "rate-limit" ? 429 : 409, { error: MESSAGES[result.reason] || "No se pudo hacer." }]
  if (pathname === "/api/gacha") {
    const value = gacha.state(user.twitchId)
    return value ? [200, value] : [409, { error: MESSAGES["unknown-viewer"] }]
  }
  if (pathname === "/api/gacha/viewer") return reply(gacha.collectionOf(url.searchParams.get("login")))
  if (pathname === "/api/gacha/machine") return reply(gacha.machine(user.twitchId))
  const body = await readJson()
  if (pathname === "/api/market/list") return reply(gacha.list(user.twitchId, text(body.cardId), body.price, variantOf(body)))
  if (pathname === "/api/card/ascend") return reply(gacha.ascend(user.twitchId, text(body.cardId), variantOf(body)))
  if (pathname === "/api/market/cancel") return reply(gacha.cancelListing(user.twitchId, text(body.listingId)))
  if (pathname === "/api/market/buy") return reply(gacha.buy(user.twitchId, text(body.listingId)))
  if (pathname === "/api/trade/create") return reply(gacha.createTrade(user.twitchId, text(body.to, 40), body.give, body.want))
  if (pathname === "/api/trade/respond") return reply(gacha.respondTrade(user.twitchId, text(body.tradeId), body.accept === true))
  if (pathname === "/api/trade/cancel") return reply(gacha.cancelTrade(user.twitchId, text(body.tradeId)))
  if (pathname === "/api/forge") return reply(gacha.forge(user.twitchId, text(body.cardId)))
  if (pathname === "/api/gacha/pull") return reply(gacha.pull(user.twitchId, body.count === 10 ? 10 : 1, text(body.key, 64)))
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjeGacha, handleGachaApi, GACHA_ROUTES, MESSAGES, MAX_ACTIONS_PER_MINUTE }
