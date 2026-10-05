// services/battle-pass.js — pase de batalla por temporadas.
//
// - La experiencia del pase es la misma que da el nivel normal (mensajes,
//   tiempo viendo, Mimics: levels.js la reenvia aqui), pero en un contador
//   aparte que empieza en 0 cada temporada.
// - MAX_LEVEL niveles; cada uno pide `xpPerLevel` (panel, clave "battle_pass").
// - Pista gratis para todos; pista premium comprando el pase con puntos.
//   Comprarlo a mitad de temporada entrega al momento lo ya desbloqueado.
// - Los premios se entregan solos al subir de nivel (una vez por nivel y pista).
//   Los manuales (cofres de Streamloots) quedan pendientes hasta que el
//   streamer los marca como entregados en el panel.
// - Solo hay una temporada activa; el streamer la empieza desde el panel.
// - Misiones semanales: cada semana (lunes a domingo, hora local) salen
//   MISSIONS_PER_WEEK misiones del MISSION_POOL, las mismas para todos. El
//   progreso sale del registro de actividad (platform.activity); al
//   completarla el viewer la reclama y gana `missionXp` de experiencia del pase.
//   Con las 3 reclamadas puede pagar `missionRerollPrice` puntos por 3 nuevas
//   (hasta MAX_REROLLS_PER_WEEK por semana); las nuevas cuentan desde ese momento.
const { randomUUID } = require("node:crypto")
const { normalizeRarity } = require("./canje-data.js")
const { createEffectsShop } = require("./effects-shop.js")
const { createCardSleeves } = require("./card-sleeves.js")
const { createSubPass, SUB_XP_BONUS } = require("./sub-pass.js")
const { subStatus } = require("./twitch-subs.js")

const CONFIG_KEY = "battle_pass"
const MAX_LEVEL = 30
const DEFAULT_XP_PER_LEVEL = 400
const DEFAULT_PREMIUM_PRICE = 1_000_000
const DEFAULT_WEEKS = 5
const MAX_WEEKS = 26
// "Personaje raro", "Mimic épico"...
const RARITY_LABELS = { raro: "raro", epico: "épico", legendario: "legendario" }
const DEFAULT_MISSION_XP = 500
const DEFAULT_REROLL_PRICE = 25000
const MAX_REROLLS_PER_WEEK = 3
const MISSIONS_PER_WEEK = 3
const WEEK_MS = 7 * 86_400_000
// `action` es lo que anota platform.activity; "watch" cuenta minutos.
const MISSION_POOL = [
  { id: "chat", action: "chat", target: 60, text: "Escribe 60 mensajes en el chat" },
  { id: "watch", action: "watch", target: 120, text: "Mira 120 minutos del directo" },
  { id: "plinko", action: "plinko", target: 15, text: "Suelta 15 bolas en el Plinko" },
  { id: "gachapon", action: "gachapon", target: 5, text: "Tira el gachapon 5 veces" },
  { id: "chest", action: "chest", target: 3, text: "Abre 3 cofres" },
  { id: "mimic", action: "mimic", target: 3, text: "Lanza 3 Mimics en el directo" },
  { id: "market", action: "market", target: 1, text: "Compra o vende una carta en el mercado, o cierra un tradeo" },
  { id: "forge", action: "forge", target: 1, text: "Forja una carta" },
]
// Experiencia que llega de levels.js y que cuenta para una mision.
const XP_REASON_ACTIONS = { mensaje: ["chat", 1], tiempo: ["watch", 5] }

// Lunes 00:00 (hora local) de la semana de `ms`.
function weekStart(ms) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

function weekKey(startMs) {
  const date = new Date(startMs)
  const pad = n => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Numero estable a partir de un texto (para elegir las misiones de la semana).
function hash(text) {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0
  return value
}

// Las misiones de la semana: mismas para todos, distintas cada semana y temporada.
function missionsFor(seasonId, key) {
  let seed = hash(`${seasonId}:${key}`)
  const pool = MISSION_POOL.slice()
  const picked = []
  while (picked.length < MISSIONS_PER_WEEK && pool.length) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0
    picked.push(pool.splice(seed % pool.length, 1)[0])
  }
  return picked
}

// Premios por nivel. Cada premio es una lista de cosas:
//   points {amount} · card {rarity} · mimic {rarity} · effect {effect, minutes}
//   sleeve {sleeve} · manual {text} · badge {name}
const FREE_REWARDS = {
  3: [{ type: "points", amount: 5000 }],
  5: [{ type: "card", rarity: "raro" }],
  6: [{ type: "points", amount: 5000 }],
  9: [{ type: "points", amount: 7500 }],
  10: [{ type: "mimic", rarity: "raro" }],
  12: [{ type: "points", amount: 7500 }],
  15: [{ type: "card", rarity: "raro" }],
  18: [{ type: "points", amount: 10000 }],
  20: [{ type: "mimic", rarity: "raro" }],
  21: [{ type: "points", amount: 10000 }],
  24: [{ type: "points", amount: 12500 }],
  25: [{ type: "card", rarity: "raro" }],
  27: [{ type: "points", amount: 15000 }],
  30: [{ type: "badge", name: "Veterano de la temporada" }, { type: "points", amount: 20000 }],
}
const PREMIUM_SPECIAL = {
  5: [{ type: "card", rarity: "epico" }, { type: "effect", effect: "anti-robo", minutes: 60 }],
  10: [{ type: "mimic", rarity: "epico" }],
  15: [{ type: "card", rarity: "epico" }, { type: "effect", effect: "anti-robo", minutes: 60 }],
  20: [{ type: "mimic", rarity: "epico" }],
  25: [{ type: "card", rarity: "epico" }, { type: "effect", effect: "anti-robo", minutes: 60 }],
  30: [{ type: "manual", text: "30 cofres de Streamloots (los entrega el streamer)" }, { type: "sleeve", sleeve: "prisma" }],
}
const PREMIUM_POINTS_PER_LEVEL = 15000
// Si no hay personajes/Mimics de la rareza del premio, se dan estos puntos.
const FALLBACK_POINTS = { raro: 10000, epico: 25000 }

function rewardsFor(level, track) {
  if (track === "free") return FREE_REWARDS[level] || null
  return PREMIUM_SPECIAL[level] || [{ type: "points", amount: PREMIUM_POINTS_PER_LEVEL }]
}

// Texto corto de un premio, para la pagina y el panel.
function describe(item) {
  if (item.type === "points") return `${item.amount.toLocaleString("es")} puntos`
  if (item.type === "card") return item.name ? `${item.name} (gachapon)` : `Personaje ${RARITY_LABELS[item.rarity]} del gachapon`
  if (item.type === "mimic") return item.name ? `${item.name} (Mimic)` : `Mimic ${RARITY_LABELS[item.rarity]}`
  if (item.type === "effect") return `Inmunidad a robos ${item.minutes} min`
  if (item.type === "sleeve") return item.sleeve === "prisma" ? "Funda prisma" : `Funda ${item.sleeve}`
  if (item.type === "manual") return item.text
  if (item.type === "badge") return `Insignia: ${item.name}`
  return "Premio"
}

function createBattlePass({ platform, getChannel, now = Date.now, random = Math.random }) {
  const db = platform.db
  const effects = createEffectsShop({ platform, getChannel, now })
  const sleeves = createCardSleeves({ platform, getChannel })
  const subPass = createSubPass({ platform, getChannel, now, random })

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso(ms = now()) { return new Date(ms).toISOString() }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    const xp = Math.trunc(Number(saved.xpPerLevel))
    const price = Math.trunc(Number(saved.premiumPrice))
    const missionXp = Math.trunc(Number(saved.missionXp))
    const rerollPrice = Math.trunc(Number(saved.missionRerollPrice))
    return {
      missionRerollPrice: rerollPrice >= 1 && rerollPrice <= 1_000_000_000 ? rerollPrice : DEFAULT_REROLL_PRICE,
      xpPerLevel: xp >= 10 && xp <= 100000 ? xp : DEFAULT_XP_PER_LEVEL,
      premiumPrice: price >= 1 && price <= 1_000_000_000 ? price : DEFAULT_PREMIUM_PRICE,
      missionXp: missionXp >= 0 && missionXp <= 100000 && saved.missionXp !== undefined ? missionXp : DEFAULT_MISSION_XP,
    }
  }

  function setConfig(input = {}) {
    const next = { ...getConfig(), ...input }
    const xpPerLevel = Number(next.xpPerLevel)
    const premiumPrice = Number(next.premiumPrice)
    const missionXp = Number(next.missionXp)
    const missionRerollPrice = Number(next.missionRerollPrice)
    if (!Number.isInteger(missionRerollPrice) || missionRerollPrice < 1 || missionRerollPrice > 1_000_000_000) throw new Error("Precio de renovar misiones inválido")
    if (!Number.isInteger(xpPerLevel) || xpPerLevel < 10 || xpPerLevel > 100000) throw new Error("La experiencia por nivel va de 10 a 100000")
    if (!Number.isInteger(premiumPrice) || premiumPrice < 1 || premiumPrice > 1_000_000_000) throw new Error("Precio del pase premium inválido")
    if (!Number.isInteger(missionXp) || missionXp < 0 || missionXp > 100000) throw new Error("La experiencia por misión va de 0 a 100000")
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, { xpPerLevel, premiumPrice, missionXp, missionRerollPrice })
    return getConfig()
  }

  // ── Temporadas ──────────────────────────────────────────────────────────────
  function latestSeason() {
    return db.prepare("SELECT * FROM battle_pass_seasons WHERE channel_id=? ORDER BY starts_at DESC, created_at DESC LIMIT 1").get(activeChannel()) || null
  }

  function activeSeason() {
    const season = latestSeason()
    if (!season) return null
    const time = now()
    return Date.parse(season.starts_at) <= time && time < Date.parse(season.ends_at) ? season : null
  }

  function startSeason({ name, weeks = DEFAULT_WEEKS } = {}) {
    if (activeSeason()) return { ok: false, reason: "season-active" }
    const title = String(name || "").trim().slice(0, 60)
    const length = Number(weeks)
    if (!title) return { ok: false, reason: "bad-name" }
    if (!Number.isInteger(length) || length < 1 || length > MAX_WEEKS) return { ok: false, reason: "bad-weeks" }
    const id = randomUUID()
    db.prepare("INSERT INTO battle_pass_seasons(id, channel_id, name, starts_at, ends_at, created_at) VALUES(?,?,?,?,?,?)")
      .run(id, activeChannel(), title, iso(), iso(now() + length * 7 * 86_400_000), iso())
    return { ok: true, season: latestSeason() }
  }

  function endSeason() {
    const season = activeSeason()
    if (!season) return { ok: false, reason: "no-season" }
    db.prepare("UPDATE battle_pass_seasons SET ends_at=? WHERE id=?").run(iso(), season.id)
    return { ok: true }
  }

  // ── Progreso ────────────────────────────────────────────────────────────────
  function progressOf(seasonId, viewerId) {
    return db.prepare("SELECT * FROM battle_pass_progress WHERE season_id=? AND viewer_id=?").get(seasonId, viewerId)
      || { season_id: seasonId, viewer_id: viewerId, xp: 0, premium: 0, premium_at: null }
  }

  function levelFor(xp) {
    return Math.min(MAX_LEVEL, Math.floor(xp / getConfig().xpPerLevel))
  }

  function pickRow(rows) {
    return rows.length ? rows[Math.min(rows.length - 1, Math.floor(random() * rows.length))] : null
  }

  // Entrega una cosa de un premio y devuelve lo que se dio de verdad (ej: que personaje).
  function grantItem(season, viewerId, item, key) {
    const channelId = activeChannel()
    const addPoints = (amount, reason) => platform.economy.applyMovement({
      channelId, viewerId, balanceDelta: amount, idempotencyKey: key, reason, sourceType: "battle-pass", sourceId: season.id,
    })
    if (item.type === "points") { addPoints(item.amount, `Pase de batalla: ${season.name}`); return item }
    if (item.type === "card" || item.type === "mimic") {
      const pool = item.type === "card" ? platform.profiles.droppableCards(channelId) : platform.mimics.list(channelId)
      const row = pickRow(pool.filter(entry => normalizeRarity(entry.rarity) === item.rarity))
      if (!row) {
        const amount = FALLBACK_POINTS[item.rarity] || 10000
        addPoints(amount, `Pase de batalla: ${season.name}`)
        return { type: "points", amount, instead: item.type }
      }
      if (item.type === "card") platform.profiles.grantCard(channelId, viewerId, row.id, 1, key)
      else platform.mimics.grant(channelId, viewerId, row.id, 1, key)
      return { ...item, id: row.id, name: row.name }
    }
    if (item.type === "effect") { effects.extend(viewerId, item.effect, item.minutes, channelId); return item }
    if (item.type === "sleeve") { sleeves.grant(viewerId, item.sleeve, 1); return item }
    return item
  }

  // Entrega los premios de los niveles <= `level` que falten (de las pistas que tenga).
  function grantUpTo(season, viewerId, level, premium) {
    const given = new Set(db.prepare("SELECT level, track FROM battle_pass_rewards WHERE season_id=? AND viewer_id=?")
      .all(season.id, viewerId).map(row => `${row.level}:${row.track}`))
    const granted = []
    for (let current = 1; current <= level; current++) {
      for (const track of premium ? ["free", "premium"] : ["free"]) {
        const items = rewardsFor(current, track)
        if (!items || given.has(`${current}:${track}`)) continue
        const done = items.map((item, index) => grantItem(season, viewerId, item, `pase:${season.id}:${viewerId}:${current}:${track}:${index}`))
        const manual = items.some(item => item.type === "manual") ? 1 : 0
        db.prepare(`INSERT INTO battle_pass_rewards(season_id, viewer_id, level, track, reward_json, granted_at, manual)
          VALUES(?,?,?,?,?,?,?)`).run(season.id, viewerId, current, track, JSON.stringify(done), iso(), manual)
        granted.push({ level: current, track, items: done })
      }
    }
    return granted
  }

  // Suma experiencia de la temporada activa (levels.js la reenvia aqui con su
  // motivo: los mensajes y el tiempo viendo cuentan tambien para las misiones).
  function addXp(viewerId, amount, reason = "") {
    const counted = XP_REASON_ACTIONS[reason]
    if (counted) platform.activity.record(activeChannel(), viewerId, counted[0], counted[1], iso())
    const season = activeSeason()
    const base = Math.trunc(Number(amount))
    if (!season || !(base > 0)) return { ok: false, reason: "no-season" }
    // Los subs comprobados ganan un 25% mas, y esa experiencia cuenta tambien para el pase Sub.
    const isSub = subStatus(platform, activeChannel(), viewerId, now()).sub
    const xp = isSub ? Math.round(base * (1 + SUB_XP_BONUS)) : base
    if (isSub) subPass.addXp(viewerId, xp)
    return db.transaction(() => {
      db.prepare(`INSERT INTO battle_pass_progress(season_id, viewer_id, xp) VALUES(?,?,?)
        ON CONFLICT(season_id, viewer_id) DO UPDATE SET xp=xp+excluded.xp`).run(season.id, viewerId, xp)
      const progress = progressOf(season.id, viewerId)
      const level = levelFor(progress.xp)
      return { ok: true, xp: progress.xp, level, granted: grantUpTo(season, viewerId, level, !!progress.premium) }
    })()
  }

  function buyPremium(viewerId, idempotencyKey) {
    const season = activeSeason()
    if (!season) return { ok: false, reason: "no-season" }
    const { premiumPrice } = getConfig()
    try {
      return db.transaction(() => {
        const progress = progressOf(season.id, viewerId)
        if (progress.premium) return { ok: false, reason: "already-premium" }
        platform.economy.applyMovement({
          channelId: activeChannel(), viewerId, balanceDelta: -premiumPrice, idempotencyKey,
          reason: `Pase premium: ${season.name}`, sourceType: "battle-pass", sourceId: season.id,
        })
        db.prepare(`INSERT INTO battle_pass_progress(season_id, viewer_id, xp, premium, premium_at) VALUES(?,?,0,1,?)
          ON CONFLICT(season_id, viewer_id) DO UPDATE SET premium=1, premium_at=excluded.premium_at`).run(season.id, viewerId, iso())
        const granted = grantUpTo(season, viewerId, levelFor(progress.xp), true)
        return { ok: true, price: premiumPrice, granted }
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
  }

  // ── Misiones semanales ──────────────────────────────────────────────────────
  // Semana actual, recortada a las fechas de la temporada.
  function currentWeek(season) {
    const start = weekStart(now())
    const from = Math.max(start, Date.parse(season.starts_at))
    const to = Math.min(start + WEEK_MS, Date.parse(season.ends_at))
    return { key: weekKey(start), from: iso(from), to: iso(to), endsAt: iso(start + WEEK_MS) }
  }

  function rerollsOf(season, viewerId, weekKey) {
    return db.prepare("SELECT count, last_at FROM battle_pass_mission_rerolls WHERE season_id=? AND viewer_id=? AND week_key=?")
      .get(season.id, viewerId, weekKey) || { count: 0, last_at: null }
  }

  function missions(viewerId, season = activeSeason()) {
    if (!season) return null
    const week = currentWeek(season)
    // Cada renovacion es otra "tanda" de la semana: otras misiones, que cuentan desde que se renovo.
    const reroll = rerollsOf(season, viewerId, week.key)
    const batchKey = reroll.count ? `${week.key}#${reroll.count}` : week.key
    const from = reroll.last_at && reroll.last_at > week.from ? reroll.last_at : week.from
    const claimed = new Set(db.prepare("SELECT mission_id FROM battle_pass_mission_claims WHERE season_id=? AND viewer_id=? AND week_key=?")
      .all(season.id, viewerId, batchKey).map(row => row.mission_id))
    const config = getConfig()
    const xp = config.missionXp
    const list = missionsFor(season.id, batchKey).map(mission => {
      const progress = Math.min(mission.target, platform.activity.total(activeChannel(), viewerId, mission.action, from, week.to))
      return { id: mission.id, text: mission.text, target: mission.target, progress, done: progress >= mission.target, claimed: claimed.has(mission.id), xp }
    })
    const rerollsLeft = Math.max(0, MAX_REROLLS_PER_WEEK - reroll.count)
    return {
      weekKey: batchKey, endsAt: week.endsAt, list,
      reroll: { price: config.missionRerollPrice, left: rerollsLeft, available: rerollsLeft > 0 && list.every(item => item.claimed) },
    }
  }

  // Paga puntos por 3 misiones nuevas (solo con las actuales ya reclamadas).
  function rerollMissions(viewerId, idempotencyKey) {
    const season = activeSeason()
    if (!season) return { ok: false, reason: "no-season" }
    const current = missions(viewerId, season)
    if (!current.reroll.left) return { ok: false, reason: "no-rerolls" }
    if (!current.list.every(item => item.claimed)) return { ok: false, reason: "missions-open" }
    const week = currentWeek(season)
    const price = current.reroll.price
    try {
      db.transaction(() => {
        platform.economy.applyMovement({
          channelId: activeChannel(), viewerId, balanceDelta: -price, idempotencyKey,
          reason: "Pase: renovar misiones", sourceType: "battle-pass", sourceId: season.id,
        })
        db.prepare(`INSERT INTO battle_pass_mission_rerolls(season_id, viewer_id, week_key, count, last_at) VALUES(?,?,?,1,?)
          ON CONFLICT(season_id, viewer_id, week_key) DO UPDATE SET count=count+1, last_at=excluded.last_at`).run(season.id, viewerId, week.key, iso())
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
    return { ok: true, price, missions: missions(viewerId, season) }
  }

  function claimMission(viewerId, missionId) {
    const season = activeSeason()
    if (!season) return { ok: false, reason: "no-season" }
    const current = missions(viewerId, season)
    const mission = current.list.find(item => item.id === String(missionId))
    if (!mission) return { ok: false, reason: "no-mission" }
    if (mission.claimed) return { ok: false, reason: "mission-claimed" }
    if (!mission.done) return { ok: false, reason: "mission-pending" }
    return db.transaction(() => {
      const inserted = db.prepare(`INSERT OR IGNORE INTO battle_pass_mission_claims(season_id, viewer_id, week_key, mission_id, xp, claimed_at)
        VALUES(?,?,?,?,?,?)`).run(season.id, viewerId, current.weekKey, mission.id, mission.xp, iso()).changes
      if (!inserted) return { ok: false, reason: "mission-claimed" }
      const gained = mission.xp > 0 ? addXp(viewerId, mission.xp, "mision") : { level: levelFor(progressOf(season.id, viewerId).xp), granted: [] }
      return { ok: true, missionId: mission.id, xp: mission.xp, level: gained.level, granted: gained.granted }
    })()
  }

  // Como se gana experiencia (con los valores reales del panel de niveles).
  // `bonus`: 0.25 para los subs.
  function howTo(bonus = 0) {
    const levels = platform.levels.getConfig(activeChannel())
    const boost = value => Math.round(Number(value || 0) * (1 + bonus))
    return {
      xpPerLevel: getConfig().xpPerLevel, bonusPercent: Math.round(bonus * 100),
      perMessage: boost(levels.xp_per_message), messageCooldownS: Number(levels.msg_cooldown_s) || 0,
      per5min: boost(levels.xp_per_5min), perMission: boost(getConfig().missionXp),
    }
  }

  // Lo que ve el viewer en la pestana Pase.
  function state(viewerId) {
    const season = activeSeason()
    const config = getConfig()
    if (!season) {
      const last = latestSeason()
      return { active: false, lastSeason: last ? { name: last.name, endedAt: last.ends_at } : null }
    }
    const progress = progressOf(season.id, viewerId)
    const level = levelFor(progress.xp)
    const rows = db.prepare("SELECT level, track, reward_json, manual, delivered_at FROM battle_pass_rewards WHERE season_id=? AND viewer_id=?").all(season.id, viewerId)
    const given = new Map(rows.map(row => [`${row.level}:${row.track}`, row]))
    const trackEntry = (current, track) => {
      const items = rewardsFor(current, track)
      if (!items) return null
      const row = given.get(`${current}:${track}`)
      const shown = row ? JSON.parse(row.reward_json) : items
      return {
        granted: !!row, pending: !!(row && row.manual && !row.delivered_at),
        items: shown.map(item => ({ type: item.type, rarity: item.rarity || null, sleeve: item.sleeve || null, label: describe(item) })),
      }
    }
    return {
      active: true,
      season: { name: season.name, startsAt: season.starts_at, endsAt: season.ends_at },
      xp: progress.xp, level, maxLevel: MAX_LEVEL, xpPerLevel: config.xpPerLevel,
      xpIntoLevel: level >= MAX_LEVEL ? config.xpPerLevel : progress.xp - level * config.xpPerLevel,
      premium: !!progress.premium, premiumPrice: config.premiumPrice,
      howTo: howTo(subStatus(platform, activeChannel(), viewerId, now()).sub ? SUB_XP_BONUS : 0),
      missions: missions(viewerId, season),
      levels: Array.from({ length: MAX_LEVEL }, (_, index) => ({
        level: index + 1, free: trackEntry(index + 1, "free"), premium: trackEntry(index + 1, "premium"),
      })),
    }
  }

  // ── Panel ───────────────────────────────────────────────────────────────────
  function summary() {
    const season = latestSeason()
    const active = activeSeason()
    const counts = season
      ? db.prepare("SELECT COUNT(*) AS players, COALESCE(SUM(premium),0) AS premium FROM battle_pass_progress WHERE season_id=?").get(season.id)
      : { players: 0, premium: 0 }
    return {
      config: getConfig(),
      season: season ? { id: season.id, name: season.name, startsAt: season.starts_at, endsAt: season.ends_at, active: !!active } : null,
      players: counts.players, premiumPlayers: counts.premium,
      pending: pendingDeliveries(),
    }
  }

  function pendingDeliveries() {
    const rows = db.prepare(`SELECT r.season_id, r.viewer_id, r.level, r.track, r.reward_json, r.granted_at, s.name AS season_name,
        v.display, v.username, v.platform
      FROM battle_pass_rewards r JOIN battle_pass_seasons s ON s.id=r.season_id JOIN viewer_identities v ON v.id=r.viewer_id
      WHERE s.channel_id=? AND r.manual=1 AND r.delivered_at IS NULL ORDER BY r.granted_at`).all(activeChannel())
      .map(row => ({
        seasonId: row.season_id, viewerId: row.viewer_id, level: row.level, track: row.track, grantedAt: row.granted_at,
        season: row.season_name, viewer: row.display || row.username, platform: row.platform,
        items: JSON.parse(row.reward_json).filter(item => item.type === "manual").map(describe),
      }))
    // Nivel extra del Pase Sub (track "sub").
    const sub = db.prepare(`SELECT r.season_id, r.viewer_id, r.level, r.reward_json, r.granted_at, s.name AS season_name, v.display, v.username, v.platform
      FROM sub_pass_rewards r JOIN battle_pass_seasons s ON s.id=r.season_id JOIN viewer_identities v ON v.id=r.viewer_id
      WHERE s.channel_id=? AND r.manual=1 AND r.delivered_at IS NULL ORDER BY r.granted_at`).all(activeChannel())
      .map(row => ({
        seasonId: row.season_id, viewerId: row.viewer_id, level: row.level, track: "sub", grantedAt: row.granted_at,
        season: `${row.season_name} (Pase Sub)`, viewer: row.display || row.username, platform: row.platform,
        items: JSON.parse(row.reward_json).filter(item => item.type === "manual").map(item => item.text),
      }))
    return [...rows, ...sub].sort((a, b) => (a.grantedAt < b.grantedAt ? -1 : 1))
  }

  function markDelivered({ seasonId, viewerId, level, track }) {
    if (track === "sub") {
      const done = db.prepare("UPDATE sub_pass_rewards SET delivered_at=? WHERE season_id=? AND viewer_id=? AND level=? AND manual=1 AND delivered_at IS NULL")
        .run(iso(), String(seasonId), String(viewerId), Number(level)).changes
      return done ? { ok: true } : { ok: false, reason: "gone" }
    }
    const changes = db.prepare(`UPDATE battle_pass_rewards SET delivered_at=?
      WHERE season_id=? AND viewer_id=? AND level=? AND track=? AND manual=1 AND delivered_at IS NULL`)
      .run(iso(), String(seasonId), String(viewerId), Number(level), String(track)).changes
    return changes ? { ok: true } : { ok: false, reason: "gone" }
  }

  return { howTo, getConfig, setConfig, startSeason, endSeason, activeSeason, addXp, buyPremium, state, summary, pendingDeliveries, markDelivered, missions, claimMission, rerollMissions }
}

let defaultPass = null
function getDefaultBattlePass() {
  if (!defaultPass) {
    defaultPass = createBattlePass({
      platform: require("./local-runtime.js").getLocalPlatform(),
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
    })
  }
  return defaultPass
}

module.exports = { createBattlePass, getDefaultBattlePass, rewardsFor, describe, missionsFor, weekStart, MISSION_POOL, MISSIONS_PER_WEEK, DEFAULT_MISSION_XP, DEFAULT_REROLL_PRICE, MAX_REROLLS_PER_WEEK, MAX_LEVEL, DEFAULT_XP_PER_LEVEL, DEFAULT_PREMIUM_PRICE, FREE_REWARDS, PREMIUM_SPECIAL, PREMIUM_POINTS_PER_LEVEL }
