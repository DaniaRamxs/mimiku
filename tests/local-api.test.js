const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createLocalApiHandler } = require("../src/services/local-api.js")

test("local API requires pairing token and keeps purchase authority server-side", async () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "api-user", username: "buyer" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: 500, reason: "seed", idempotencyKey: "api:seed" })
  const item = platform.shop.createItem("canal", { name: "Item", itemType: "mimic", itemRef: "m1", price: 300 })
  const server = http.createServer(createLocalApiHandler({ platform, getChannel: () => "canal", token: "pair-token" }))
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const unauthorized = await fetch(`${base}/api/v1/shop/purchase`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: item.id }) })
    assert.equal(unauthorized.status, 401)
    const response = await fetch(`${base}/api/v1/shop/purchase`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mimiku-token": "pair-token", "idempotency-key": "api:purchase" },
      body: JSON.stringify({ itemId: item.id, claimedPrice: 1, identity: { platform: "twitch", platformUserId: "api-user", username: "buyer" } }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).purchase.price, 300)
    assert.equal(platform.economy.getBalance("canal", viewer.id).balance, 200)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})
