// services/db.js — solo se ejecuta en el main process
const Database = require("better-sqlite3")
const path = require("path")
const { app } = require("electron")
const { applyMigrations } = require("../db/migrations.js")

// La DB va en la carpeta de datos del usuario (siempre escribible).
// En una app empaquetada, __dirname está dentro del app.asar (solo lectura),
// así que NO se puede crear la DB ahí. userData es la ruta correcta.
const dbPath = path.join(app.getPath("userData"), "mimiku-data.db")

let _db = null

function getDb() {
  if (_db) return _db
  _db = new Database(dbPath)
  _db.pragma("journal_mode = WAL")
  _db.pragma("busy_timeout = 5000")
  _db.pragma("foreign_keys = ON")

  _db.exec(`
    CREATE TABLE IF NOT EXISTS viewers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    UNIQUE NOT NULL,
      display     TEXT    NOT NULL DEFAULT '',
      points      INTEGER NOT NULL DEFAULT 0,
      bank        INTEGER NOT NULL DEFAULT 0,
      messages    INTEGER NOT NULL DEFAULT 0,
      last_seen   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS economy_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL,
      delta       INTEGER NOT NULL,
      reason      TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS cooldowns (
      username  TEXT    NOT NULL,
      action    TEXT    NOT NULL,
      last_used TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (username, action)
    );
  `)

  // agregar columna bank si no existe (para DBs ya creadas)
  try {
    _db.exec(`ALTER TABLE viewers ADD COLUMN bank INTEGER NOT NULL DEFAULT 0`)
  } catch {}

  applyMigrations(_db)

  return _db
}

module.exports = { getDb }
