const fs = require("node:fs")
const path = require("node:path")

function createBackupService({ getDatabase, databasePath, backupDirectory, now = () => new Date(), maxBackups = 5 }) {
  const root = path.resolve(backupDirectory)
  const source = path.resolve(databasePath)

  function ensureDirectory() { fs.mkdirSync(root, { recursive: true }) }

  function checkIntegrity() {
    const rows = getDatabase().pragma("quick_check")
    const result = String(rows?.[0]?.quick_check || rows?.[0]?.integrity_check || "unknown")
    return { ok: result.toLowerCase() === "ok", result }
  }

  function listBackups() {
    ensureDirectory()
    return fs.readdirSync(root)
      .filter(name => /^mimiku-[a-z]+-\d{8}T\d{6}(?:-\d+)?Z\.db$/i.test(name))
      .map(name => {
        const absolute = path.join(root, name)
        const stats = fs.statSync(absolute)
        return { name, path: absolute, size: stats.size, createdAt: stats.mtime.toISOString() }
      })
      .sort((a, b) => b.name.localeCompare(a.name))
  }

  function rotate() {
    for (const backup of listBackups().slice(maxBackups)) fs.rmSync(backup.path, { force: true })
  }

  async function createBackup(reason = "manual") {
    const integrity = checkIntegrity()
    if (!integrity.ok) throw new Error(`La base de datos no pasó quick_check: ${integrity.result}`)
    ensureDirectory()
    const timestamp = now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
    const safeReason = String(reason).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24) || "manual"
    let name = `mimiku-${safeReason}-${timestamp}.db`
    let destination = path.join(root, name)
    let suffix = 1
    while (fs.existsSync(destination)) {
      name = `mimiku-${safeReason}-${timestamp.replace(/Z$/, `-${suffix++}Z`)}.db`
      destination = path.join(root, name)
    }
    await getDatabase().backup(destination)
    rotate()
    return listBackups().find(item => item.name === name)
  }

  function queueRestore(name) {
    const safeName = path.basename(String(name || ""))
    const selected = path.join(root, safeName)
    if (safeName !== name || !fs.existsSync(selected)) throw new Error("Copia de seguridad no encontrada")
    const pending = `${source}.restore-next-start`
    fs.copyFileSync(selected, pending)
    return { queued: true, name: safeName }
  }

  function applyPendingRestore() {
    const pending = `${source}.restore-next-start`
    if (!fs.existsSync(pending)) return false
    if (fs.existsSync(source)) fs.copyFileSync(source, `${source}.before-restore`)
    fs.copyFileSync(pending, source)
    fs.rmSync(pending, { force: true })
    return true
  }

  return { checkIntegrity, listBackups, createBackup, queueRestore, applyPendingRestore }
}

let defaultService = null
function getDefaultBackupService() {
  if (!defaultService) {
    const { app } = require("electron")
    const database = require("./db.js")
    defaultService = createBackupService({
      getDatabase: database.getDb,
      databasePath: database.getPath(),
      backupDirectory: path.join(app.getPath("userData"), "backups"),
    })
  }
  return defaultService
}

module.exports = { createBackupService, getDefaultBackupService }
