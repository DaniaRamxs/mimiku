const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createLegacyImporter } = require("../src/services/legacy-importer.js")

test("legacy Supabase import is idempotent and safe to retry", async () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const source = {
    async list(table) {
      const rows = {
        viewers: [{ id: "viewer-1", channel_id: "canal", username: "luna", display: "Luna", points: 500 }],
        mimics: [{ id: "mimic-1", channel_id: "canal", name: "Confeti", sequence: [] }],
        viewer_mimics: [{ id: "owned-1", channel_id: "canal", username: "luna", mimic_id: "mimic-1", quantity: 2 }],
      }
      return rows[table] || []
    },
  }
  const importer = createLegacyImporter({ db, platform, source, tables: ["viewers", "mimics", "viewer_mimics"] })

  const first = await importer.run()
  const second = await importer.run()
  const viewer = platform.identities.byUsername("luna")

  assert.equal(first.imported, 3)
  assert.equal(second.imported, 0)
  assert.equal(second.skipped, 3)
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 500)
  assert.equal(platform.mimics.inventory("canal", viewer.id)[0].quantity, 2)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM import_records").get().count, 3)
  db.close()
})

test("legacy import records row errors and continues", async () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const source = {
    async list(table) {
      if (table === "mimics") return [{ id: "bad", channel_id: "", name: "Broken" }]
      if (table === "cards") return [{ id: "card-1", channel_id: "canal", name: "Good", rarity: "rare" }]
      return []
    },
  }
  const report = await createLegacyImporter({ db, platform, source, tables: ["mimics", "cards"] }).run()
  assert.equal(report.imported, 1)
  assert.equal(report.errors.length, 1)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM import_errors").get().count, 1)
  db.close()
})
