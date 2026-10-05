// services/gachapon.js — !gachapon: el viewer paga puntos y le sale una
// capsula con un personaje al azar segun su rareza.
//
// Hay un solo gacha por canal: todos los personajes van a la misma bolsa y
// el precio por tirada se configura en el panel. Por dentro los personajes
// siguen en la tabla `cards_local` (la antigua seccion "Cartas").
//
// El cobro y la entrega van en una sola transaccion: si algo falla no se
// cobra, y si no alcanza el saldo no se entrega nada.
//
// !robarpj: durante STEAL_WINDOW_MS despues de cada tirada, el primero que lo
// escriba se lleva ese personaje (se le quita a quien lo saco). Quien puede
// usarlo (VIP, mod, sub) lo decide command-config, no este archivo.
//
// !regalarpj @usuario <personaje>: pasa una copia de un personaje propio a
// otro viewer de la misma plataforma. No se puede regalar un personaje
// mientras su ventana de robo sigue abierta (seria una forma de esquivarlo).
//
// Garantia: tras PITY_LIMIT - 1 tiradas seguidas sin legendario, la siguiente
// lo es (si el gacha tiene alguno). Cuenta igual desde el chat y desde la web.
//
// Tiradas de la web (`stealOnlyLegendary`): solo los legendarios abren la
// ventana de !robarpj; las del chat se pueden robar sea cual sea la rareza.
//
// En vivo (`feed`): cada tirada se apunta en el tablon de la pagina de canje;
// un x10 se apunta una sola vez con su mejor carta.
//
// Robos solo desde la web (`openWebDrop`): otros juegos (los personajes
// legendarios de Plinko) abren aqui su ventana de robo; !robarpj no los ve,
// solo el boton "Robar" del aviso en vivo, que apunta a esa tirada concreta.
const { randomUUID } = require("node:crypto")
const { createEffectsShop } = require("./effects-shop.js")

const RARITIES = ["comun", "raro", "epico", "legendario"]
// El panel guardaba las rarezas en espanol y el sorteo viejo las buscaba en
// ingles; se aceptan las dos formas.
const RARITY_ALIASES = { common: "comun", rare: "raro", epic: "epico", legendary: "legendario" }
const RARITY_LABELS = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario" }
const RARITY_ODDS = { comun: 60, raro: 25, epico: 12, legendario: 3 }
const CONFIG_KEY = "gachapon"
const DEFAULT_PRICE = 100
const MAX_PRICE = 1_000_000_000
const STEAL_WINDOW_MS = 15_000
const MAX_OPEN_DROPS = 20
const LOGIN_PATTERN = /^[a-z0-9_.-]{1,60}$/
const LIST_MAX = 5
// Efecto de la tienda que protege contra !robarpj (ver effects-shop.js).
const STEAL_SHIELD = "anti-robo"
const PITY_LIMIT = 50
const MAX_MULTI_PULL = 10

// Minusculas y sin tildes, para que "dragon" encuentre "Dragón".
function foldName(value) {
  return String(value || "").normalize("NFD").replace(/[\u{300}-\u{36f}]/gu, "").trim().toLowerCase().replace(/\s+/g, " ")
}

// Nombre exacto primero; si no, el unico que empiece por lo escrito, y si no, el unico que lo contenga.
function matchCard(cards, query) {
  const wanted = foldName(query)
  if (!wanted) return { cards: [] }
  const exact = cards.filter(card => foldName(card.name) === wanted)
  if (exact.length) return { card: exact[0] }
  for (const test of [name => name.startsWith(wanted), name => name.includes(wanted)]) {
    const found = cards.filter(card => test(foldName(card.name)))
    if (found.length === 1) return { card: found[0] }
    if (found.length > 1) return { cards: found }
  }
  return { cards: [] }
}

function normalizeRarity(value) {
  const raw = String(value || "").trim().toLowerCase()
  const rarity = RARITY_ALIASES[raw] || raw
  return RARITIES.includes(rarity) ? rarity : "comun"
}

function normalizePrice(value) {
  const price = Math.trunc(Number(value))
  return Number.isSafeInteger(price) && price >= 0 && price <= MAX_PRICE ? price : DEFAULT_PRICE
}

function groupByRarity(prizes) {
  const byRarity = new Map()
  for (const prize of prizes) {
    const rarity = normalizeRarity(prize.rarity)
    byRarity.set(rarity, [...(byRarity.get(rarity) || []), prize])
  }
  return byRarity
}

// Probabilidad real de cada rareza: solo cuentan las que tienen personajes.
function oddsFor(prizes) {
  const byRarity = groupByRarity(prizes)
  const total = RARITIES.filter(rarity => byRarity.has(rarity)).reduce((sum, rarity) => sum + RARITY_ODDS[rarity], 0)
  return RARITIES.map(rarity => ({
    rarity, label: RARITY_LABELS[rarity], count: (byRarity.get(rarity) || []).length,
    percent: byRarity.has(rarity) ? Math.round(RARITY_ODDS[rarity] / total * 1000) / 10 : 0,
  }))
}

// Elige la rareza por peso usando SOLO las que tienen algun personaje, para
// que un gacha sin legendarios no "pierda" tiradas. `forced`: rareza fija
// (la garantia), si hay personajes de ella.
function rollPrize(prizes, random = Math.random, forced = null) {
  if (!prizes.length) return null
  const byRarity = groupByRarity(prizes)
  if (forced && byRarity.has(forced)) {
    const pool = byRarity.get(forced)
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
  }
  const candidates = RARITIES.filter(rarity => byRarity.has(rarity))
  const total = candidates.reduce((sum, rarity) => sum + RARITY_ODDS[rarity], 0)
  let cursor = random() * total
  let chosen = candidates[candidates.length - 1]
  for (const rarity of candidates) {
    cursor -= RARITY_ODDS[rarity]
    if (cursor < 0) { chosen = rarity; break }
  }
  const pool = byRarity.get(chosen)
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
}

function safeImage(value) {
  const url = String(value || "").trim()
  return /^https?:\/\//i.test(url) ? url.slice(0, 1000) : null
}

function publicPrize(prize) {
  const rarity = normalizeRarity(prize.rarity)
  return { id: prize.id, name: prize.name, description: prize.description || "", rarity, rarityLabel: RARITY_LABELS[rarity], image: safeImage(prize.image_path) }
}

// `getAvatar(login)` -> Promise<url|null> (solo Twitch); `broadcast(payload)` -> overlay.
function createGachaponService({ platform, getChannel, getAvatar = async () => null, broadcast = () => {}, feed = null, random = Math.random, now = Date.now, log = console }) {
  // Tiradas que todavia se pueden robar (en memoria: un reinicio las cierra).
  let drops = []
  const effects = createEffectsShop({ platform, getChannel, now })
  const shielded = (viewerId, channelId) => effects.isActive(viewerId, STEAL_SHIELD, channelId)
  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function findViewer(identity) {
    return platform.identities.resolve({
      platform: identity.platform,
      platformUserId: identity.platformUserId,
      username: identity.username,
      display: identity.displayName,
      avatarUrl: identity.avatarUrl,
    })
  }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    return { price: saved.price === undefined ? DEFAULT_PRICE : normalizePrice(saved.price) }
  }

  function setConfig(input = {}) {
    const price = Number(input.price)
    if (!Number.isSafeInteger(price) || price < 0 || price > MAX_PRICE) throw new Error("Precio inválido")
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, { price })
    return getConfig()
  }

  function pityCount(channelId, viewerId) {
    const row = platform.db.prepare("SELECT pulls FROM gacha_pity WHERE channel_id=? AND viewer_id=?").get(channelId, viewerId)
    return row ? row.pulls : 0
  }

  function savePity(channelId, viewerId, pulls) {
    platform.db.prepare(`INSERT INTO gacha_pity(channel_id, viewer_id, pulls, updated_at) VALUES(?,?,?,?)
      ON CONFLICT(channel_id, viewer_id) DO UPDATE SET pulls=excluded.pulls, updated_at=excluded.updated_at`)
      .run(channelId, viewerId, pulls, new Date(now()).toISOString())
  }

  // Lo que la web ensena de la garantia: cuantas lleva y cuantas faltan.
  function pityView(channelId, viewerId) {
    const count = Math.min(pityCount(channelId, viewerId), PITY_LIMIT - 1)
    return { count, limit: PITY_LIMIT, left: PITY_LIMIT - count }
  }

  function freePullsOf(channelId, viewerId) {
    return (platform.tickets.get(channelId, viewerId) || {}).gachapon || 0
  }

  // Precio, probabilidades, garantia y tiradas gratis de un viewer (web).
  function machine(identity) {
    const channelId = activeChannel()
    const viewer = findViewer(identity)
    return {
      price: getConfig().price, odds: oddsFor(platform.profiles.droppableCards(channelId)),
      pity: pityView(channelId, viewer.id), freePulls: freePullsOf(channelId, viewer.id), maxPulls: MAX_MULTI_PULL,
    }
  }

  const RARITY_RANK = { comun: 0, raro: 1, epico: 2, legendario: 3 }

  // `steal`: { until, shielded } para que la web ensene "Robar" o "Tiene inmunidad".
  function reportPull(channelId, viewerId, identity, prize, count, steal = {}) {
    if (!feed) return null
    try {
      const rarity = normalizeRarity(prize.rarity)
      return feed.record(channelId, {
        game: "gacha", viewerId, who: displayOf(identity), label: prize.name, rarity, count,
        outcome: RARITY_RANK[rarity] >= 2 ? "win" : "even", big: rarity === "legendario",
        stealUntil: steal.until || 0, shielded: !!steal.shielded,
      })
    } catch (error) { return null /* el tablon en vivo nunca debe romper una tirada */ }
  }

  function reportSteal(channelId, thiefId, thiefName, target) {
    if (!feed || !target.feedId) return
    try {
      feed.record(channelId, {
        game: "gacha", kind: "steal", ref: target.feedId, viewerId: thiefId, who: thiefName, owner: target.ownerName, ownerId: target.ownerId,
        label: target.prize.name, rarity: target.prize.rarity, outcome: "win", big: true,
      })
    } catch (error) { /* idem */ }
  }

  // `key`: clave idempotente (id del mensaje) para no cobrar dos veces el mismo comando.
  // `stealOnlyLegendary`: si no sale legendario, la tirada no se puede robar.
  // `quiet`: no apuntar en vivo (pullMany apunta el resumen).
  function pull(identity, key = `gachapon:${randomUUID()}`, { stealOnlyLegendary = false, quiet = false } = {}) {
    const channelId = activeChannel()
    const prizes = platform.profiles.droppableCards(channelId)
    if (!prizes.length) return { ok: false, reason: "no-prizes" }
    const { price } = getConfig()
    const viewer = findViewer(identity)
    const since = pityCount(channelId, viewer.id)
    const guaranteed = since + 1 >= PITY_LIMIT && prizes.some(prize => normalizeRarity(prize.rarity) === "legendario")
    const prize = rollPrize(prizes, random, guaranteed ? "legendario" : null)
    const isLegendary = normalizeRarity(prize.rarity) === "legendario"
    // Una tirada gratis (Pase Sub) se gasta antes que los puntos.
    let free = false
    try {
      platform.db.transaction(() => {
        free = platform.tickets.use(channelId, viewer.id, "gachapon")
        if (price > 0 && !free) {
          platform.economy.applyMovement({
            channelId, viewerId: viewer.id, balanceDelta: -price, reason: "gachapon",
            idempotencyKey: `ledger:${key}`, sourceType: "gachapon", sourceId: prize.id,
          })
        }
        platform.profiles.grantCard(channelId, viewer.id, prize.id, 1, key)
        savePity(channelId, viewer.id, isLegendary ? 0 : Math.min(since + 1, PITY_LIMIT))
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) {
        return { ok: false, reason: "funds", price, balance: platform.economy.getBalance(channelId, viewer.id).balance }
      }
      throw error
    }
    platform.activity.record(channelId, viewer.id, "gachapon", 1)
    // Legendarios conseguidos (Comunidad > Destacados de la semana).
    if (isLegendary) platform.activity.record(channelId, viewer.id, "legendary", 1)
    const dropId = randomUUID()
    // Con inmunidad a robos la tirada no se abre para !robarpj.
    const paid = free ? 0 : price
    const pity = { ...pityView(channelId, viewer.id), guaranteed }
    if (shielded(viewer.id, channelId)) {
      if (!quiet) reportPull(channelId, viewer.id, identity, prize, 1, { shielded: true })
      return { ok: true, price: paid, free, prize: publicPrize(prize), pity, dropId, stealUntil: 0, stealSeconds: 0, shielded: true }
    }
    if (stealOnlyLegendary && !isLegendary) {
      if (!quiet) reportPull(channelId, viewer.id, identity, prize, 1)
      return { ok: true, price: paid, free, prize: publicPrize(prize), pity, dropId, stealUntil: 0, stealSeconds: 0 }
    }
    const stealUntil = now() + STEAL_WINDOW_MS
    const drop = { dropId, channelId, ownerId: viewer.id, ownerName: displayOf(identity), cardId: prize.id, prize: publicPrize(prize), stealUntil, feedId: null }
    drops = [...openDrops(), drop].slice(-MAX_OPEN_DROPS)
    if (!quiet) {
      const event = reportPull(channelId, viewer.id, identity, prize, 1, { until: stealUntil })
      if (event) drop.feedId = event.id
    }
    return { ok: true, price: paid, free, prize: publicPrize(prize), pity, dropId, stealUntil, stealSeconds: STEAL_WINDOW_MS / 1000 }
  }

  // Varias tiradas seguidas (x10 de la web). Antes de empezar comprueba que
  // alcanzan los puntos (contando las tiradas gratis) para no dejar un x10 a
  // medias; cada tirada es la misma `pull` con su propia clave.
  function pullMany(identity, count, keyBase = `gachapon:${randomUUID()}`, options = {}) {
    const total = Math.trunc(Number(count))
    if (!Number.isSafeInteger(total) || total < 1 || total > MAX_MULTI_PULL) return { ok: false, reason: "bad-count" }
    const channelId = activeChannel()
    if (!platform.profiles.droppableCards(channelId).length) return { ok: false, reason: "no-prizes" }
    const viewer = findViewer(identity)
    const { price } = getConfig()
    const cost = price * (total - Math.min(total, freePullsOf(channelId, viewer.id)))
    const balance = platform.economy.getBalance(channelId, viewer.id).balance
    if (cost > balance) return { ok: false, reason: "funds", price: cost, balance }
    const results = []
    for (let index = 0; index < total; index++) {
      const result = pull(identity, `${keyBase}:${index}`, { ...options, quiet: true })
      if (!result.ok) break
      results.push(result)
    }
    if (!results.length) return { ok: false, reason: "funds", price: cost, balance }
    const best = results.reduce((top, item) => (RARITY_RANK[item.prize.rarity] > RARITY_RANK[top.prize.rarity] ? item : top))
    const event = reportPull(channelId, viewer.id, identity, best.prize, results.length, { until: best.stealUntil, shielded: best.shielded })
    const bestDrop = drops.find(drop => drop.dropId === best.dropId)
    if (event && bestDrop) bestDrop.feedId = event.id
    return { ok: true, results, pity: results[results.length - 1].pity, spent: results.reduce((sum, item) => sum + item.price, 0) }
  }

  function displayOf(identity) {
    return String(identity.displayName || identity.username || "?").slice(0, 30)
  }

  function openDrops() {
    const time = now()
    return drops.filter(drop => drop.stealUntil > time)
  }

  // Abre la ventana de robo de un personaje ganado fuera del gachapon. Con
  // inmunidad no se abre. Devuelve `link(feedId)` para enlazarla con su aviso.
  function openWebDrop({ ownerId, ownerName, card }) {
    const channelId = activeChannel()
    if (shielded(ownerId, channelId)) return { shielded: true, stealUntil: 0, link: () => {} }
    const drop = {
      dropId: randomUUID(), channelId, ownerId, ownerName: String(ownerName || "?").slice(0, 30), cardId: card.id,
      prize: publicPrize(card), stealUntil: now() + STEAL_WINDOW_MS, feedId: null, webOnly: true,
    }
    drops = [...openDrops(), drop].slice(-MAX_OPEN_DROPS)
    return { shielded: false, stealUntil: drop.stealUntil, link: feedId => { drop.feedId = feedId } }
  }

  // Roba la tirada abierta mas reciente que no sea del propio ladron, o la
  // del evento en vivo `feedId` (boton "Robar" de la pagina de canje).
  function steal(identity, { feedId = null } = {}) {
    const channelId = activeChannel()
    const thief = findViewer(identity)
    const open = openDrops().filter(drop => drop.channelId === channelId && (feedId || !drop.webOnly))
    drops = openDrops()
    let target
    if (feedId) {
      target = open.find(drop => drop.feedId === feedId)
      if (!target) return { ok: false, reason: "gone" }
      if (target.ownerId === thief.id) return { ok: false, reason: "own" }
      if (shielded(target.ownerId, channelId)) return { ok: false, reason: "shielded", owner: target.ownerName }
    } else {
      const others = open.filter(drop => drop.ownerId !== thief.id)
      // Quien compro la inmunidad despues de su tirada tambien queda protegido.
      target = [...others].reverse().find(drop => !shielded(drop.ownerId, channelId))
      if (!target) {
        if (others.length) return { ok: false, reason: "shielded", owner: others[others.length - 1].ownerName }
        return { ok: false, reason: open.length ? "own" : "none" }
      }
    }
    // Se cierra antes de mover nada: dos !robarpj seguidos no roban dos veces.
    drops = drops.filter(drop => drop !== target)
    let moved = false
    platform.db.transaction(() => {
      moved = platform.profiles.takeCard(channelId, target.ownerId, target.cardId)
      if (moved) platform.profiles.grantCard(channelId, thief.id, target.cardId, 1, `robarpj:${randomUUID()}`)
    })()
    if (!moved) return { ok: false, reason: "gone" }
    const result = { ok: true, thief: displayOf(identity), owner: target.ownerName, prize: target.prize }
    reportSteal(channelId, thief.id, result.thief, target)
    // La foto del ladron llega despues; el robo ya quedo hecho y se responde sin esperarla.
    Promise.resolve(avatarOf(identity)).then(avatar => broadcast({
      type: "gachapon_stolen", dropId: target.dropId, thief: result.thief, thiefAvatar: safeImage(avatar), owner: result.owner, prize: result.prize,
    })).catch(error => log.error("[gachapon] robo overlay:", error.message))
    return result
  }

  function gift(identity, targetText, prizeText) {
    const channelId = activeChannel()
    const login = String(targetText || "").trim().replace(/^@/, "").toLowerCase()
    if (!LOGIN_PATTERN.test(login)) return { ok: false, reason: "usage" }
    const giver = findViewer(identity)
    const owned = platform.profiles.getCards(channelId, giver.id).filter(card => card.quantity > 0)
    const names = cards => cards.slice(0, LIST_MAX).map(card => card.name)
    if (!owned.length) return { ok: false, reason: "empty" }
    if (!foldName(prizeText)) return { ok: false, reason: "usage", owned: names(owned) }
    const receiver = platform.identities.byUsername(login, identity.platform)
    if (!receiver) return { ok: false, reason: "unknown", target: login }
    if (receiver.id === giver.id) return { ok: false, reason: "self" }

    const match = matchCard(owned, prizeText)
    if (!match.card) return { ok: false, reason: match.cards.length ? "ambiguous" : "not-owned", owned: names(match.cards.length ? match.cards : owned) }
    const open = openDrops().find(drop => drop.channelId === channelId && drop.ownerId === giver.id && drop.cardId === match.card.card_id)
    if (open) return { ok: false, reason: "stealable", seconds: Math.ceil((open.stealUntil - now()) / 1000) }

    let moved = false
    platform.db.transaction(() => {
      moved = platform.profiles.takeCard(channelId, giver.id, match.card.card_id)
      if (moved) platform.profiles.grantCard(channelId, receiver.id, match.card.card_id, 1, `regalarpj:${randomUUID()}`)
    })()
    // Las copias con rango subido o funda no se regalan por el chat (se tradean en la pagina).
    if (!moved) return { ok: false, reason: match.card.quantity > 0 ? "special-only" : "not-owned", owned: [] }
    const result = {
      ok: true, from: displayOf(identity), to: String(receiver.display || receiver.username).slice(0, 30), prize: publicPrize(match.card),
    }
    broadcast({ type: "gachapon_gift", from: result.from, to: result.to, prize: result.prize })
    return result
  }

  // Muestra el resultado en el Overlay 3 (la foto de Twitch llega si se puede).
  // Foto de perfil (solo Twitch); null si no hay o falla.
  async function avatarOf(identity) {
    if (identity.platform !== "twitch") return null
    try { return (await getAvatar(String(identity.username || "").toLowerCase())) || null } catch (error) {
      log.error("[gachapon] avatar:", error.message)
      return null
    }
  }

  async function show(identity, result) {
    const avatar = await avatarOf(identity)
    broadcast({
      type: "gachapon_result",
      viewer: String(identity.displayName || identity.username || "?").slice(0, 30),
      avatar: safeImage(avatar),
      prize: result.prize,
      dropId: result.dropId || null,
      stealMs: Math.max(0, (result.stealUntil || 0) - now()),
    })
  }

  // Prueba del panel: un personaje real al azar (si hay), sin cobrar ni entregar nada.
  function demo() {
    const prizes = platform.profiles.listCards(activeChannel())
    const prize = prizes.length
      ? publicPrize(prizes[Math.floor(random() * prizes.length)])
      : { name: "Personaje de prueba", description: "Así se verá tu personaje", rarity: "legendario", rarityLabel: RARITY_LABELS.legendario, image: null }
    broadcast({ type: "gachapon_result", viewer: "ViewerDemo", avatar: null, prize })
    return { ok: true }
  }

  return { getConfig, setConfig, pull, pullMany, machine, steal, openWebDrop, gift, show, demo }
}

let defaultService = null
function getDefaultGachapon() {
  if (!defaultService) {
    defaultService = createGachaponService({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      getAvatar: login => require("./twitch-avatars.js").getDefaultTwitchAvatars().getAvatar(login),
      broadcast: payload => require("./overlay-server.js").broadcast(payload),
      feed: require("./live-feed.js").getDefaultLiveFeed(),
    })
  }
  return defaultService
}

module.exports = { createGachaponService, getDefaultGachapon, rollPrize, oddsFor, normalizeRarity, RARITY_LABELS, RARITY_ODDS, DEFAULT_PRICE, STEAL_WINDOW_MS, PITY_LIMIT, MAX_MULTI_PULL }
