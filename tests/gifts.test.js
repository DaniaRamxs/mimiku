const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations, MIGRATIONS } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createGiftService, monthKeyOf } = require("../src/services/gifts.js")
const { createEconomyService } = require("../src/services/economy.js")

function setup({ now } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const economy = createEconomyService(platform, () => "canal")
  const service = createGiftService({
    platform, addPointsFor: economy.addPointsFor, getChannel: () => "canal", now, log: { error() {} },
  })
  return { db, platform, economy, service }
}

function giftEvent({ comboId = "c1", coins = 100, count = 10, giftId = "5655", userId = "777", username = "luna", platform = "tiktok" } = {}) {
  return {
    platform, type: "gift",
    actor: { platformUserId: userId, username, displayName: username, avatarUrl: "" },
    payload: { comboId, coins, count, giftId, giftName: "Rosa", unitCoins: coins / count },
  }
}

test("la migracion v3 es idempotente y se puede reejecutar sobre una base existente", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  applyMigrations(db)
  const v3 = MIGRATIONS.find(migration => migration.version === 3)
  // Simula una base de beta donde la columna ya existia pero v3 no constaba como aplicada.
  db.transaction(() => v3.up(db))()
  const columns = db.prepare("PRAGMA table_info(viewer_identities)").all().filter(c => c.name === "person_id")
  assert.equal(columns.length, 1)
})

test("un regalo suma puntos por la tasa por defecto y queda registrado", () => {
  const { db, service, economy } = setup()
  const result = service.handleGift(giftEvent({ coins: 100 }))
  assert.equal(result.points, 100)
  assert.equal(economy.getViewer("luna", "tiktok").points, 100)
  const donation = db.prepare("SELECT * FROM donations").get()
  assert.equal(donation.coins, 100)
  assert.equal(donation.gift_name, "Rosa")
  assert.equal(donation.month_key, monthKeyOf(new Date()))
})

test("la tasa especifica de un regalo gana a la general", () => {
  const { service, economy } = setup()
  service.setRate({ platform: "tiktok", pointsPerCoin: 2 })
  service.setRate({ platform: "tiktok", giftId: "5655", pointsPerCoin: 10 })
  service.handleGift(giftEvent({ comboId: "a", coins: 10, giftId: "5655" }))
  service.handleGift(giftEvent({ comboId: "b", coins: 10, giftId: "other" }))
  assert.equal(economy.getViewer("luna", "tiktok").points, 100 + 20)
})

test("reprocesar el mismo combo no duplica puntos ni donacion", () => {
  const { db, service, economy } = setup()
  service.handleGift(giftEvent())
  const again = service.handleGift(giftEvent())
  assert.equal(again.duplicate, true)
  assert.equal(economy.getViewer("luna", "tiktok").points, 100)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM donations").get().n, 1)
})

test("las cuentas no se unifican entre plataformas", () => {
  const { service, economy } = setup()
  service.handleGift(giftEvent({ comboId: "x", platform: "tiktok" }))
  assert.equal(economy.getViewer("luna", "twitch"), undefined)
})

test("no se otorga nada a una plataforma desconocida", () => {
  const { db, service } = setup()
  assert.equal(service.handleGift(giftEvent({ platform: "unknown" })).skipped, "plataforma-desconocida")
  assert.equal(db.prepare("SELECT COUNT(*) n FROM donations").get().n, 0)
})

test("una regla por tipo de regalo dispara el Mimic aunque la cantidad sea 1", () => {
  const { db, platform, service } = setup()
  const mimic = platform.mimics.create("canal", { name: "Fuegos" })
  service.addRule({ giftId: "5655", minCount: 1, mimicId: mimic.id })
  const result = service.handleGift(giftEvent({ count: 1, coins: 1 }))
  assert.equal(result.triggered, 1)
  const use = db.prepare("SELECT * FROM mimic_uses_local").get()
  assert.equal(use.status, "pending")
  assert.equal(use.mimic_id, mimic.id)
})

test("la cantidad minima se evalua contra el total del combo", () => {
  const { db, platform, service } = setup()
  const mimic = platform.mimics.create("canal", { name: "Lluvia" })
  service.addRule({ giftId: "*", minCount: 10, mimicId: mimic.id })
  service.handleGift(giftEvent({ comboId: "small", count: 9, coins: 9 }))
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mimic_uses_local").get().n, 0)
  service.handleGift(giftEvent({ comboId: "big", count: 10, coins: 10 }))
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mimic_uses_local").get().n, 1)
})

test("los puntos se dan aunque no exista ninguna regla de Mimic", () => {
  const { db, service, economy } = setup()
  const result = service.handleGift(giftEvent({ coins: 50 }))
  assert.equal(result.triggered, 0)
  assert.equal(economy.getViewer("luna", "tiktok").points, 50)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mimic_uses_local").get().n, 0)
})

test("una regla desactivada no dispara", () => {
  const { db, platform, service } = setup()
  const mimic = platform.mimics.create("canal", { name: "Nada" })
  const [rule] = service.addRule({ mimicId: mimic.id })
  service.setRuleEnabled(rule.id, false)
  service.handleGift(giftEvent())
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mimic_uses_local").get().n, 0)
})

test("rechaza tasas y cantidades invalidas", () => {
  const { service, platform } = setup()
  assert.throws(() => service.setRate({ platform: "tiktok", pointsPerCoin: -1 }), /inv/)
  assert.throws(() => service.setRate({ platform: "nope", pointsPerCoin: 1 }), /Plataforma/)
  const mimic = platform.mimics.create("canal", { name: "X" })
  assert.throws(() => service.addRule({ mimicId: mimic.id, minCount: 0 }), /nima/)
  assert.throws(() => service.addRule({ mimicId: "no-existe" }), /no encontrado/)
})
