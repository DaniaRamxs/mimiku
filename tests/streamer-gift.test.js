// Fase 1.5 — corrige mimics.js#streamerGift para que reparta Mimics usando
// la identidad real (platform + platformUserId) de cada viewer activo, en
// vez de asumir siempre "twitch".
const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { getDefaultActivityTracker } = require("../src/core/interactions/activity-consumer.js")

// mimics.js requiere src/services/local-runtime.js, que en producción abre
// la DB real vía Electron. Se stubea su module cache con un
// getLocalPlatform() que devuelve la instancia de SQLite en memoria de este
// test, y se recarga mimics.js en limpio — misma técnica que en la Fase 1.45.
function loadMimicsWithPlatform(platform) {
  const runtimePath = require.resolve("../src/services/local-runtime.js")
  const mimicsPath = require.resolve("../src/services/mimics.js")

  const saved = require.cache[runtimePath]
  require.cache[runtimePath] = { id: runtimePath, filename: runtimePath, loaded: true, exports: { getLocalPlatform: () => platform } }
  delete require.cache[mimicsPath]

  const mimics = require("../src/services/mimics.js")

  if (saved) require.cache[runtimePath] = saved; else delete require.cache[runtimePath]
  delete require.cache[mimicsPath]

  return mimics
}

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  return { db, platform }
}

function chatEvent(platform, actor, text = "hola") {
  return { platform, type: "chat_message", actor, message: { text } }
}

test("15-16: streamerGift entrega a cada viewer activo usando SU identidad real (Twitch y YouTube)", async () => {
  const { db, platform } = setup()
  const mimics = loadMimicsWithPlatform(platform)
  const mimic = platform.mimics.create("canal", { name: "Confeti", sequence: [] })

  const tracker = getDefaultActivityTracker()
  tracker.reset()
  tracker.recordMessage(chatEvent("twitch", { platformUserId: "tw-1", username: "luna", displayName: "Luna" }))
  tracker.recordMessage(chatEvent("youtube", { platformUserId: "yt-1", username: "bob", displayName: "Bob" }))

  const result = await mimics.streamerGift("canal", { mimicId: mimic.id, target: "all" })
  assert.equal(result.count, 2)

  const twRow = db.prepare("SELECT id FROM viewer_identities WHERE platform='twitch' AND platform_user_id='tw-1'").get()
  const ytRow = db.prepare("SELECT id FROM viewer_identities WHERE platform='youtube' AND platform_user_id='yt-1'").get()
  assert.ok(twRow)
  assert.ok(ytRow)
  assert.ok(platform.mimics.inventory("canal", twRow.id).some(m => m.mimic_id === mimic.id))
  assert.ok(platform.mimics.inventory("canal", ytRow.id).some(m => m.mimic_id === mimic.id))

  tracker.reset()
  db.close()
})

test("17: streamerGift no crea accidentalmente una identidad Twitch para un viewer de YouTube", async () => {
  const { db, platform } = setup()
  const mimics = loadMimicsWithPlatform(platform)
  const mimic = platform.mimics.create("canal", { name: "Confeti", sequence: [] })

  const tracker = getDefaultActivityTracker()
  tracker.reset()
  tracker.recordMessage(chatEvent("youtube", { platformUserId: "yt-1", username: "bob", displayName: "Bob" }))

  await mimics.streamerGift("canal", { mimicId: mimic.id, target: "all" })

  const twRow = db.prepare("SELECT id FROM viewer_identities WHERE platform='twitch' AND username='bob'").get()
  assert.equal(twRow, undefined)

  tracker.reset()
  db.close()
})

test("Fase 1.6: streamerGift target:'user' usa la identidad completa elegida (no un username de texto libre)", async () => {
  const { db, platform } = setup()
  const mimics = loadMimicsWithPlatform(platform)
  const mimic = platform.mimics.create("canal", { name: "Confeti", sequence: [] })

  await mimics.streamerGift("canal", {
    mimicId: mimic.id, target: "user",
    toIdentity: { platform: "youtube", platformUserId: "yt-42", username: "bob" },
  })

  const ytRow = db.prepare("SELECT id FROM viewer_identities WHERE platform='youtube' AND platform_user_id='yt-42'").get()
  const twRow = db.prepare("SELECT id FROM viewer_identities WHERE platform='twitch' AND username='bob'").get()
  assert.ok(ytRow, "debe regalarse a la identidad YouTube indicada")
  assert.equal(twRow, undefined, "no debe crear una identidad Twitch para este viewer")
  assert.ok(platform.mimics.inventory("canal", ytRow.id).some(m => m.mimic_id === mimic.id))

  db.close()
})
