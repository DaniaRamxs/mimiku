const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "t1", username: "kira", display: "Kira" })
  const mimic = platform.mimics.create("canal", { name: "ruleta avatar", sequence: [{ type: "vts_avatar" }] })
  return { db, platform, viewer, mimic }
}

test("se puede borrar un Mimic que ya se usó (antes lo bloqueaba el historial de usos)", () => {
  const { db, platform, viewer, mimic } = setup()
  platform.mimics.grant("canal", viewer.id, mimic.id, 2, "regalo-1")
  platform.mimics.use("canal", viewer.id, mimic.id, "uso-1")
  platform.mimics.trigger("canal", viewer.id, mimic.id, "uso-2")
  assert.ok(db.prepare("SELECT COUNT(*) n FROM mimic_uses_local WHERE mimic_id = ?").get(mimic.id).n > 0)

  assert.equal(platform.mimics.remove(mimic.id), true)

  assert.equal(platform.mimics.list("canal").length, 0)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mimic_uses_local WHERE mimic_id = ?").get(mimic.id).n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM viewer_mimics_local WHERE mimic_id = ?").get(mimic.id).n, 0)
})

test("borrar un Mimic no toca el historial de los demás", () => {
  const { db, platform, viewer, mimic } = setup()
  const other = platform.mimics.create("canal", { name: "flash", sequence: [{ type: "flash" }] })
  platform.mimics.trigger("canal", viewer.id, mimic.id, "uso-a")
  platform.mimics.trigger("canal", viewer.id, other.id, "uso-b")
  platform.mimics.remove(mimic.id)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mimic_uses_local WHERE mimic_id = ?").get(other.id).n, 1)
  assert.equal(platform.mimics.list("canal").length, 1)
})

test("borrar un Mimic que no existe devuelve false", () => {
  const { platform } = setup()
  assert.equal(platform.mimics.remove("no-existe"), false)
})
