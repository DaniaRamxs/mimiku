const { randomUUID } = require("node:crypto")

const DEFAULT_TITLES = [
  { min_level: 1, title: "Novato", color: "#a1a1aa", icon: "🌱" },
  { min_level: 10, title: "Habitual", color: "#3b82f6", icon: "⭐" },
  { min_level: 25, title: "Veterano", color: "#a855f7", icon: "🔥" },
  { min_level: 50, title: "Leyenda", color: "#f59e0b", icon: "👑" },
  { min_level: 100, title: "Mítico", color: "#ec4899", icon: "💎" },
]

function text(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function channel(value) {
  const result = text(value, 50).toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_:-]/g, "")
  if (!result) throw new Error("Canal inválido")
  return result
}

function positiveInteger(value, fallback = 1) {
  const result = Number(value ?? fallback)
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Cantidad inválida")
  return result
}

function json(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

function xpForLevel(level) {
  if (level <= 1) return 0
  let total = 0
  for (let current = 1; current < level; current++) total += Math.floor(100 * Math.pow(current, 1.5))
  return total
}

function levelFromXp(xp) {
  let level = 1
  while (xp >= xpForLevel(level + 1)) level++
  return level
}

function createLocalPlatform(db) {
  const identities = {
    resolve(input) {
      const platform = text(input?.platform || "twitch", 30).toLowerCase()
      const username = text(input?.username, 80).toLowerCase().replace(/^@/, "")
      if (!username) throw new Error("Usuario inválido")
      const suppliedId = text(input?.platformUserId, 160)
      const platformUserId = suppliedId || `legacy:${username}`
      let row = db.prepare("SELECT * FROM viewer_identities WHERE platform = ? AND platform_user_id = ?").get(platform, platformUserId)
      if (!row && suppliedId) {
        row = db.prepare("SELECT * FROM viewer_identities WHERE platform = ? AND username = ? ORDER BY created_at LIMIT 1").get(platform, username)
        if (row && row.platform_user_id.startsWith("legacy:")) {
          db.prepare("UPDATE viewer_identities SET platform_user_id = ? WHERE id = ?").run(platformUserId, row.id)
        }
      }
      if (!row) {
        const id = randomUUID()
        db.prepare(`INSERT INTO viewer_identities
          (id, platform, platform_user_id, username, display, avatar_url)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(id, platform, platformUserId, username, text(input?.display, 100) || username, text(input?.avatarUrl, 1000))
        row = db.prepare("SELECT * FROM viewer_identities WHERE id = ?").get(id)
      } else {
        db.prepare(`UPDATE viewer_identities SET username = ?, display = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(username, text(input?.display, 100) || row.display || username, text(input?.avatarUrl, 1000) || row.avatar_url, row.id)
        row = db.prepare("SELECT * FROM viewer_identities WHERE id = ?").get(row.id)
      }
      return row
    },
    get(viewerId) {
      return db.prepare("SELECT * FROM viewer_identities WHERE id = ?").get(viewerId)
    },
    byUsername(username, platform = "twitch") {
      return db.prepare("SELECT * FROM viewer_identities WHERE platform = ? AND username = ? ORDER BY updated_at DESC LIMIT 1")
        .get(text(platform, 30).toLowerCase(), text(username, 80).toLowerCase().replace(/^@/, ""))
    },
  }

  function ensureWallet(channelId, viewerId) {
    if (!identities.get(viewerId)) throw new Error("Usuario no encontrado")
    const ch = channel(channelId)
    db.prepare("INSERT OR IGNORE INTO wallets(channel_id, viewer_id) VALUES (?, ?)").run(ch, viewerId)
    return db.prepare("SELECT * FROM wallets WHERE channel_id = ? AND viewer_id = ?").get(ch, viewerId)
  }

  function applyMovementInside(input) {
    const ch = channel(input.channelId)
    const viewerId = text(input.viewerId, 100)
    const idempotencyKey = text(input.idempotencyKey, 240)
    if (!idempotencyKey) throw new Error("Se requiere una clave idempotente")
    const balanceDelta = Number(input.balanceDelta || 0)
    const bankDelta = Number(input.bankDelta || 0)
    if (!Number.isSafeInteger(balanceDelta) || !Number.isSafeInteger(bankDelta)) throw new Error("Movimiento inválido")
    const existing = db.prepare("SELECT * FROM economy_ledger WHERE idempotency_key = ?").get(idempotencyKey)
    if (existing) return ensureWallet(ch, existing.viewer_id)
    const wallet = ensureWallet(ch, viewerId)
    const nextBalance = wallet.balance + balanceDelta
    const nextBank = wallet.bank_balance + bankDelta
    if (nextBalance < 0 || nextBank < 0) throw new Error("Saldo insuficiente")
    db.prepare(`UPDATE wallets SET balance = ?, bank_balance = ?, updated_at = datetime('now')
      WHERE channel_id = ? AND viewer_id = ?`).run(nextBalance, nextBank, ch, viewerId)
    db.prepare(`INSERT INTO economy_ledger
      (id, idempotency_key, channel_id, viewer_id, balance_delta, bank_delta, balance_after, bank_after, reason, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), idempotencyKey, ch, viewerId, balanceDelta, bankDelta, nextBalance, nextBank,
        text(input.reason, 200) || "movement", text(input.sourceType, 80), text(input.sourceId, 160))
    return ensureWallet(ch, viewerId)
  }

  const movementTransaction = db.transaction(applyMovementInside)
  const economy = {
    applyMovement(input) { return movementTransaction(input) },
    getBalance(channelId, viewerId) { return ensureWallet(channelId, viewerId) },
    listLedger(channelId, viewerId, limit = 100) {
      return db.prepare(`SELECT * FROM economy_ledger WHERE channel_id = ? AND viewer_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(channel(channelId), viewerId, Math.min(1000, positiveInteger(limit)))
    },
    ranking(channelId, limit = 20) {
      return db.prepare(`SELECT i.*, w.balance, w.bank_balance FROM wallets w
        JOIN viewer_identities i ON i.id = w.viewer_id WHERE w.channel_id = ?
        ORDER BY w.balance DESC LIMIT ?`).all(channel(channelId), Math.min(1000, positiveInteger(limit)))
    },
  }

  function insertHistory(ch, viewerId, action, itemId, quantity, key) {
    db.prepare(`INSERT OR IGNORE INTO mimic_history_local
      (id, channel_id, viewer_id, action, item_id, quantity, reference_key) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), ch, viewerId || null, action, itemId, quantity, key)
  }

  const mimics = {
    create(channelId, input) {
      const id = text(input?.id, 100) || randomUUID()
      db.prepare(`INSERT INTO mimics_local
        (id, channel_id, name, description, icon, rarity, sequence_json, cooldown_s, is_event, asset_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, channel(channelId), text(input?.name, 120) || "Mimic", text(input?.description, 1000),
          text(input?.icon, 20) || "✨", text(input?.rarity, 30) || "comun", JSON.stringify(input?.sequence || []),
          positiveInteger(input?.cooldown_s || input?.cooldownS || 30), input?.is_event || input?.isEvent ? 1 : 0,
          text(input?.assetPath, 1000))
      return this.get(id)
    },
    get(id) {
      const row = db.prepare("SELECT * FROM mimics_local WHERE id = ?").get(id)
      return row ? { ...row, sequence: json(row.sequence_json, []) } : undefined
    },
    list(channelId) {
      return db.prepare("SELECT * FROM mimics_local WHERE channel_id = ? ORDER BY created_at DESC").all(channel(channelId))
        .map(row => ({ ...row, sequence: json(row.sequence_json, []) }))
    },
    update(id, updates) {
      const current = this.get(id)
      if (!current) throw new Error("Mimic no encontrado")
      db.prepare(`UPDATE mimics_local SET name=?, description=?, icon=?, rarity=?, sequence_json=?, cooldown_s=?, is_event=?, asset_path=? WHERE id=?`)
        .run(text(updates?.name ?? current.name, 120), text(updates?.description ?? current.description, 1000),
          text(updates?.icon ?? current.icon, 20), text(updates?.rarity ?? current.rarity, 30),
          JSON.stringify(updates?.sequence ?? current.sequence), positiveInteger(updates?.cooldown_s ?? current.cooldown_s),
          updates?.is_event === undefined ? current.is_event : updates.is_event ? 1 : 0,
          text(updates?.assetPath ?? updates?.asset_path ?? current.asset_path, 1000), id)
      return this.get(id)
    },
    remove(id) { return db.prepare("DELETE FROM mimics_local WHERE id = ?").run(id).changes > 0 },
    createBox(channelId, input) {
      const id = text(input?.id, 100) || randomUUID()
      db.prepare(`INSERT INTO mimic_boxes_local
        (id, channel_id, name, description, icon, price_points, price_real, mimic_count, odds_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, channel(channelId), text(input?.name, 120) || "Caja", text(input?.description, 1000), text(input?.icon, 20) || "🎁",
          input?.price_points ?? input?.pricePoints ?? null, input?.price_real ?? input?.priceReal ?? null,
          positiveInteger(input?.mimic_count ?? input?.mimicCount ?? 3), JSON.stringify(input?.odds || {}))
      return db.prepare("SELECT * FROM mimic_boxes_local WHERE id = ?").get(id)
    },
    listBoxes(channelId) { return db.prepare("SELECT * FROM mimic_boxes_local WHERE channel_id = ? ORDER BY created_at DESC").all(channel(channelId)) },
    removeBox(id) { return db.prepare("DELETE FROM mimic_boxes_local WHERE id = ?").run(id).changes > 0 },
    grant(channelId, viewerId, mimicId, quantity = 1, idempotencyKey) {
      const ch = channel(channelId)
      const qty = positiveInteger(quantity)
      const key = text(idempotencyKey, 240)
      if (!key) throw new Error("Se requiere una clave idempotente")
      return db.transaction(() => {
        if (db.prepare("SELECT 1 FROM mimic_history_local WHERE reference_key = ?").get(key)) return this.inventory(ch, viewerId)
        if (!this.get(mimicId)) throw new Error("Mimic no encontrado")
        ensureWallet(ch, viewerId)
        db.prepare(`INSERT INTO viewer_mimics_local(channel_id, viewer_id, mimic_id, quantity) VALUES (?, ?, ?, ?)
          ON CONFLICT(channel_id, viewer_id, mimic_id) DO UPDATE SET quantity=quantity+excluded.quantity, updated_at=datetime('now')`)
          .run(ch, viewerId, mimicId, qty)
        insertHistory(ch, viewerId, "grant", mimicId, qty, key)
        return this.inventory(ch, viewerId)
      })()
    },
    use(channelId, viewerId, mimicId, idempotencyKey) {
      const ch = channel(channelId)
      const key = text(idempotencyKey, 240)
      if (!key) throw new Error("Se requiere una clave idempotente")
      return db.transaction(() => {
        const existing = db.prepare("SELECT * FROM mimic_uses_local WHERE request_key = ?").get(key)
        if (existing) return existing
        const owned = db.prepare(`UPDATE viewer_mimics_local SET quantity=quantity-1, updated_at=datetime('now')
          WHERE channel_id=? AND viewer_id=? AND mimic_id=? AND quantity>0`).run(ch, viewerId, mimicId)
        if (!owned.changes) throw new Error("Mimic no disponible")
        const id = randomUUID()
        db.prepare(`INSERT INTO mimic_uses_local(id, request_key, channel_id, viewer_id, mimic_id) VALUES (?, ?, ?, ?, ?)`)
          .run(id, key, ch, viewerId, mimicId)
        insertHistory(ch, viewerId, "use", mimicId, -1, `history:${key}`)
        return db.prepare("SELECT * FROM mimic_uses_local WHERE id = ?").get(id)
      })()
    },
    gift(channelId, fromViewerId, toViewerId, mimicId, quantity = 1, idempotencyKey) {
      const ch = channel(channelId)
      const qty = positiveInteger(quantity)
      const key = text(idempotencyKey, 240)
      if (!key) throw new Error("Se requiere una clave idempotente")
      return db.transaction(() => {
        const existing = db.prepare("SELECT * FROM mimic_gifts_local WHERE request_key = ?").get(key)
        if (existing) return existing
        const removed = db.prepare(`UPDATE viewer_mimics_local SET quantity=quantity-?, updated_at=datetime('now')
          WHERE channel_id=? AND viewer_id=? AND mimic_id=? AND quantity>=?`).run(qty, ch, fromViewerId, mimicId, qty)
        if (!removed.changes) throw new Error("Mimics insuficientes")
        ensureWallet(ch, toViewerId)
        db.prepare(`INSERT INTO viewer_mimics_local(channel_id, viewer_id, mimic_id, quantity) VALUES (?, ?, ?, ?)
          ON CONFLICT(channel_id, viewer_id, mimic_id) DO UPDATE SET quantity=quantity+excluded.quantity, updated_at=datetime('now')`)
          .run(ch, toViewerId, mimicId, qty)
        const id = randomUUID()
        db.prepare(`INSERT INTO mimic_gifts_local(id, request_key, channel_id, from_viewer_id, to_viewer_id, item_type, item_id, quantity)
          VALUES (?, ?, ?, ?, ?, 'mimic', ?, ?)`)
          .run(id, key, ch, fromViewerId, toViewerId, mimicId, qty)
        insertHistory(ch, fromViewerId, "gift", mimicId, -qty, `history:${key}`)
        return db.prepare("SELECT * FROM mimic_gifts_local WHERE id = ?").get(id)
      })()
    },
    // Dispara un Mimic sin pasar por el inventario del viewer (p. ej. por una
    // regla de regalos). Idempotente por `idempotencyKey`. `used_at` se guarda
    // en ISO 8601 porque la cola de mimics.js lo compara como texto contra un ISO.
    trigger(channelId, viewerId, mimicId, idempotencyKey) {
      const ch = channel(channelId)
      const key = text(idempotencyKey, 240)
      if (!key) throw new Error("Se requiere una clave idempotente")
      return db.transaction(() => {
        const existing = db.prepare("SELECT * FROM mimic_uses_local WHERE request_key = ?").get(key)
        if (existing) return existing
        if (!this.get(mimicId)) throw new Error("Mimic no encontrado")
        const id = randomUUID()
        db.prepare(`INSERT INTO mimic_uses_local(id, request_key, channel_id, viewer_id, mimic_id, used_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(id, key, ch, viewerId, mimicId, new Date().toISOString())
        insertHistory(ch, viewerId, "trigger", mimicId, 0, `history:${key}`)
        return db.prepare("SELECT * FROM mimic_uses_local WHERE id = ?").get(id)
      })()
    },
    // Entrega cofres (cajas) SIN abrir al inventario del viewer. Idempotente
    // por `idempotencyKey`: repetir la misma clave no duplica la entrega.
    grantBoxes(channelId, viewerId, boxId, quantity, idempotencyKey, source = "") {
      const ch = channel(channelId)
      const qty = positiveInteger(quantity)
      const key = text(idempotencyKey, 240)
      if (!key) throw new Error("Se requiere una clave idempotente")
      return db.transaction(() => {
        if (db.prepare("SELECT 1 FROM box_grant_history WHERE idempotency_key = ?").get(key)) return this.boxInventory(ch, viewerId)
        if (!db.prepare("SELECT 1 FROM mimic_boxes_local WHERE id = ?").get(boxId)) throw new Error("Caja no encontrada")
        ensureWallet(ch, viewerId)
        db.prepare(`INSERT INTO viewer_boxes_local(channel_id, viewer_id, box_id, quantity) VALUES (?, ?, ?, ?)
          ON CONFLICT(channel_id, viewer_id, box_id) DO UPDATE SET quantity=quantity+excluded.quantity, updated_at=datetime('now')`)
          .run(ch, viewerId, boxId, qty)
        db.prepare(`INSERT INTO box_grant_history(id, idempotency_key, channel_id, viewer_id, box_id, quantity, source)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), key, ch, viewerId, boxId, qty, text(source, 60))
        return this.boxInventory(ch, viewerId)
      })()
    },
    boxInventory(channelId, viewerId) {
      return db.prepare(`SELECT vb.box_id, vb.quantity, b.name, b.icon FROM viewer_boxes_local vb
        JOIN mimic_boxes_local b ON b.id=vb.box_id WHERE vb.channel_id=? AND vb.viewer_id=? AND vb.quantity>0 ORDER BY b.name`)
        .all(channel(channelId), viewerId)
    },
    inventory(channelId, viewerId) {
      return db.prepare(`SELECT vm.*, m.name, m.icon, m.rarity, m.sequence_json FROM viewer_mimics_local vm
        JOIN mimics_local m ON m.id=vm.mimic_id WHERE vm.channel_id=? AND vm.viewer_id=? ORDER BY m.name`)
        .all(channel(channelId), viewerId).map(row => ({ ...row, sequence: json(row.sequence_json, []) }))
    },
    history(channelId, limit = 100) {
      return db.prepare("SELECT * FROM mimic_history_local WHERE channel_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?")
        .all(channel(channelId), Math.min(1000, positiveInteger(limit)))
    },
  }

  const levels = {
    getConfig(channelId) {
      const ch = channel(channelId)
      db.prepare("INSERT OR IGNORE INTO level_config_local(channel_id) VALUES (?)").run(ch)
      return db.prepare("SELECT * FROM level_config_local WHERE channel_id=?").get(ch)
    },
    setConfig(channelId, input) {
      const current = this.getConfig(channelId)
      const ch = channel(channelId)
      db.prepare(`UPDATE level_config_local SET xp_per_message=?, xp_per_5min=?, msg_cooldown_s=?, level_up_reward=?, announce_overlay=?, updated_at=datetime('now') WHERE channel_id=?`)
        .run(Number(input?.xpPerMessage ?? input?.xp_per_message ?? current.xp_per_message),
          Number(input?.xpPer5min ?? input?.xp_per_5min ?? current.xp_per_5min),
          Number(input?.msgCooldownS ?? input?.msg_cooldown_s ?? current.msg_cooldown_s),
          Number(input?.levelUpReward ?? input?.level_up_reward ?? current.level_up_reward),
          input?.announceOverlay === undefined && input?.announce_overlay === undefined ? current.announce_overlay : (input?.announceOverlay ?? input?.announce_overlay) ? 1 : 0, ch)
      return this.getConfig(ch)
    },
    addXp(channelId, viewerId, amount, reason = "xp") {
      const ch = channel(channelId)
      const delta = positiveInteger(amount)
      ensureWallet(ch, viewerId)
      db.prepare(`INSERT INTO viewer_levels_local(channel_id, viewer_id, xp, level) VALUES (?, ?, ?, ?)
        ON CONFLICT(channel_id, viewer_id) DO UPDATE SET xp=xp+excluded.xp, updated_at=datetime('now')`)
        .run(ch, viewerId, delta, 1)
      const row = db.prepare("SELECT * FROM viewer_levels_local WHERE channel_id=? AND viewer_id=?").get(ch, viewerId)
      const level = levelFromXp(row.xp)
      db.prepare("UPDATE viewer_levels_local SET level=? WHERE channel_id=? AND viewer_id=?").run(level, ch, viewerId)
      return { ...row, level, reason }
    },
    getViewer(channelId, viewerId) {
      ensureWallet(channelId, viewerId)
      return db.prepare("SELECT * FROM viewer_levels_local WHERE channel_id=? AND viewer_id=?").get(channel(channelId), viewerId) || { xp: 0, level: 1 }
    },
    leaderboard(channelId, limit = 20) {
      return db.prepare(`SELECT l.*, i.username, i.display FROM viewer_levels_local l JOIN viewer_identities i ON i.id=l.viewer_id
        WHERE l.channel_id=? ORDER BY l.xp DESC LIMIT ?`).all(channel(channelId), Math.min(1000, positiveInteger(limit)))
    },
    saveTitles(channelId, titles) {
      const ch = channel(channelId)
      db.transaction(() => {
        db.prepare("DELETE FROM level_titles_local WHERE channel_id=?").run(ch)
        const insert = db.prepare("INSERT INTO level_titles_local(id, channel_id, min_level, title, color, icon) VALUES (?, ?, ?, ?, ?, ?)")
        for (const title of titles || []) insert.run(randomUUID(), ch, positiveInteger(title.minLevel ?? title.min_level), text(title.title, 100) || "Sin título", text(title.color, 20) || "#a1a1aa", text(title.icon, 20) || "✨")
      })()
      return this.getTitles(ch)
    },
    getTitles(channelId) {
      const rows = db.prepare("SELECT * FROM level_titles_local WHERE channel_id=? ORDER BY min_level").all(channel(channelId))
      return rows.length ? rows : DEFAULT_TITLES
    },
    xpForLevel,
    levelFromXp,
  }

  const profiles = {
    getOrCreate(channelId, identity) {
      const ch = channel(channelId)
      const viewer = identities.resolve(identity)
      db.prepare("INSERT OR IGNORE INTO viewer_profiles_local(channel_id, viewer_id) VALUES (?, ?)").run(ch, viewer.id)
      return db.prepare(`SELECT p.*, p.viewer_id, i.platform, i.platform_user_id, i.username, i.display, i.avatar_url
        FROM viewer_profiles_local p JOIN viewer_identities i ON i.id=p.viewer_id WHERE p.channel_id=? AND p.viewer_id=?`).get(ch, viewer.id)
    },
    update(channelId, viewerId, updates) {
      const viewer = identities.get(viewerId)
      if (!viewer) throw new Error("Usuario no encontrado")
      const current = this.getOrCreate(channelId, { platform: viewer.platform, platformUserId: viewer.platform_user_id, username: viewer.username, display: viewer.display })
      db.prepare(`UPDATE viewer_profiles_local SET bio=?, hours_watched=?, frame_url=?, banner_url=?, badge_url=?, name_color=?, updated_at=datetime('now') WHERE channel_id=? AND viewer_id=?`)
        .run(text(updates?.bio ?? current.bio, 1000), Number(updates?.hoursWatched ?? updates?.hours_watched ?? current.hours_watched),
          text(updates?.frameUrl ?? updates?.frame_url ?? current.frame_url, 1000), text(updates?.bannerUrl ?? updates?.banner_url ?? current.banner_url, 1000),
          text(updates?.badgeUrl ?? updates?.badge_url ?? current.badge_url, 1000), text(updates?.nameColor ?? updates?.name_color ?? current.name_color, 30),
          channel(channelId), viewerId)
      return this.getOrCreate(channelId, { platform: viewer.platform, platformUserId: viewer.platform_user_id, username: viewer.username, display: viewer.display })
    },
    createCard(channelId, input) {
      const id = text(input?.id, 100) || randomUUID()
      db.prepare("INSERT INTO cards_local(id,channel_id,name,description,image_path,rarity) VALUES(?,?,?,?,?,?)")
        .run(id, channel(channelId), text(input?.name, 120) || "Carta", text(input?.description, 1000), text(input?.imagePath ?? input?.image_url, 1000), text(input?.rarity, 30) || "common")
      return db.prepare("SELECT * FROM cards_local WHERE id=?").get(id)
    },
    listCards(channelId) { return db.prepare("SELECT * FROM cards_local WHERE channel_id=? ORDER BY rarity,name").all(channel(channelId)) },
    removeCard(id) { return db.prepare("DELETE FROM cards_local WHERE id=?").run(id).changes > 0 },
    createPack(channelId, input) {
      const id = text(input?.id, 100) || randomUUID()
      const price = Number(input?.price || 0)
      if (!Number.isSafeInteger(price) || price < 0) throw new Error("Precio inválido")
      db.prepare("INSERT INTO card_packs_local(id,channel_id,name,description,price,tier,cards_count) VALUES(?,?,?,?,?,?,?)")
        .run(id, channel(channelId), text(input?.name, 120) || "Sobre", text(input?.description, 1000), price,
          text(input?.tier, 30) || "normal", positiveInteger(input?.cardsCount ?? input?.cards_count ?? 3))
      return db.prepare("SELECT * FROM card_packs_local WHERE id=?").get(id)
    },
    listPacks(channelId) { return db.prepare("SELECT * FROM card_packs_local WHERE channel_id=? ORDER BY price,name").all(channel(channelId)) },
    grantCard(channelId, viewerId, cardId, quantity = 1, key) {
      const qty = positiveInteger(quantity)
      const result = db.prepare(`INSERT INTO viewer_cards_local(channel_id,viewer_id,card_id,quantity) VALUES(?,?,?,?)
        ON CONFLICT(channel_id,viewer_id,card_id) DO UPDATE SET quantity=quantity+excluded.quantity`).run(channel(channelId), viewerId, cardId, qty)
      return { changes: result.changes, idempotencyKey: key }
    },
    getCards(channelId, viewerId) {
      return db.prepare(`SELECT vc.*, c.name,c.description,c.image_path,c.rarity FROM viewer_cards_local vc
        JOIN cards_local c ON c.id=vc.card_id WHERE vc.channel_id=? AND vc.viewer_id=? ORDER BY vc.obtained_at DESC`).all(channel(channelId), viewerId)
    },
    createCosmetic(channelId, input) {
      const id = text(input?.id, 100) || randomUUID()
      db.prepare("INSERT INTO cosmetics_local(id,channel_id,name,type,image_path,color,price) VALUES(?,?,?,?,?,?,?)")
        .run(id, channel(channelId), text(input?.name, 120) || "Cosmético", text(input?.type, 50) || "other", text(input?.imagePath ?? input?.image_url, 1000), text(input?.color, 30), Number(input?.price || 0))
      return db.prepare("SELECT * FROM cosmetics_local WHERE id=?").get(id)
    },
    listCosmetics(channelId) { return db.prepare("SELECT * FROM cosmetics_local WHERE channel_id=? ORDER BY type,name").all(channel(channelId)) },
    grantCosmetic(channelId, viewerId, cosmeticId, key) {
      db.prepare("INSERT OR IGNORE INTO viewer_cosmetics_local(channel_id,viewer_id,cosmetic_id) VALUES(?,?,?)").run(channel(channelId), viewerId, cosmeticId)
      return { idempotencyKey: key }
    },
    getCosmetics(channelId, viewerId) {
      return db.prepare(`SELECT vc.*, c.name,c.type,c.image_path,c.color,c.price FROM viewer_cosmetics_local vc
        JOIN cosmetics_local c ON c.id=vc.cosmetic_id WHERE vc.channel_id=? AND vc.viewer_id=?`).all(channel(channelId), viewerId)
    },
    equipCosmetic(channelId, viewerId, cosmeticId) {
      const ch = channel(channelId)
      return db.transaction(() => {
        const cosmetic = db.prepare("SELECT * FROM cosmetics_local WHERE id=? AND channel_id=?").get(cosmeticId, ch)
        if (!cosmetic) throw new Error("Cosmético no encontrado")
        const owned = db.prepare("SELECT 1 FROM viewer_cosmetics_local WHERE channel_id=? AND viewer_id=? AND cosmetic_id=?").get(ch, viewerId, cosmeticId)
        if (!owned) throw new Error("El viewer no posee este cosmético")
        db.prepare(`UPDATE viewer_cosmetics_local SET equipped=0 WHERE channel_id=? AND viewer_id=? AND cosmetic_id IN
          (SELECT id FROM cosmetics_local WHERE channel_id=? AND type=?)`).run(ch, viewerId, ch, cosmetic.type)
        db.prepare("UPDATE viewer_cosmetics_local SET equipped=1 WHERE channel_id=? AND viewer_id=? AND cosmetic_id=?").run(ch, viewerId, cosmeticId)
        return cosmetic
      })()
    },
    createAchievement(input) {
      const id = text(input?.id, 100) || randomUUID()
      db.prepare("INSERT INTO achievements_local(id,name,description,icon,condition,threshold) VALUES(?,?,?,?,?,?)")
        .run(id, text(input?.name, 120) || "Logro", text(input?.description, 1000), text(input?.icon, 20) || "🏆", text(input?.condition, 50) || "points", Number(input?.threshold || 0))
      return db.prepare("SELECT * FROM achievements_local WHERE id=?").get(id)
    },
    grantAchievement(channelId, viewerId, achievementId, key) {
      db.prepare("INSERT OR IGNORE INTO viewer_achievements_local(channel_id,viewer_id,achievement_id) VALUES(?,?,?)").run(channel(channelId), viewerId, achievementId)
      return { idempotencyKey: key }
    },
    getAchievements(channelId, viewerId) {
      return db.prepare(`SELECT va.*, a.name,a.description,a.icon,a.condition,a.threshold FROM viewer_achievements_local va
        JOIN achievements_local a ON a.id=va.achievement_id WHERE va.channel_id=? AND va.viewer_id=? ORDER BY va.obtained_at DESC`).all(channel(channelId), viewerId)
    },
    listAchievements() { return db.prepare("SELECT * FROM achievements_local ORDER BY threshold,name").all() },
  }

  const shop = {
    createItem(channelId, input) {
      const id = text(input?.id, 100) || randomUUID()
      const price = Number(input?.price)
      if (!Number.isSafeInteger(price) || price < 0) throw new Error("Precio inválido")
      db.prepare(`INSERT INTO shop_items_local(id,channel_id,name,description,item_type,item_ref,price,active,metadata_json)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, channel(channelId), text(input?.name, 120) || "Item", text(input?.description, 1000),
          text(input?.itemType ?? input?.item_type, 50) || "generic", text(input?.itemRef ?? input?.item_ref, 100) || id,
          price, input?.active === false ? 0 : 1, JSON.stringify(input?.metadata || {}))
      return db.prepare("SELECT * FROM shop_items_local WHERE id=?").get(id)
    },
    list(channelId) { return db.prepare("SELECT * FROM shop_items_local WHERE channel_id=? AND active=1 ORDER BY price,name").all(channel(channelId)) },
    purchase(input) {
      const ch = channel(input.channelId)
      const viewerId = text(input.viewerId, 100)
      const itemId = text(input.itemId, 100)
      const key = text(input.idempotencyKey, 240)
      const quantity = positiveInteger(input.quantity || 1)
      if (!key) throw new Error("Se requiere una clave idempotente")
      return db.transaction(() => {
        const existing = db.prepare("SELECT * FROM purchases_local WHERE idempotency_key=?").get(key)
        if (existing) return { ...existing, price: existing.unit_price }
        const item = db.prepare("SELECT * FROM shop_items_local WHERE id=? AND channel_id=? AND active=1").get(itemId, ch)
        if (!item) throw new Error("Item no encontrado")
        const total = item.price * quantity
        applyMovementInside({ channelId: ch, viewerId, balanceDelta: -total, reason: "shop-purchase", idempotencyKey: `ledger:${key}`, sourceType: "shop_item", sourceId: item.id })
        db.prepare(`INSERT INTO inventory_local(channel_id,viewer_id,item_type,item_ref,quantity) VALUES(?,?,?,?,?)
          ON CONFLICT(channel_id,viewer_id,item_type,item_ref) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=datetime('now')`)
          .run(ch, viewerId, item.item_type, item.item_ref, quantity)
        const id = randomUUID()
        db.prepare(`INSERT INTO purchases_local(id,idempotency_key,channel_id,viewer_id,item_id,quantity,unit_price,total_price)
          VALUES(?,?,?,?,?,?,?,?)`).run(id, key, ch, viewerId, item.id, quantity, item.price, total)
        return { ...db.prepare("SELECT * FROM purchases_local WHERE id=?").get(id), price: item.price }
      })()
    },
    inventory(channelId, viewerId) { return db.prepare("SELECT * FROM inventory_local WHERE channel_id=? AND viewer_id=? ORDER BY item_type,item_ref").all(channel(channelId), viewerId) },
  }

  const moderation = {
    setConfig(channelId, key, value) {
      const ch = channel(channelId)
      const configKey = text(key, 80)
      if (!configKey) throw new Error("Clave de moderación inválida")
      db.prepare(`INSERT INTO moderation_config_local(channel_id,config_key,value_json) VALUES(?,?,?)
        ON CONFLICT(channel_id,config_key) DO UPDATE SET value_json=excluded.value_json,updated_at=datetime('now')`)
        .run(ch, configKey, JSON.stringify(value ?? {}))
      return this.getConfig(ch, configKey)
    },
    getConfig(channelId, key) {
      const row = db.prepare("SELECT value_json FROM moderation_config_local WHERE channel_id=? AND config_key=?")
        .get(channel(channelId), text(key, 80))
      return row ? json(row.value_json, {}) : null
    },
    saveWidget(channelId, input) {
      const id = text(input?.id, 100) || randomUUID()
      db.prepare(`INSERT INTO overlay_widgets_local(id,channel_id,type,content,x,y,w,h,visible,config_json)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,content=excluded.content,
        x=excluded.x,y=excluded.y,w=excluded.w,h=excluded.h,visible=excluded.visible,
        config_json=excluded.config_json,updated_at=datetime('now')`)
        .run(id, channel(channelId), text(input?.type, 50) || "text", text(input?.content, 5000),
          Number(input?.x ?? 50), Number(input?.y ?? 50), Number(input?.w ?? 480), Number(input?.h ?? 300),
          input?.visible === false ? 0 : 1, JSON.stringify(input?.config || {}))
      return db.prepare("SELECT * FROM overlay_widgets_local WHERE id=?").get(id)
    },
    listWidgets(channelId) { return db.prepare("SELECT * FROM overlay_widgets_local WHERE channel_id=? ORDER BY updated_at,rowid").all(channel(channelId)) },
    removeWidget(id) { return db.prepare("DELETE FROM overlay_widgets_local WHERE id=?").run(id).changes > 0 },
    openSession(channelId, viewerId) {
      const id = randomUUID()
      db.prepare("INSERT INTO mod_sessions_local(id,channel_id,viewer_id) VALUES(?,?,?)").run(id, channel(channelId), viewerId || null)
      return db.prepare("SELECT * FROM mod_sessions_local WHERE id=?").get(id)
    },
    activeSessions(channelId) {
      return db.prepare(`SELECT s.*,i.username,i.display,i.avatar_url FROM mod_sessions_local s
        LEFT JOIN viewer_identities i ON i.id=s.viewer_id WHERE s.channel_id=? AND s.is_online=1 ORDER BY s.last_seen DESC`).all(channel(channelId))
    },
  }

  const arena = {
    setConfig(channelId, game, config) {
      const ch = channel(channelId)
      const gameName = text(game, 80) || "palabra_bomba"
      db.prepare(`INSERT INTO arena_config_local(channel_id,game,config_json) VALUES(?,?,?)
        ON CONFLICT(channel_id,game) DO UPDATE SET config_json=excluded.config_json,updated_at=datetime('now')`)
        .run(ch, gameName, JSON.stringify(config || {}))
      return this.getConfig(ch, gameName)
    },
    getConfig(channelId, game) {
      const row = db.prepare("SELECT config_json FROM arena_config_local WHERE channel_id=? AND game=?")
        .get(channel(channelId), text(game, 80) || "palabra_bomba")
      return row ? json(row.config_json, {}) : {}
    },
    startSession(channelId, code, game) {
      const id = randomUUID()
      db.prepare(`INSERT INTO arena_sessions_local(id,channel_id,code,game,status,started_at)
        VALUES(?,?,?,?, 'lobby', datetime('now'))`).run(id, channel(channelId), text(code, 20), text(game, 80) || "palabra_bomba")
      return this.getSession(id)
    },
    finishSession(id, input = {}) {
      db.prepare(`UPDATE arena_sessions_local SET status='finished',winner_viewer_id=?,finished_at=datetime('now'),summary_json=? WHERE id=?`)
        .run(input.winnerViewerId || null, JSON.stringify(input.summary || {}), id)
      return this.getSession(id)
    },
    getSession(id) {
      const row = db.prepare("SELECT * FROM arena_sessions_local WHERE id=?").get(id)
      return row ? { ...row, summary: json(row.summary_json, {}) } : undefined
    },
  }

  return { db, identities, economy, mimics, levels, profiles, shop, moderation, arena }
}

module.exports = { createLocalPlatform, xpForLevel, levelFromXp, DEFAULT_TITLES }
