// services/sub-pass.js — Pase Sub: un pase aparte solo para subs del canal.
//
// - Usa la temporada del pase normal (mismas fechas) pero con su propia
//   experiencia y SUB_MAX_LEVEL niveles; la experiencia por nivel es la del
//   pase normal. Solo suma mientras el viewer es sub comprobado con Twitch
//   (twitch-subs.js); battle-pass.js le reenvia la experiencia.
// - Ventajas de ser sub: +25% de experiencia en los dos pases y 10% de
//   descuento en la tienda (effects-shop.js).
// - Premio en cada nivel (se entregan solos): bolas de Plinko, tiradas de
//   gachapon y cofres de Mimics gratis, la funda Corona, y premios "a elegir"
//   que el viewer usa cuando quiera: elegir un personaje de una rareza (entre
//   todos, tambien los exclusivos del set Sub) y, en el ultimo nivel,
//   convertir una carta suya en Mitica.
// - Nivel extra (BONUS_LEVEL): con el 20 completado se desbloquea pagando
//   `bonusPrice` puntos y da 50 cofres de Streamloots que entrega el streamer
//   (quedan pendientes en el panel hasta que los marca como entregados).
const { randomUUID } = require("node:crypto")
const { createCardSleeves } = require("./card-sleeves.js")
const { subStatus } = require("./twitch-subs.js")
const { normalizeRarity } = require("./canje-data.js")

const CONFIG_KEY = "sub_pass"
const SUB_MAX_LEVEL = 20
const SUB_XP_BONUS = 0.25
const SUB_DISCOUNT = 0.10
const DEFAULT_XP_PER_LEVEL = 400
const BONUS_LEVEL = 21
const DEFAULT_BONUS_PRICE = 1_000_000
const BONUS_REWARD = [{ type: "manual", text: "50 cofres de Streamloots (los entrega el streamer)" }]
const RARITY_LABELS = { raro: "Raro", epico: "Épico", legendario: "Legendario" }
const SUB_REWARDS = {
  1: [{ type: "ticket", kind: "plinko", amount: 30 }],
  2: [{ type: "ticket", kind: "gachapon", amount: 30 }],
  3: [{ type: "pick", rarity: "raro" }],
  4: [{ type: "chest", amount: 30 }],
  5: [{ type: "ticket", kind: "plinko", amount: 35 }],
  6: [{ type: "pick", rarity: "epico" }],
  7: [{ type: "ticket", kind: "gachapon", amount: 35 }],
  8: [{ type: "pick", rarity: "raro" }],
  9: [{ type: "chest", amount: 35 }],
  10: [{ type: "sleeve", sleeve: "corona" }],
  11: [{ type: "ticket", kind: "plinko", amount: 40 }],
  12: [{ type: "pick", rarity: "epico" }],
  13: [{ type: "ticket", kind: "gachapon", amount: 40 }],
  14: [{ type: "chest", amount: 40 }],
  15: [{ type: "pick", rarity: "legendario" }],
  16: [{ type: "ticket", kind: "plinko", amount: 50 }],
  17: [{ type: "ticket", kind: "gachapon", amount: 45 }],
  18: [{ type: "pick", rarity: "legendario" }],
  19: [{ type: "chest", amount: 50 }],
  20: [{ type: "mythic" }],
}

function describe(item) {
  if (item.type === "ticket") {
    return item.kind === "plinko" ? `${item.amount} bolas de Plinko gratis` : `${item.amount} tiradas de gachapon gratis`
  }
  if (item.type === "chest") return `${item.amount} cofres${item.boxName ? ` ${item.boxName}` : " de Mimics"}`
  if (item.type === "pick") return `Elige un personaje ${RARITY_LABELS[item.rarity] || ""}`.trim()
  if (item.type === "mythic") return "Convierte una carta tuya en Mítica"
  if (item.type === "sleeve") return "Funda Corona"
  if (item.type === "manual") return item.text
  return "Premio"
}

function createSubPass({ platform, getChannel, now = Date.now }) {
  const db = platform.db
  const sleeves = createCardSleeves({ platform, getChannel })

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso(ms = now()) { return new Date(ms).toISOString() }

  function xpPerLevel() {
    const saved = platform.moderation.getConfig(activeChannel(), "battle_pass") || {}
    const value = Math.trunc(Number(saved.xpPerLevel))
    return value >= 10 && value <= 100000 ? value : DEFAULT_XP_PER_LEVEL
  }

  // Cofre que regala el pase: el elegido en el panel o, si no, el primero de la lista.
  function giftBox() {
    const boxes = platform.mimics.listBoxes(activeChannel())
    const saved = (platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}).boxId
    return boxes.find(box => box.id === saved) || boxes[boxes.length - 1] || null
  }

  function saved() { return platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {} }

  function getConfig() {
    const box = giftBox()
    const price = Math.trunc(Number(saved().bonusPrice))
    return { boxId: box ? box.id : null, boxName: box ? box.name : null, bonusPrice: price >= 1 && price <= 1_000_000_000 ? price : DEFAULT_BONUS_PRICE }
  }

  function setConfig(input = {}) {
    const next = { ...saved() }
    if (input.boxId !== undefined) {
      const box = platform.mimics.listBoxes(activeChannel()).find(item => item.id === String(input.boxId || ""))
      if (!box) throw new Error("Elige un cofre que exista")
      next.boxId = box.id
    }
    if (input.bonusPrice !== undefined) {
      const price = Number(input.bonusPrice)
      if (!Number.isInteger(price) || price < 1 || price > 1_000_000_000) throw new Error("Precio del nivel extra inválido")
      next.bonusPrice = price
    }
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, next)
    return getConfig()
  }

  function activeSeason() {
    const season = db.prepare("SELECT * FROM battle_pass_seasons WHERE channel_id=? ORDER BY starts_at DESC, created_at DESC LIMIT 1").get(activeChannel())
    if (!season) return null
    return Date.parse(season.starts_at) <= now() && now() < Date.parse(season.ends_at) ? season : null
  }

  function isSub(viewerId) { return subStatus(platform, activeChannel(), viewerId, now()).sub }

  function levelFor(xp) { return Math.min(SUB_MAX_LEVEL, Math.floor(xp / xpPerLevel())) }

  function grantItem(viewerId, item, key) {
    const channelId = activeChannel()
    if (item.type === "ticket") { platform.tickets.grant(channelId, viewerId, item.kind, item.amount); return item }
    if (item.type === "sleeve") { sleeves.grant(viewerId, item.sleeve, 1); return item }
    if (item.type === "chest") {
      const box = giftBox()
      if (!box) {
        // Sin cofres creados, tiradas de gachapon a cambio.
        platform.tickets.grant(channelId, viewerId, "gachapon", item.amount)
        return { type: "ticket", kind: "gachapon", amount: item.amount, instead: "chest" }
      }
      platform.mimics.grantBoxes(channelId, viewerId, box.id, item.amount, key, "pase-sub")
      return { ...item, boxId: box.id, boxName: box.name }
    }
    if (item.type === "pick" || item.type === "mythic") {
      db.prepare("INSERT INTO viewer_reward_choices(id, channel_id, viewer_id, kind, rarity, source, created_at) VALUES(?,?,?,?,?,?,?)")
        .run(randomUUID(), channelId, viewerId, item.type, item.rarity || "", key, iso())
      return item
    }
    return item
  }

  function grantUpTo(season, viewerId, level) {
    const given = new Set(db.prepare("SELECT level FROM sub_pass_rewards WHERE season_id=? AND viewer_id=?").all(season.id, viewerId).map(row => row.level))
    const granted = []
    for (let current = 1; current <= level; current++) {
      const items = SUB_REWARDS[current]
      if (!items || given.has(current)) continue
      const done = items.map((item, index) => grantItem(viewerId, item, `pase-sub:${season.id}:${viewerId}:${current}:${index}`))
      db.prepare("INSERT INTO sub_pass_rewards(season_id, viewer_id, level, reward_json, granted_at) VALUES(?,?,?,?,?)")
        .run(season.id, viewerId, current, JSON.stringify(done), iso())
      granted.push({ level: current, items: done })
    }
    return granted
  }

  // Experiencia del pase Sub (ya con el +25%); solo cuenta si es sub comprobado.
  function addXp(viewerId, amount) {
    const season = activeSeason()
    const xp = Math.trunc(Number(amount))
    if (!season || !(xp > 0) || !isSub(viewerId)) return { ok: false }
    return db.transaction(() => {
      db.prepare(`INSERT INTO sub_pass_progress(season_id, viewer_id, xp) VALUES(?,?,?)
        ON CONFLICT(season_id, viewer_id) DO UPDATE SET xp=xp+excluded.xp`).run(season.id, viewerId, xp)
      const total = db.prepare("SELECT xp FROM sub_pass_progress WHERE season_id=? AND viewer_id=?").get(season.id, viewerId).xp
      const level = levelFor(total)
      return { ok: true, xp: total, level, granted: grantUpTo(season, viewerId, level) }
    })()
  }

  // ── Nivel extra ─────────────────────────────────────────────────────────────
  function bonusRow(season, viewerId) {
    return db.prepare("SELECT * FROM sub_pass_rewards WHERE season_id=? AND viewer_id=? AND level=?").get(season.id, viewerId, BONUS_LEVEL)
  }

  function buyBonus(viewerId, idempotencyKey) {
    const season = activeSeason()
    if (!season) return { ok: false, reason: "no-season" }
    if (!isSub(viewerId)) return { ok: false, reason: "not-sub" }
    const progress = db.prepare("SELECT xp FROM sub_pass_progress WHERE season_id=? AND viewer_id=?").get(season.id, viewerId) || { xp: 0 }
    if (levelFor(progress.xp) < SUB_MAX_LEVEL) return { ok: false, reason: "bonus-locked" }
    const price = getConfig().bonusPrice
    try {
      return db.transaction(() => {
        if (bonusRow(season, viewerId)) return { ok: false, reason: "bonus-owned" }
        platform.economy.applyMovement({
          channelId: activeChannel(), viewerId, balanceDelta: -price, idempotencyKey,
          reason: `Pase Sub: nivel extra (${season.name})`, sourceType: "sub-pass", sourceId: season.id,
        })
        db.prepare("INSERT INTO sub_pass_rewards(season_id, viewer_id, level, reward_json, granted_at, manual) VALUES(?,?,?,?,?,1)")
          .run(season.id, viewerId, BONUS_LEVEL, JSON.stringify(BONUS_REWARD), iso())
        return { ok: true, price }
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
  }

  // ── Premios a elegir ────────────────────────────────────────────────────────
  function pendingChoices(viewerId) {
    return db.prepare("SELECT id, kind, rarity, created_at FROM viewer_reward_choices WHERE channel_id=? AND viewer_id=? AND used_at IS NULL ORDER BY created_at")
      .all(activeChannel(), viewerId)
      .map(row => ({ id: row.id, kind: row.kind, rarity: row.rarity || null, label: describe({ type: row.kind, rarity: row.rarity }) }))
  }

  function openChoice(viewerId, choiceId, kind) {
    return db.prepare("SELECT * FROM viewer_reward_choices WHERE id=? AND channel_id=? AND viewer_id=? AND kind=? AND used_at IS NULL")
      .get(String(choiceId), activeChannel(), viewerId, kind)
  }

  // Personajes que se pueden elegir con un premio "pick" de esa rareza (incluye el set Sub).
  function pickOptions(rarity) {
    return platform.profiles.listCards(activeChannel()).filter(card => normalizeRarity(card.rarity) === rarity)
  }

  function choose(viewerId, choiceId, cardId) {
    const choice = openChoice(viewerId, choiceId, "pick")
    if (!choice) return { ok: false, reason: "no-choice" }
    const card = pickOptions(choice.rarity).find(item => item.id === String(cardId))
    if (!card) return { ok: false, reason: "bad-card" }
    return db.transaction(() => {
      const used = db.prepare("UPDATE viewer_reward_choices SET used_at=?, card_id=? WHERE id=? AND used_at IS NULL").run(iso(), card.id, choice.id).changes
      if (!used) return { ok: false, reason: "no-choice" }
      platform.profiles.grantCard(activeChannel(), viewerId, card.id, 1, `eleccion:${choice.id}`)
      return { ok: true, id: card.id, name: card.name, rarity: normalizeRarity(card.rarity) }
    })()
  }

  // Convierte una copia tuya (normal o con rango/funda; no mitica) en Mitica, sin gastar copias.
  function makeMythic(viewerId, choiceId, { cardId, rank = null, sleeve = null } = {}) {
    const choice = openChoice(viewerId, choiceId, "mythic")
    if (!choice) return { ok: false, reason: "no-choice" }
    if (rank === "mitico") return { ok: false, reason: "already-mythic" }
    const channelId = activeChannel()
    const card = db.prepare("SELECT * FROM cards_local WHERE id=? AND channel_id=?").get(String(cardId), channelId)
    if (!card) return { ok: false, reason: "bad-card" }
    return db.transaction(() => {
      if (!platform.profiles.takeCard(channelId, viewerId, card.id, 1, { rank, sleeve })) return { ok: false, reason: "not-owned" }
      db.prepare("UPDATE viewer_reward_choices SET used_at=?, card_id=? WHERE id=?").run(iso(), card.id, choice.id)
      platform.profiles.grantCard(channelId, viewerId, card.id, 1, `mitica:${choice.id}`, { rank: "mitico", sleeve })
      return { ok: true, id: card.id, name: card.name, rank: "mitico", sleeve: sleeve || null }
    })()
  }

  // Lo que ve el viewer en "Pase Sub".
  function state(viewerId) {
    const season = activeSeason()
    const status = subStatus(platform, activeChannel(), viewerId, now())
    const perks = { xpBonusPercent: Math.round(SUB_XP_BONUS * 100), discountPercent: Math.round(SUB_DISCOUNT * 100) }
    const setSize = db.prepare("SELECT COUNT(*) AS n FROM cards_local WHERE channel_id=? AND exclusive='sub'").get(activeChannel()).n
    const levelsConfig = platform.levels.getConfig(activeChannel())
    const missionXp = Math.trunc(Number((platform.moderation.getConfig(activeChannel(), "battle_pass") || {}).missionXp))
    const boost = value => Math.round(Number(value || 0) * (1 + SUB_XP_BONUS))
    const howTo = {
      xpPerLevel: xpPerLevel(), bonusPercent: Math.round(SUB_XP_BONUS * 100),
      perMessage: boost(levelsConfig.xp_per_message), messageCooldownS: Number(levelsConfig.msg_cooldown_s) || 0,
      per5min: boost(levelsConfig.xp_per_5min), perMission: boost(missionXp >= 0 && !Number.isNaN(missionXp) ? missionXp : 500),
    }
    const base = {
      status, perks, howTo, tickets: platform.tickets.get(activeChannel(), viewerId), setSize, maxLevel: SUB_MAX_LEVEL,
      choices: pendingChoices(viewerId), giftBox: getConfig().boxName,
    }
    if (!season) return { ...base, active: false }
    const progress = db.prepare("SELECT xp FROM sub_pass_progress WHERE season_id=? AND viewer_id=?").get(season.id, viewerId) || { xp: 0 }
    const perLevel = xpPerLevel()
    const level = levelFor(progress.xp)
    const boxName = getConfig().boxName
    const given = new Map(db.prepare("SELECT level, reward_json FROM sub_pass_rewards WHERE season_id=? AND viewer_id=?").all(season.id, viewerId)
      .map(row => [row.level, JSON.parse(row.reward_json)]))
    const bonus = bonusRow(season, viewerId)
    return {
      bonus: {
        level: BONUS_LEVEL, price: getConfig().bonusPrice, label: describe(BONUS_REWARD[0]),
        owned: !!bonus, delivered: !!(bonus && bonus.delivered_at), available: status.sub && level >= SUB_MAX_LEVEL && !bonus,
      },
      ...base, active: true,
      season: { name: season.name, endsAt: season.ends_at },
      xp: progress.xp, level, xpPerLevel: perLevel,
      xpIntoLevel: level >= SUB_MAX_LEVEL ? perLevel : progress.xp - level * perLevel,
      levels: Array.from({ length: SUB_MAX_LEVEL }, (_, index) => {
        const current = index + 1
        const items = SUB_REWARDS[current]
        const shown = given.get(current) || items.map(item => (item.type === "chest" ? { ...item, boxName } : item))
        return {
          level: current,
          reward: {
            granted: given.has(current),
            items: shown.map(item => ({ type: item.type, kind: item.kind || null, rarity: item.rarity || null, sleeve: item.sleeve || null, label: describe(item) })),
          },
        }
      }),
    }
  }

  return { addXp, state, isSub, pendingChoices, pickOptions, choose, makeMythic, buyBonus, getConfig, setConfig }
}

module.exports = { createSubPass, SUB_REWARDS, SUB_MAX_LEVEL, SUB_XP_BONUS, SUB_DISCOUNT, BONUS_LEVEL, DEFAULT_BONUS_PRICE, describe }
