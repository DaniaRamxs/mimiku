const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createEconomyService } = require("../src/services/economy.js")

test("local economy works with no cloud configuration or network", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const economy = createEconomyService(createLocalPlatform(db), () => "luna")
  const previousFetch = global.fetch
  global.fetch = () => { throw new Error("network access attempted") }
  try {
    const updated = economy.addPoints("luna", 25, "test", { idempotencyKey: "test:25" })
    assert.equal(updated.points, 25)
    assert.equal(economy.getLog(10).length, 1)
  } finally {
    global.fetch = previousFetch
    db.close()
  }
})

test("deposit keeps wallet and bank ledger atomic", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const economy = createEconomyService(createLocalPlatform(db), () => "canal")
  economy.addPoints("viewer", 100, "seed", { idempotencyKey: "seed:viewer" })
  const result = economy.depositar("viewer", "Viewer", 40)
  assert.equal(result.ok, true)
  assert.equal(economy.getViewer("viewer").points, 60)
  assert.equal(economy.getViewer("viewer").bank, 40)
  db.close()
})
