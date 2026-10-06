// services/viewer-profiles.js — Perfiles de la pagina de canje.
//
// - Cada viewer que entra en la web tiene un perfil (touch): eso es lo que
//   lista la seccion Comunidad.
// - Banners, marcos y estilos de nombre (profile-cosmetics.js) se compran
//   con puntos y se equipan; los "Sub" los tiene gratis quien sea sub
//   comprobado. El estilo de nombre sale tambien fuera del perfil
//   (nameStyleOf: comentarios, En vivo, Top, Duelos).
// - La vitrina guarda hasta 6 cartas del viewer (cada una con su rango y
//   funda); al mostrarla se quitan las que ya no tenga (vendidas, robadas...).
// - El perfil publico nunca lleva puntos ni banco: eso solo lo ve su dueño.
const { COSMETICS, RARITY_LABELS, SLOT_COLUMNS, cosmetic } = require("./profile-cosmetics.js")
const { publicImage, normalizeRarity } = require("./canje-data.js")

const SHOWCASE_MAX = 6
const SEARCH_PAGE = 24
const RANK_IDS = new Set(["", "comun", "raro", "epico", "legendario", "mitico"])
const SLEEVE_IDS = new Set(["", "rara", "epica", "prisma", "corona"])

function createViewerProfiles({ platform, getChannel, now = Date.now, isSub = () => false }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso() { return new Date(now()).toISOString() }

  function profileRow(channelId, viewerId) {
    return db.prepare("SELECT * FROM viewer_profiles WHERE channel_id=? AND viewer_id=?").get(channelId, viewerId) || null
  }

  // Entrar en la web crea el perfil o apunta la ultima visita.
  function touch(viewerId) {
    const at = iso()
    db.prepare(`INSERT INTO viewer_profiles(channel_id, viewer_id, joined_at, last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(channel_id, viewer_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`).run(activeChannel(), viewerId, at, at)
  }

  function ownedCosmetics(channelId, viewerId) {
    const ids = new Set(db.prepare("SELECT cosmetic_id FROM viewer_cosmetics WHERE channel_id=? AND viewer_id=?").all(channelId, viewerId).map(r => r.cosmetic_id))
    for (const item of COSMETICS) if (item.subOnly && isSub(viewerId)) ids.add(item.id)
    return ids
  }

  // Lo equipado solo cuenta si lo sigue teniendo (el Marco Sub caduca con la sub).
  function equipped(channelId, viewerId, row) {
    const owned = ownedCosmetics(channelId, viewerId)
    const keep = id => (id && owned.has(id) ? id : "")
    return { banner: keep(row?.banner), frame: keep(row?.frame), name: keep(row?.name_style) }
  }

  // Estilo de nombre equipado de cualquier viewer ("" si no lleva o ya no lo tiene).
  function nameStyleOf(viewerId) {
    if (!viewerId) return ""
    const channelId = activeChannel()
    const row = db.prepare("SELECT name_style FROM viewer_profiles WHERE channel_id=? AND viewer_id=?").get(channelId, viewerId)
    if (!row || !row.name_style) return ""
    const item = cosmetic(row.name_style)
    if (!item) return ""
    if (item.subOnly) return isSub(viewerId) ? item.id : ""
    return db.prepare("SELECT 1 FROM viewer_cosmetics WHERE channel_id=? AND viewer_id=? AND cosmetic_id=?").get(channelId, viewerId, item.id) ? item.id : ""
  }

  // ── Cartas ──
  function cardCatalog(channelId) {
    const rows = db.prepare("SELECT id, name, rarity, image_path FROM cards_local WHERE channel_id=? ORDER BY created_at, rowid").all(channelId)
    return new Map(rows.map((row, index) => [row.id, { ...row, number: index + 1 }]))
  }

  // Copias por variante: "id|rango|funda" -> cantidad (las normales van con rango y funda vacios).
  function ownedVariants(channelId, viewerId) {
    const counts = new Map()
    const variants = platform.profiles.getCardVariants(channelId, viewerId)
    const cards = db.prepare("SELECT card_id, quantity FROM viewer_cards_local WHERE channel_id=? AND viewer_id=? AND quantity>0").all(channelId, viewerId)
    for (const card of cards) {
      const special = variants.filter(v => v.card_id === card.card_id).reduce((sum, v) => sum + v.quantity, 0)
      if (card.quantity - special > 0) counts.set(`${card.card_id}||`, card.quantity - special)
    }
    for (const v of variants) if (v.quantity > 0) counts.set(`${v.card_id}|${v.rank || ""}|${v.sleeve || ""}`, v.quantity)
    return counts
  }

  function variantKey(entry) {
    return `${entry.id}|${entry.rank || ""}|${entry.sleeve || ""}`
  }

  function parseShowcase(text) {
    try {
      const list = JSON.parse(text || "[]")
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  function showcaseCards(channelId, viewerId, row) {
    const owned = ownedVariants(channelId, viewerId)
    const catalog = cardCatalog(channelId)
    return parseShowcase(row?.showcase)
      .filter(entry => owned.has(variantKey(entry)) && catalog.has(entry.id))
      .map(entry => {
        const card = catalog.get(entry.id)
        const base = normalizeRarity(card.rarity)
        return {
          id: card.id, key: variantKey(entry), name: card.name, number: card.number, image: publicImage(card.image_path),
          baseRarity: base, rarity: entry.rank || base, rank: entry.rank || null, sleeve: entry.sleeve || null,
          quantity: owned.get(variantKey(entry)),
        }
      })
  }

  // ── Datos del perfil ──
  function levelOf(channelId, viewerId) {
    const row = db.prepare("SELECT level FROM viewer_levels_local WHERE channel_id=? AND viewer_id=?").get(channelId, viewerId)
    const level = row?.level || 1
    const titles = platform.levels.getTitles(channelId)
    const title = [...titles].filter(t => (t.min_level ?? t.minLevel ?? 0) <= level).pop()
    return { level, title: title ? { text: title.title, color: title.color } : null }
  }

  function collectionStats(channelId, viewerId) {
    const total = db.prepare("SELECT COUNT(*) AS n FROM cards_local WHERE channel_id=?").get(channelId).n
    const owned = db.prepare("SELECT COUNT(*) AS n FROM viewer_cards_local WHERE channel_id=? AND viewer_id=? AND quantity>0").get(channelId, viewerId).n
    const mythic = platform.profiles.getCardVariants(channelId, viewerId).filter(v => v.rank === "mitico").reduce((sum, v) => sum + v.quantity, 0)
    return { owned, total, mythic }
  }

  function publicView(channelId, identity, row) {
    const gear = equipped(channelId, identity.id, row)
    const badges = []
    if (String(identity.username || "").toLowerCase() === channelId) badges.push("streamer")
    if (isSub(identity.id)) badges.push("sub")
    return {
      login: identity.username, display: identity.display || identity.username,
      avatar: /^https:\/\//.test(identity.avatar_url || "") ? identity.avatar_url : null,
      banner: gear.banner, frame: gear.frame, nameStyle: gear.name, badges,
      ...levelOf(channelId, identity.id),
      stats: collectionStats(channelId, identity.id),
      joinedAt: row?.joined_at || null,
      showcase: showcaseCards(channelId, identity.id, row),
    }
  }

  function catalogFor(channelId, viewerId, gear) {
    const owned = ownedCosmetics(channelId, viewerId)
    return COSMETICS.map(item => ({
      id: item.id, slot: item.slot, name: item.name, description: item.description,
      rarity: item.rarity, rarityLabel: RARITY_LABELS[item.rarity], price: item.price, subOnly: !!item.subOnly,
      owned: owned.has(item.id), equipped: gear[item.slot] === item.id,
    }))
  }

  // Tu propio perfil: lo publico + saldo + tienda de perfil.
  function me(viewerId) {
    const channelId = activeChannel()
    touch(viewerId)
    const identity = platform.identities.get(viewerId)
    const row = profileRow(channelId, viewerId)
    const view = publicView(channelId, identity, row)
    const wallet = platform.economy.getBalance(channelId, viewerId)
    return {
      ...view, points: wallet.balance, bank: wallet.bank_balance,
      cosmetics: catalogFor(channelId, viewerId, { banner: view.banner, frame: view.frame, name: view.nameStyle }),
      showcaseMax: SHOWCASE_MAX,
    }
  }

  function equip(viewerId, slot, cosmeticId) {
    if (!Object.prototype.hasOwnProperty.call(SLOT_COLUMNS, slot)) return { ok: false, reason: "bad-request" }
    const channelId = activeChannel()
    const id = String(cosmeticId || "")
    if (id) {
      const item = cosmetic(id)
      if (!item || item.slot !== slot) return { ok: false, reason: "unknown" }
      if (!ownedCosmetics(channelId, viewerId).has(id)) return { ok: false, reason: "not-owned" }
    }
    touch(viewerId)
    db.prepare(`UPDATE viewer_profiles SET ${SLOT_COLUMNS[slot]}=? WHERE channel_id=? AND viewer_id=?`).run(id, channelId, viewerId)
    return { ok: true, slot, id }
  }

  // Cobra y entrega en una transaccion; comprar algo que ya tienes no cobra.
  function buy(viewerId, cosmeticId, idempotencyKey) {
    const item = cosmetic(cosmeticId)
    if (!item || item.subOnly) return { ok: false, reason: "not-for-sale" }
    const channelId = activeChannel()
    if (ownedCosmetics(channelId, viewerId).has(item.id)) return { ok: false, reason: "owned" }
    try {
      db.transaction(() => {
        platform.economy.applyMovement({
          channelId, viewerId, balanceDelta: -item.price, idempotencyKey,
          reason: `Tienda de perfil: ${item.name}`, sourceType: "cosmetic", sourceId: item.id,
        })
        db.prepare("INSERT OR IGNORE INTO viewer_cosmetics(channel_id, viewer_id, cosmetic_id, acquired_at) VALUES(?,?,?,?)")
          .run(channelId, viewerId, item.id, iso())
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
    return { ok: true, id: item.id, name: item.name, price: item.price }
  }

  // cards: [{id, rank, sleeve}] en el orden en que se ven. Solo cartas propias.
  function setShowcase(viewerId, cards) {
    if (!Array.isArray(cards) || cards.length > SHOWCASE_MAX) return { ok: false, reason: "bad-request" }
    const channelId = activeChannel()
    const owned = ownedVariants(channelId, viewerId)
    const clean = []
    const seen = new Set()
    for (const raw of cards) {
      const entry = { id: String(raw?.id || "").slice(0, 80), rank: String(raw?.rank || ""), sleeve: String(raw?.sleeve || "") }
      if (!RANK_IDS.has(entry.rank) || !SLEEVE_IDS.has(entry.sleeve)) return { ok: false, reason: "bad-request" }
      const key = variantKey(entry)
      if (!owned.has(key)) return { ok: false, reason: "not-owned-card" }
      if (seen.has(key)) continue
      seen.add(key)
      clean.push(entry)
    }
    touch(viewerId)
    db.prepare("UPDATE viewer_profiles SET showcase=? WHERE channel_id=? AND viewer_id=?").run(JSON.stringify(clean), channelId, viewerId)
    return { ok: true, showcase: showcaseCards(channelId, viewerId, profileRow(channelId, viewerId)) }
  }

  // ── Comunidad ──
  // Tarjeta pequena de la cuadricula. `row` es la fila del perfil (o null si
  // nunca ha entrado en la web: sale igual, pero sin poder abrir su perfil).
  function miniCard(channelId, identity, row) {
    const gear = equipped(channelId, identity.id, row)
    const achievements = db.prepare("SELECT COUNT(*) AS n FROM viewer_achievements WHERE channel_id=? AND viewer_id=?").get(channelId, identity.id).n
    return {
      login: identity.username, display: identity.display || identity.username,
      avatar: /^https:\/\//.test(identity.avatar_url || "") ? identity.avatar_url : null,
      banner: gear.banner, frame: gear.frame, nameStyle: gear.name, ...levelOf(channelId, identity.id),
      showcaseCount: parseShowcase(row?.showcase).length, achievements,
      sub: isSub(identity.id), hasProfile: !!row,
    }
  }

  function identityOfRow(row) {
    return { id: row.identity_id, username: row.username, display: row.display, avatar_url: row.avatar_url }
  }

  function miniOf(viewerId) {
    const channelId = activeChannel()
    const identity = platform.identities.get(viewerId)
    return identity ? miniCard(channelId, identity, profileRow(channelId, viewerId)) : null
  }

  const SORTS = {
    recent: "p.last_seen_at DESC",
    new: "p.joined_at DESC",
    level: "COALESCE(l.xp, 0) DESC, p.last_seen_at DESC",
    collection: "owned DESC, p.last_seen_at DESC",
  }

  // `sort`: recent | new | level | collection. `subs`: solo subs comprobados.
  function search(query, page = 0, { sort = "recent", subs = false } = {}) {
    const channelId = activeChannel()
    const text = String(query || "").trim().toLowerCase().slice(0, 40)
    const like = `%${text.replace(/[\\%_]/g, char => `\\${char}`)}%`
    const offset = Math.max(0, Math.min(1000, Math.trunc(Number(page) || 0))) * SEARCH_PAGE
    const order = SORTS[sort] || SORTS.recent
    // Con el filtro de subs se filtra en memoria (la sub no esta en una columna).
    const limit = subs ? 5000 : SEARCH_PAGE + 1
    const rows = db.prepare(`SELECT p.*, i.id AS identity_id, i.username, i.display, i.avatar_url,
        (SELECT COUNT(*) FROM viewer_cards_local c WHERE c.channel_id=p.channel_id AND c.viewer_id=p.viewer_id AND c.quantity>0) AS owned
      FROM viewer_profiles p JOIN viewer_identities i ON i.id=p.viewer_id
      LEFT JOIN viewer_levels_local l ON l.channel_id=p.channel_id AND l.viewer_id=p.viewer_id
      WHERE p.channel_id=? AND (?='' OR lower(i.display) LIKE ? ESCAPE '\\' OR lower(i.username) LIKE ? ESCAPE '\\')
      ORDER BY ${order} LIMIT ? OFFSET ?`).all(channelId, text, like, like, limit, subs ? 0 : offset)
    const list = subs ? rows.filter(row => isSub(row.identity_id)).slice(offset, offset + SEARCH_PAGE + 1) : rows
    return {
      results: list.slice(0, SEARCH_PAGE).map(row => miniCard(channelId, identityOfRow(row), row)),
      hasMore: list.length > SEARCH_PAGE,
    }
  }

  // Los que acaban de llegar a la web.
  function newcomers(limit = 8) {
    const channelId = activeChannel()
    return db.prepare(`SELECT p.*, i.id AS identity_id, i.username, i.display, i.avatar_url
      FROM viewer_profiles p JOIN viewer_identities i ON i.id=p.viewer_id
      WHERE p.channel_id=? ORDER BY p.joined_at DESC LIMIT ?`).all(channelId, limit)
      .map(row => ({ ...miniCard(channelId, identityOfRow(row), row), joinedAt: row.joined_at }))
  }

  // Datos del perfil para los logros (achievements.js, `fact`).
  function factsOf(viewerId) {
    const channelId = activeChannel()
    const row = profileRow(channelId, viewerId)
    const stats = collectionStats(channelId, viewerId)
    const gear = equipped(channelId, viewerId, row)
    const joined = row?.joined_at ? Date.parse(row.joined_at) : now()
    return {
      level: levelOf(channelId, viewerId).level,
      owned: stats.owned,
      complete: stats.total >= 10 && stats.owned >= stats.total ? 1 : 0,
      showcase: showcaseCards(channelId, viewerId, row).length,
      styled: gear.banner && gear.frame ? 1 : 0,
      days: Math.floor((now() - joined) / 86400000),
    }
  }

  // Usuario de Twitch -> id del viewer (solo si tiene perfil en la web).
  function viewerIdOf(login) {
    const username = String(login || "").trim().toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(username)) return null
    const identity = db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND lower(username)=?").get(username)
    return identity && profileRow(activeChannel(), identity.id) ? identity.id : null
  }

  // Perfil de otro viewer por su usuario de Twitch (solo si usa la web).
  function publicProfile(login) {
    const channelId = activeChannel()
    const username = String(login || "").trim().toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(username)) return null
    const identity = db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND lower(username)=?").get(username)
    const row = identity && profileRow(channelId, identity.id)
    return row ? publicView(channelId, identity, row) : null
  }

  return { touch, me, equip, buy, setShowcase, search, newcomers, miniOf, factsOf, viewerIdOf, publicProfile, nameStyleOf, SHOWCASE_MAX }
}

module.exports = { createViewerProfiles, SHOWCASE_MAX, SEARCH_PAGE }
