const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { createBackupService } = require("../src/services/backups.js")

test("backup service creates, lists and rotates local SQLite backups", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mimiku-backups-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dbPath = path.join(root, "mimiku-data.db")
  fs.writeFileSync(dbPath, "source")
  let sequence = 0
  const database = {
    pragma: value => value === "quick_check" ? [{ quick_check: "ok" }] : [],
    async backup(destination) { fs.copyFileSync(dbPath, destination) },
  }
  const service = createBackupService({
    getDatabase: () => database,
    databasePath: dbPath,
    backupDirectory: path.join(root, "backups"),
    now: () => new Date(`2026-01-01T00:00:0${sequence++}Z`),
    maxBackups: 2,
  })

  await service.createBackup("manual")
  await service.createBackup("manual")
  await service.createBackup("manual")
  const backups = service.listBackups()
  assert.equal(backups.length, 2)
  assert.ok(backups.every(item => item.name.endsWith(".db")))
  assert.deepEqual(service.checkIntegrity(), { ok: true, result: "ok" })
})

test("backup names remain valid when two copies share the same timestamp", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mimiku-backup-collision-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dbPath = path.join(root, "mimiku-data.db")
  fs.writeFileSync(dbPath, "source")
  const database = {
    pragma: () => [{ quick_check: "ok" }],
    async backup(destination) { fs.copyFileSync(dbPath, destination) },
  }
  const service = createBackupService({
    getDatabase: () => database,
    databasePath: dbPath,
    backupDirectory: path.join(root, "backups"),
    now: () => new Date("2026-01-01T00:00:00Z"),
  })

  await service.createBackup("manual")
  await service.createBackup("manual")
  assert.deepEqual(service.listBackups().map(item => item.name).sort(), [
    "mimiku-manual-20260101T000000-1Z.db",
    "mimiku-manual-20260101T000000Z.db",
  ])
})
