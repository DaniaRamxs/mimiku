// services/canje-data.js — lo que ve y puede hacer un viewer en la pagina de
// canje, leido directamente de la base de datos local (no hay copias).
//
// El viewer se identifica por su id de Twitch (ya validado por canje-server).
const { createBoxService } = require("./boxes.js")
const { createCardSleeves } = require("./card-sleeves.js")

const RARITIES = ["comun", "raro", "epico", "legendario"]
const RARITY_ALIASES = { common: "comun", rare: "raro", epic: "epico", legendary: "legendario" }
const MAX_ITEMS = 500
const RECENT_USES = 8
const MAX_REDEEMS_PER_MINUTE = 5
const MAX_PURCHASES_PER_MINUTE = 5
const MAX_OPENS_PER_MINUTE = 10
const OPEN_RESULTS_KEPT = 500
const MAX_BULK = 100 // cofres por compra o apertura ("Todos" tambien se corta aqui)

// Cantidad pedida desde la pagina: entero de 1 a MAX_BULK, o 0 si no es valida.
function bulkCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_BULK ? value : 0
}

function normalizeRarity(value) {
  const raw = String(value || "").trim().toLowerCase()
  const rarity = RARITY_ALIASES[raw] || raw
  return RARITIES.includes(rarity) ? rarity : "comun"
}

// Las imagenes guardadas en Mimiku (http://127.0.0.1:7777/assets/x.png) se
// sirven por el propio servidor de canje en "assets/x.png". Las https externas
// pasan tal cual; cualquier otra cosa no se muestra.
function publicImage(value) {
  const url = String(value || "").trim()
  let parsed
  try { parsed = new URL(url) } catch { return null }
  if (parsed.pathname.startsWith("/assets/") && ["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    const fileName = decodeURIComponent(parsed.pathname.slice("/assets/".length))
    return /^[a-f0-9]{64}\.(png|jpe?g|gif|webp)$/i.test(fileName) ? `assets/${fileName}` : null
  }
  return parsed.protocol === "https:" ? url : null
}

// Probabilidades de la caja en porcentaje, solo las rarezas con peso.
function oddsPercent(oddsJson) {
  let parsed
  try { parsed = JSON.parse(oddsJson || "{}") } catch { return [] }
  const entries = RARITIES
    .map(rarity => [rarity, Number(parsed?.[rarity])])
    .filter(([, weight]) => Number.isFinite(weight) && weight > 0)
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  return entries.map(([rarity, weight]) => ({ rarity, percent: Math.round((weight / total) * 1000) / 10 }))
}

// Solo se venden en la pagina las cajas con precio en puntos mayor que 0.
function boxPrice(box) {
  const price = Number(box?.price_points)
  return Number.isSafeInteger(price) && price > 0 ? price : 0
}

function createCanjeData({ platform, getChannel, now = Date.now, random = Math.random }) {
  const db = platform.db
  const boxes = createBoxService({ platform, getChannel, random })
  const recentRedeems = new Map() // twitchId -> [timestamps]
  const recentPurchases = new Map()
  const recentOpens = new Map()
  const openResults = new Map() // clave del navegador -> resultado (un reintento no abre otro cofre)

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function recentUses(channelId, viewerId) {
    return db.prepare(`SELECT u.id, u.status, u.used_at, m.name FROM mimic_uses_local u
      LEFT JOIN mimics_local m ON m.id=u.mimic_id
      WHERE u.channel_id=? AND u.viewer_id=? ORDER BY u.used_at DESC, u.rowid DESC LIMIT ?`).all(channelId, viewerId, RECENT_USES)
      .map(row => ({ id: row.id, name: row.name || "Mimic", status: row.status, at: row.used_at }))
  }

  // null si Mimiku todavia no conoce a este viewer (nunca escribio en el chat).
  function viewerState(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return null
    const channelId = activeChannel()
    const wallet = db.prepare("SELECT balance, bank_balance FROM wallets WHERE channel_id=? AND viewer_id=?").get(channelId, viewer.id)
    const mimics = db.prepare(`SELECT vm.mimic_id, vm.quantity, m.name, m.icon, m.rarity, m.description
      FROM viewer_mimics_local vm JOIN mimics_local m ON m.id=vm.mimic_id
      WHERE vm.channel_id=? AND vm.viewer_id=? AND vm.quantity>0 ORDER BY m.name LIMIT ?`).all(channelId, viewer.id, MAX_ITEMS)
    const chests = db.prepare(`SELECT vb.box_id, vb.quantity, b.name, b.icon FROM viewer_boxes_local vb JOIN mimic_boxes_local b ON b.id=vb.box_id
      WHERE vb.channel_id=? AND vb.viewer_id=? AND vb.quantity>0 ORDER BY b.name LIMIT ?`).all(channelId, viewer.id, MAX_ITEMS)
    const gacha = db.prepare(`SELECT vc.quantity, c.id, c.name, c.rarity, c.image_path, c.description
      FROM viewer_cards_local vc JOIN cards_local c ON c.id=vc.card_id
      WHERE vc.channel_id=? AND vc.viewer_id=? AND vc.quantity>0 ORDER BY c.name LIMIT ?`).all(channelId, viewer.id, MAX_ITEMS)
    return {
      display: viewer.display || viewer.username,
      points: wallet?.balance || 0,
      bank: wallet?.bank_balance || 0,
      chests: chests.map(row => ({ id: row.box_id, name: row.name, icon: row.icon, quantity: row.quantity })),
      mimics: mimics.map(row => ({ id: row.mimic_id, name: row.name, icon: row.icon, rarity: normalizeRarity(row.rarity), description: row.description || "", quantity: row.quantity })),
      ...gachaCollection(channelId, gacha, platform.profiles.getCardVariants(channelId, viewer.id)),
      sleeveTokens: createCardSleeves({ platform, getChannel: () => channelId }).tokens(viewer.id),
      uses: recentUses(channelId, viewer.id),
      shop: shop(channelId),
    }
  }

  // Cartas numeradas por orden de creacion (#1 = el primer personaje del canal)
  // y progreso de la coleccion: personajes distintos que tiene / que existen.
  // `gachaMissing`: los personajes del canal que aun no tiene (la pagina los ensena con candado).
  // `variants`: copias con rango subido y/o funda ({card_id, rank, sleeve, quantity}).
  // Cada combinacion sale como su propia carta en `gacha` (con `key` unica):
  // las copias normales por un lado y, por ejemplo, "Krillin epico con funda
  // prisma" por otro. `rarity` es la que se ve (el rango subido o la de base).
  function gachaCollection(channelId, owned, variants = []) {
    const all = db.prepare("SELECT id, name, rarity, image_path, exclusive FROM cards_local WHERE channel_id=? ORDER BY created_at, rowid").all(channelId)
    const ownedIds = new Set(owned.map(row => row.id))
    const numberOf = new Map(all.map((card, index) => [card.id, index + 1]))
    const byRarity = Object.fromEntries(["comun", "raro", "epico", "legendario"].map(rarity => [rarity, { owned: 0, total: 0 }]))
    for (const card of all) byRarity[normalizeRarity(card.rarity)].total += 1
    for (const card of owned) byRarity[normalizeRarity(card.rarity)].owned += 1
    return {
      gacha: owned.flatMap(row => {
        const base = normalizeRarity(row.rarity)
        const card = {
          id: row.id, name: row.name, baseRarity: base, description: row.description || "",
          image: publicImage(row.image_path), number: numberOf.get(row.id) || 0,
        }
        const own = variants.filter(item => item.card_id === row.id)
        const plain = row.quantity - own.reduce((sum, item) => sum + item.quantity, 0)
        return [
          ...(plain > 0 ? [{ ...card, key: row.id, rarity: base, rank: null, sleeve: null, quantity: plain }] : []),
          ...own.map(item => ({
            ...card, key: `${row.id}|${item.rank}|${item.sleeve}`, rarity: item.rank || base,
            rank: item.rank || null, sleeve: item.sleeve || null, quantity: item.quantity,
          })),
        ]
      }),
      gachaStats: { owned: owned.length, total: all.length, byRarity },
      gachaMissing: all.filter(card => !ownedIds.has(card.id)).map(card => ({
        id: card.id, name: card.name, rarity: normalizeRarity(card.rarity), image: publicImage(card.image_path), number: numberOf.get(card.id),
        ...(card.exclusive ? { exclusive: card.exclusive } : {}),
      })),
    }
  }

  function shop(channelId) {
    return platform.mimics.listBoxes(channelId)
      .filter(box => boxPrice(box) > 0)
      .map(box => ({
        id: box.id, name: box.name, icon: box.icon, description: box.description || "",
        price: boxPrice(box), mimicCount: Number(box.mimic_count) || 1, odds: oddsPercent(box.odds_json),
      }))
      .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
  }

  function underRateLimit(recentByViewer, limit, twitchId) {
    const windowStart = now() - 60_000
    const recent = (recentByViewer.get(twitchId) || []).filter(time => time > windowStart)
    if (recent.length >= limit) { recentByViewer.set(twitchId, recent); return false }
    recentByViewer.set(twitchId, [...recent, now()])
    return true
  }

  // `requestKey`: clave del navegador para que un doble clic o un reintento no
  // gaste dos veces. Devuelve { ok, reason?, name? }.
  function redeem(twitchId, mimicId, requestKey) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const mimic = platform.mimics.get(String(mimicId))
    if (!mimic) return { ok: false, reason: "unavailable" }
    if (!underRateLimit(recentRedeems, MAX_REDEEMS_PER_MINUTE, String(twitchId))) return { ok: false, reason: "rate-limit" }
    try {
      platform.mimics.use(activeChannel(), viewer.id, mimic.id, `canje:${twitchId}:${requestKey}`)
      return { ok: true, name: mimic.name }
    } catch (error) {
      if (/no disponible/i.test(error.message)) return { ok: false, reason: "unavailable" }
      throw error
    }
  }

  // Compra `quantity` cofres con puntos: el cobro y la entrega de los cofres sin
  // abrir van en una sola transaccion, con la misma clave idempotente (un
  // reintento no cobra dos veces). Se abren despues con el boton "Abrir" o
  // !abrircofre, como los de la ruleta.
  function buyBox(twitchId, boxId, requestKey, quantity = 1) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const count = bulkCount(quantity)
    if (!count) return { ok: false, reason: "bad-quantity" }
    const channelId = activeChannel()
    const box = platform.mimics.listBoxes(channelId).find(row => row.id === String(boxId))
    const price = boxPrice(box)
    if (!price) return { ok: false, reason: "not-for-sale" }
    if (!underRateLimit(recentPurchases, MAX_PURCHASES_PER_MINUTE, String(twitchId))) return { ok: false, reason: "rate-limit" }
    const key = `canje-compra:${twitchId}:${requestKey}`
    const total = price * count
    try {
      db.transaction(() => {
        platform.economy.applyMovement({
          channelId, viewerId: viewer.id, balanceDelta: -total, idempotencyKey: key,
          reason: count === 1 ? `Compra de cofre: ${box.name}` : `Compra de ${count} cofres: ${box.name}`,
          sourceType: "canje-box", sourceId: box.id,
        })
        platform.mimics.grantBoxes(channelId, viewer.id, box.id, count, key, "canje")
      })()
      return { ok: true, name: box.name, price: total, quantity: count }
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
  }

  // Abre hasta `quantity` cofres del tipo `boxId` (menos si no tiene tantos) y
  // devuelve los Mimics que salieron.
  function openBox(twitchId, boxId, requestKey, quantity = 1) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const count = bulkCount(quantity)
    if (!count) return { ok: false, reason: "bad-quantity" }
    const key = `${twitchId}:${requestKey}`
    if (openResults.has(key)) return openResults.get(key)
    if (!underRateLimit(recentOpens, MAX_OPENS_PER_MINUTE, String(twitchId))) return { ok: false, reason: "rate-limit" }
    const opened = boxes.openForViewer(viewer.id, count, String(boxId), MAX_BULK)
    const result = opened.ok
      ? {
        ok: true,
        name: opened.boxNames[0] || "Cofre",
        opened: opened.opened,
        rewards: opened.rewards.map(reward => ({ name: reward.name, icon: reward.icon || "", rarity: normalizeRarity(reward.rarity), quantity: reward.quantity })),
      }
      : { ok: false, reason: opened.reason === "no-mimics" ? "no-mimics" : "no-chest" }
    if (openResults.size >= OPEN_RESULTS_KEPT) openResults.delete(openResults.keys().next().value)
    openResults.set(key, result)
    return result
  }

  return { viewerState, redeem, buyBox, openBox }
}

module.exports = { createCanjeData, publicImage, normalizeRarity, oddsPercent, bulkCount, MAX_BULK, MAX_REDEEMS_PER_MINUTE, MAX_PURCHASES_PER_MINUTE, MAX_OPENS_PER_MINUTE }
