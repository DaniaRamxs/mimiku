const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")

function openMemoryPlatform() {
  const db = new Database(":memory:")
  applyMigrations(db)
  return { db, platform: createLocalPlatform(db) }
}

test("a fresh database works without Supabase or network access", () => {
  const previousFetch = global.fetch
  global.fetch = () => { throw new Error("network disabled") }
  try {
    const { db, platform } = openMemoryPlatform()
    const profile = platform.profiles.getOrCreate("canal", {
      platform: "twitch",
      platformUserId: "1234",
      username: "LunaTV",
      display: "Luna",
    })
    assert.equal(profile.username, "lunatv")
    assert.equal(profile.platform_user_id, "1234")
    assert.equal(platform.economy.getBalance("canal", profile.viewer_id).balance, 0)
    db.close()
  } finally {
    global.fetch = previousFetch
  }
})

test("economy writes balance and ledger atomically and idempotently", () => {
  const { db, platform } = openMemoryPlatform()
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "42", username: "viewer" })

  const first = platform.economy.applyMovement({
    channelId: "canal", viewerId: viewer.id, balanceDelta: 500,
    reason: "seed", idempotencyKey: "seed:42",
  })
  const repeated = platform.economy.applyMovement({
    channelId: "canal", viewerId: viewer.id, balanceDelta: 500,
    reason: "seed", idempotencyKey: "seed:42",
  })

  assert.equal(first.balance, 500)
  assert.equal(repeated.balance, 500)
  assert.equal(platform.economy.listLedger("canal", viewer.id).length, 1)
  assert.throws(() => platform.economy.applyMovement({
    channelId: "canal", viewerId: viewer.id, balanceDelta: -501,
    reason: "overspend", idempotencyKey: "overspend:42",
  }), /saldo insuficiente/i)
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 500)
  db.close()
})

test("Mimics catalog, ownership, uses, gifts, boxes and history are local", () => {
  const { db, platform } = openMemoryPlatform()
  const owner = platform.identities.resolve({ platform: "twitch", platformUserId: "1", username: "owner" })
  const receiver = platform.identities.resolve({ platform: "twitch", platformUserId: "2", username: "receiver" })
  const mimic = platform.mimics.create("canal", { name: "Confeti", sequence: [{ type: "effect", effect: "confetti" }] })
  const box = platform.mimics.createBox("canal", { name: "Caja", mimicCount: 2 })

  platform.mimics.grant("canal", owner.id, mimic.id, 2, "grant:owner")
  const use = platform.mimics.use("canal", owner.id, mimic.id, "use:1")
  const repeated = platform.mimics.use("canal", owner.id, mimic.id, "use:1")
  platform.mimics.gift("canal", owner.id, receiver.id, mimic.id, 1, "gift:1")

  assert.equal(use.id, repeated.id)
  assert.equal(platform.mimics.inventory("canal", owner.id)[0].quantity, 0)
  assert.equal(platform.mimics.inventory("canal", receiver.id)[0].quantity, 1)
  assert.equal(platform.mimics.listBoxes("canal")[0].id, box.id)
  assert.equal(platform.mimics.history("canal").length, 3)
  db.close()
})

test("levels configuration, XP, titles and progression survive locally", () => {
  const { db, platform } = openMemoryPlatform()
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "7", username: "xpviewer" })
  platform.levels.setConfig("canal", { xpPerMessage: 8, levelUpReward: 10 })
  platform.levels.saveTitles("canal", [{ minLevel: 1, title: "Inicio", color: "#fff", icon: "S" }])
  const result = platform.levels.addXp("canal", viewer.id, 150, "test")

  assert.equal(result.xp, 150)
  assert.equal(result.level, 2)
  assert.equal(platform.levels.getConfig("canal").xp_per_message, 8)
  assert.equal(platform.levels.getTitles("canal")[0].title, "Inicio")
  db.close()
})

test("shop trusts the stored price and completes purchase atomically", () => {
  const { db, platform } = openMemoryPlatform()
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "9", username: "buyer" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: 1000, reason: "seed", idempotencyKey: "seed:buyer" })
  const item = platform.shop.createItem("canal", { name: "Mimic", itemType: "mimic", itemRef: "m-1", price: 400 })

  const purchase = platform.shop.purchase({
    channelId: "canal", viewerId: viewer.id, itemId: item.id,
    claimedPrice: 1, idempotencyKey: "purchase:one",
  })
  const repeated = platform.shop.purchase({
    channelId: "canal", viewerId: viewer.id, itemId: item.id,
    claimedPrice: 1, idempotencyKey: "purchase:one",
  })

  assert.equal(purchase.price, 400)
  assert.equal(repeated.id, purchase.id)
  assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 600)
  assert.equal(platform.shop.inventory("canal", viewer.id)[0].quantity, 1)
  assert.equal(platform.economy.listLedger("canal", viewer.id).filter(x => x.reason === "shop-purchase").length, 1)
  assert.throws(() => platform.shop.purchase({
    channelId: "canal", viewerId: viewer.id, itemId: item.id,
    idempotencyKey: "purchase:two", quantity: 2,
  }), /saldo insuficiente/i)
  db.close()
})

test("profiles, cards, cosmetics and achievements use stable viewer identity", () => {
  const { db, platform } = openMemoryPlatform()
  const profile = platform.profiles.getOrCreate("canal", {
    platform: "twitch", platformUserId: "stable-10", username: "before", display: "Before",
  })
  const renamed = platform.profiles.getOrCreate("canal", {
    platform: "twitch", platformUserId: "stable-10", username: "after", display: "After",
  })
  const card = platform.profiles.createCard("canal", { name: "Carta", rarity: "rare" })
  const cosmetic = platform.profiles.createCosmetic("canal", { name: "Marco", type: "frame", price: 0 })
  const achievement = platform.profiles.createAchievement({ name: "Primero", condition: "points", threshold: 0 })
  platform.profiles.grantCard("canal", renamed.viewer_id, card.id, 1, "card:1")
  platform.profiles.grantCosmetic("canal", renamed.viewer_id, cosmetic.id, "cosmetic:1")
  platform.profiles.grantAchievement("canal", renamed.viewer_id, achievement.id, "achievement:1")

  assert.equal(renamed.viewer_id, profile.viewer_id)
  assert.equal(renamed.username, "after")
  assert.equal(platform.profiles.getCards("canal", renamed.viewer_id).length, 1)
  assert.equal(platform.profiles.getCosmetics("canal", renamed.viewer_id).length, 1)
  assert.equal(platform.profiles.getAchievements("canal", renamed.viewer_id).length, 1)
  db.close()
})

test("local data persists after reopening the database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mimiku-local-first-"))
  const dbPath = path.join(dir, "mimiku.db")
  let db = new Database(dbPath)
  applyMigrations(db)
  let platform = createLocalPlatform(db)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "persist", username: "persistent" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: 321, reason: "persist", idempotencyKey: "persist:1" })
  db.close()

  db = new Database(dbPath)
  applyMigrations(db)
  platform = createLocalPlatform(db)
  const sameViewer = platform.identities.resolve({ platform: "twitch", platformUserId: "persist", username: "persistent" })
  assert.equal(platform.economy.getBalance("canal", sameViewer.id).balance, 321)
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test("moderation rules, commands and widgets persist locally", () => {
  const { db, platform } = openMemoryPlatform()
  platform.moderation.setConfig("canal", "rules", { blockedWords: ["spam"] })
  platform.moderation.setConfig("canal", "commands", { hello: "Hola" })
  const widget = platform.moderation.saveWidget("canal", { id: "widget-1", type: "text", content: "Hola" })
  assert.deepEqual(platform.moderation.getConfig("canal", "rules"), { blockedWords: ["spam"] })
  assert.equal(platform.moderation.listWidgets("canal")[0].id, widget.id)
  db.close()
})

test("Arena persists configuration and match summary but not transient turn state", () => {
  const { db, platform } = openMemoryPlatform()
  platform.arena.setConfig("canal", "palabra_bomba", { lives: 3 })
  const session = platform.arena.startSession("canal", "ABCDE", "palabra_bomba")
  platform.arena.finishSession(session.id, { winnerViewerId: null, summary: { rounds: 4 } })
  const saved = platform.arena.getSession(session.id)
  assert.deepEqual(platform.arena.getConfig("canal", "palabra_bomba"), { lives: 3 })
  assert.deepEqual(saved.summary, { rounds: 4 })
  assert.equal(Object.hasOwn(saved, "turnEndsAt"), false)
  db.close()
})
