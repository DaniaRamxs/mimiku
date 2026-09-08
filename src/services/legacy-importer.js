// Importador unidireccional e idempotente desde Mimiku 1 / Supabase.
const { randomUUID } = require("node:crypto")

const DEFAULT_TABLES = [
  "viewers", "mimics", "mimic_boxes", "viewer_mimics", "level_config", "viewer_levels", "level_titles",
  "viewer_profiles", "cards", "card_packs", "viewer_cards", "cosmetics", "viewer_cosmetics",
  "achievements", "viewer_achievements", "shop_items", "overlay_widgets", "arena_rooms",
]

function sourceId(table, row) {
  return String(row.id ?? row.code ?? row.channel_id ?? `${table}:${row.username || row.name || randomUUID()}`)
}

function legacyIdentity(platform, row) {
  return platform.identities.resolve({
    platform: "twitch",
    platformUserId: row.twitch_user_id || row.platform_user_id || "",
    username: row.username || row.user_login || "unknown",
    display: row.display || row.display_name || row.username || "",
    avatarUrl: row.avatar_url || "",
  })
}

function createLegacyImporter({ db, platform, source, tables = DEFAULT_TABLES }) {
  function alreadyImported(table, id) {
    return !!db.prepare("SELECT 1 FROM import_records WHERE source='supabase' AND source_table=? AND source_id=?").get(table, id)
  }

  function markImported(table, id, target) {
    db.prepare(`INSERT INTO import_records(source,source_table,source_id,local_table,local_id)
      VALUES('supabase',?,?,?,?)`).run(table, id, target.table, String(target.id))
  }

  function importRow(table, row) {
    const ch = row.channel_id || ""
    if (table !== "achievements" && !ch) throw new Error("El registro no contiene channel_id")
    switch (table) {
      case "viewers": {
        const viewer = legacyIdentity(platform, row)
        const amount = Math.max(0, Math.trunc(Number(row.points) || 0))
        platform.economy.applyMovement({ channelId: ch, viewerId: viewer.id, balanceDelta: amount, reason: "legacy-import", idempotencyKey: `import:viewers:${sourceId(table, row)}` })
        return { table: "viewer_identities", id: viewer.id }
      }
      case "mimics": {
        const existing = platform.mimics.get(String(row.id))
        const mimic = existing || platform.mimics.create(ch, { ...row, id: String(row.id), assetPath: row.asset_path || "" })
        return { table: "mimics_local", id: mimic.id }
      }
      case "mimic_boxes": {
        const existing = db.prepare("SELECT id FROM mimic_boxes_local WHERE id=?").get(String(row.id))
        const box = existing || platform.mimics.createBox(ch, { ...row, id: String(row.id) })
        return { table: "mimic_boxes_local", id: box.id }
      }
      case "viewer_mimics": {
        const viewer = legacyIdentity(platform, row)
        platform.mimics.grant(ch, viewer.id, String(row.mimic_id), Math.max(1, Number(row.quantity) || 1), `import:viewer_mimics:${sourceId(table, row)}`)
        return { table: "viewer_mimics_local", id: `${viewer.id}:${row.mimic_id}` }
      }
      case "level_config": {
        platform.levels.setConfig(ch, row)
        return { table: "level_config_local", id: ch }
      }
      case "viewer_levels": {
        const viewer = legacyIdentity(platform, row)
        platform.levels.addXp(ch, viewer.id, Math.max(1, Number(row.xp) || 0), "legacy-import")
        return { table: "viewer_levels_local", id: viewer.id }
      }
      case "level_titles": {
        const current = platform.levels.getTitles(ch).filter(item => !item.id)
        platform.levels.saveTitles(ch, [...current, row])
        return { table: "level_titles_local", id: row.id }
      }
      case "viewer_profiles": {
        const viewer = legacyIdentity(platform, row)
        platform.profiles.getOrCreate(ch, { platform: viewer.platform, platformUserId: viewer.platform_user_id, username: viewer.username, display: viewer.display, avatarUrl: viewer.avatar_url })
        platform.profiles.update(ch, viewer.id, row)
        return { table: "viewer_profiles_local", id: viewer.id }
      }
      case "cards": {
        const card = platform.profiles.createCard(ch, { ...row, id: String(row.id), imagePath: row.image_url || row.image_path })
        return { table: "cards_local", id: card.id }
      }
      case "card_packs": {
        const pack = platform.profiles.createPack(ch, { ...row, id: String(row.id) })
        return { table: "card_packs_local", id: pack.id }
      }
      case "viewer_cards": {
        const viewer = legacyIdentity(platform, row)
        platform.profiles.grantCard(ch, viewer.id, String(row.card_id), Math.max(1, Number(row.quantity) || 1), `import:${table}:${sourceId(table, row)}`)
        return { table: "viewer_cards_local", id: `${viewer.id}:${row.card_id}` }
      }
      case "cosmetics": {
        const cosmetic = platform.profiles.createCosmetic(ch, { ...row, id: String(row.id), imagePath: row.image_url || row.image_path })
        return { table: "cosmetics_local", id: cosmetic.id }
      }
      case "viewer_cosmetics": {
        const viewer = legacyIdentity(platform, row)
        platform.profiles.grantCosmetic(ch, viewer.id, String(row.cosmetic_id), `import:${table}:${sourceId(table, row)}`)
        return { table: "viewer_cosmetics_local", id: `${viewer.id}:${row.cosmetic_id}` }
      }
      case "achievements": {
        const achievement = platform.profiles.createAchievement({ ...row, id: String(row.id) })
        return { table: "achievements_local", id: achievement.id }
      }
      case "viewer_achievements": {
        const viewer = legacyIdentity(platform, row)
        platform.profiles.grantAchievement(ch, viewer.id, String(row.achievement_id), `import:${table}:${sourceId(table, row)}`)
        return { table: "viewer_achievements_local", id: `${viewer.id}:${row.achievement_id}` }
      }
      case "shop_items": {
        const item = platform.shop.createItem(ch, { ...row, id: String(row.id), itemType: row.item_type || row.type, itemRef: row.item_ref || String(row.id) })
        return { table: "shop_items_local", id: item.id }
      }
      case "overlay_widgets": {
        const widget = platform.moderation.saveWidget(ch, { ...row, id: String(row.id) })
        return { table: "overlay_widgets_local", id: widget.id }
      }
      case "arena_rooms": {
        platform.arena.setConfig(ch, row.game || "palabra_bomba", row.config || {})
        return { table: "arena_config_local", id: `${ch}:${row.game || "palabra_bomba"}` }
      }
      default:
        throw new Error(`Tabla no soportada: ${table}`)
    }
  }

  async function run() {
    const runId = randomUUID()
    const report = { runId, imported: 0, skipped: 0, errors: [], tables: {} }
    db.prepare("INSERT INTO import_runs(id,source,status) VALUES(?,'supabase','running')").run(runId)
    for (const table of tables) {
      report.tables[table] = { imported: 0, skipped: 0, errors: 0 }
      let rows
      try { rows = await source.list(table) } catch (error) {
        const item = { table, sourceId: "", message: error.message }
        report.errors.push(item)
        report.tables[table].errors++
        db.prepare("INSERT INTO import_errors(id,run_id,source_table,message) VALUES(?,?,?,?)").run(randomUUID(), runId, table, error.message)
        continue
      }
      for (const row of rows || []) {
        const id = sourceId(table, row)
        if (alreadyImported(table, id)) {
          report.skipped++
          report.tables[table].skipped++
          continue
        }
        try {
          const target = db.transaction(() => {
            const result = importRow(table, row)
            markImported(table, id, result)
            return result
          })()
          report.imported++
          report.tables[table].imported++
          void target
        } catch (error) {
          const item = { table, sourceId: id, message: error.message }
          report.errors.push(item)
          report.tables[table].errors++
          db.prepare("INSERT INTO import_errors(id,run_id,source_table,source_id,message) VALUES(?,?,?,?,?)")
            .run(randomUUID(), runId, table, id, error.message)
        }
      }
    }
    const status = report.errors.length ? "completed_with_errors" : "completed"
    db.prepare("UPDATE import_runs SET status=?,completed_at=datetime('now'),report_json=? WHERE id=?")
      .run(status, JSON.stringify(report), runId)
    return report
  }

  return { run }
}

function createSupabaseSource(client) {
  return {
    async list(table) {
      const rows = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client.from(table).select("*").range(from, from + 999)
        if (error) throw new Error(error.message)
        rows.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      return rows
    },
  }
}

async function importFromConfiguredSupabase() {
  const platform = require("./local-runtime.js").getLocalPlatform()
  const client = require("./supabase.js").getConfiguredClient()
  return createLegacyImporter({ db: platform.db, platform, source: createSupabaseSource(client) }).run()
}

module.exports = { DEFAULT_TABLES, createLegacyImporter, createSupabaseSource, importFromConfiguredSupabase }
