// services/boxes.js — inventario y apertura de cofres (cajas) de los viewers.
//
// Un cofre sin abrir vive en `viewer_boxes_local` (lo entrega, por ejemplo, la
// ruleta de cofres). Abrirlo consume 1 unidad y reparte `mimic_count` Mimics
// segun las probabilidades por rareza de la caja (`odds_json`), que se
// guardan en el inventario de Mimics del viewer.
//
// La apertura es atomica: el descuento del cofre y la entrega de todos los
// Mimics ocurren en una sola transaccion, asi que un fallo no deja cofres
// gastados sin premio ni premios sin cofre.
const { randomUUID } = require("node:crypto")

// Tope por comando para que un solo mensaje no dispare cientos de tiradas.
const MAX_OPEN_PER_COMMAND = 10
const RARITIES = ["comun", "raro", "epico", "legendario"]

function parseOdds(oddsJson) {
  try {
    const parsed = JSON.parse(oddsJson || "{}")
    const odds = {}
    for (const rarity of RARITIES) {
      const value = Number(parsed?.[rarity])
      if (Number.isFinite(value) && value > 0) odds[rarity] = value
    }
    return odds
  } catch {
    return {}
  }
}

// Elige la rareza por peso, usando SOLO las que tienen algun Mimic: si la caja
// promete "legendario" pero no hay ninguno creado, no se pierde la tirada.
// Si ninguna rareza con peso tiene Mimics, se reparte parejo entre todos.
function rollMimic(mimicsByRarity, allMimics, odds, random) {
  const candidates = Object.entries(odds).filter(([rarity]) => (mimicsByRarity.get(rarity) || []).length)
  if (!candidates.length) return allMimics[Math.floor(random() * allMimics.length)]
  const total = candidates.reduce((sum, [, weight]) => sum + weight, 0)
  let cursor = random() * total
  let chosen = candidates[candidates.length - 1][0]
  for (const [rarity, weight] of candidates) {
    cursor -= weight
    if (cursor < 0) { chosen = rarity; break }
  }
  const pool = mimicsByRarity.get(chosen)
  return pool[Math.floor(random() * pool.length)]
}

function createBoxService({ platform, getChannel, random = Math.random, log = console }) {
  const db = platform.db

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

  function inventory(identity) {
    const viewer = findViewer(identity)
    return platform.mimics.boxInventory(activeChannel(), viewer.id)
  }

  // Todos los cofres sin abrir del canal, para el panel del streamer.
  function listAll() {
    return db.prepare(`SELECT i.display, i.username, i.platform, b.name AS box_name, vb.quantity
      FROM viewer_boxes_local vb
      JOIN viewer_identities i ON i.id=vb.viewer_id
      JOIN mimic_boxes_local b ON b.id=vb.box_id
      WHERE vb.channel_id=? AND vb.quantity>0
      ORDER BY vb.quantity DESC, i.display`).all(activeChannel())
  }

  // Abre hasta `requested` cofres del viewer (en orden de nombre de caja).
  function open(identity, requested = 1) {
    const channelId = activeChannel()
    const viewer = findViewer(identity)
    const owned = platform.mimics.boxInventory(channelId, viewer.id)
    if (!owned.length) return { ok: false, reason: "empty" }

    const allMimics = platform.mimics.list(channelId)
    if (!allMimics.length) return { ok: false, reason: "no-mimics" }
    const mimicsByRarity = new Map()
    for (const mimic of allMimics) {
      const rarity = String(mimic.rarity || "").toLowerCase()
      mimicsByRarity.set(rarity, [...(mimicsByRarity.get(rarity) || []), mimic])
    }

    const totalOwned = owned.reduce((sum, row) => sum + row.quantity, 0)
    const count = Math.max(1, Math.min(Math.trunc(Number(requested)) || 1, totalOwned, MAX_OPEN_PER_COMMAND))
    const openId = randomUUID()
    const rewards = new Map() // mimicId -> { mimic, quantity }
    const boxNames = []

    db.transaction(() => {
      let opened = 0
      for (const row of owned) {
        while (opened < count && row.quantity > 0) {
          const box = db.prepare("SELECT * FROM mimic_boxes_local WHERE id=?").get(row.box_id)
          const spent = db.prepare(`UPDATE viewer_boxes_local SET quantity=quantity-1, updated_at=datetime('now')
            WHERE channel_id=? AND viewer_id=? AND box_id=? AND quantity>0`).run(channelId, viewer.id, row.box_id)
          if (!spent.changes) throw new Error("Cofre no disponible")
          const odds = parseOdds(box?.odds_json)
          const rolls = Math.max(1, Number(box?.mimic_count) || 1)
          for (let roll = 0; roll < rolls; roll++) {
            const mimic = rollMimic(mimicsByRarity, allMimics, odds, random)
            platform.mimics.grant(channelId, viewer.id, mimic.id, 1, `box-open:${openId}:${opened}:${roll}`)
            const previous = rewards.get(mimic.id)
            rewards.set(mimic.id, { mimic, quantity: (previous?.quantity || 0) + 1 })
          }
          boxNames.push(box?.name || "Cofre")
          row.quantity--
          opened++
        }
        if (opened >= count) break
      }
    })()

    return {
      ok: true,
      opened: count,
      boxNames: [...new Set(boxNames)],
      rewards: [...rewards.values()].map(({ mimic, quantity }) => ({
        name: mimic.name, rarity: mimic.rarity, quantity,
      })),
      remaining: platform.mimics.boxInventory(channelId, viewer.id).reduce((sum, row) => sum + row.quantity, 0),
    }
  }

  return { inventory, listAll, open }
}

let defaultService = null
function getDefaultBoxService() {
  if (!defaultService) {
    defaultService = createBoxService({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
    })
  }
  return defaultService
}

module.exports = { createBoxService, getDefaultBoxService, parseOdds, rollMimic, MAX_OPEN_PER_COMMAND }
