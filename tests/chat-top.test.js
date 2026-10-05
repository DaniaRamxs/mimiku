const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createStreamSessions } = require("../src/services/stream-sessions.js")
const { createChatTopService } = require("../src/services/chat-top.js")

const HOUR = 3_600_000

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const clock = { current: new Date(2026, 8, 28, 18, 0, 0) }
  const live = { value: null }
  const sessions = createStreamSessions({
    db, getChannel: () => "canal", now: () => clock.current, liveStatus: () => live.value, getGapHours: () => 3,
  })
  const changes = []
  // debounceMs 0 + flush(): las pruebas no esperan temporizadores reales.
  const service = createChatTopService({ db, sessions, now: () => clock.current, onChange: snap => changes.push(snap), debounceMs: 0 })
  const advance = ms => { clock.current = new Date(clock.current.getTime() + ms) }
  return { db, sessions, service, changes, clock, live, advance }
}

function chat(username, text = "hola", overrides = {}) {
  return {
    platform: "twitch", type: "chat_message",
    actor: { platformUserId: `id-${username}`, username, displayName: username.toUpperCase(), ...overrides },
    message: { text },
  }
}

function send(service, advance, username, count, text) {
  for (let index = 0; index < count; index++) {
    service.recordMessage(chat(username, text))
    advance(1000)
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 5))
const names = snapshot => snapshot.entries.map(entry => entry.username)

test("la migracion v7 crea chat_top_counts", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  applyMigrations(db)
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='chat_top_counts'").get())
})

test("sin mensajes el top esta vacio", () => {
  const { service } = setup()
  assert.deepEqual(service.snapshot().entries, [])
})

test("ordena por mensajes y solo muestra 3", () => {
  const { service, advance } = setup()
  send(service, advance, "ana", 2)
  send(service, advance, "bea", 5)
  send(service, advance, "cai", 3)
  send(service, advance, "dan", 1)
  const snapshot = service.snapshot()
  assert.deepEqual(names(snapshot), ["bea", "cai", "ana"])
  assert.deepEqual(snapshot.entries.map(entry => entry.messages), [5, 3, 2])
  assert.equal(snapshot.entries[0].name, "BEA")
})

test("a igual numero va primero quien llego antes a esa cifra", () => {
  const { service, advance } = setup()
  send(service, advance, "ana", 3)
  send(service, advance, "bea", 3)
  assert.deepEqual(names(service.snapshot()).slice(0, 2), ["ana", "bea"])
})

test("los comandos no cuentan", () => {
  const { service, advance } = setup()
  send(service, advance, "ana", 4, "!claim")
  send(service, advance, "bea", 1)
  assert.deepEqual(names(service.snapshot()), ["bea"])
})

test("el mismo nombre en dos plataformas son viewers distintos", () => {
  const { service } = setup()
  service.recordMessage(chat("luna"))
  service.recordMessage({ ...chat("luna"), platform: "tiktok" })
  assert.equal(service.snapshot().entries.length, 2)
})

test("se reinicia al empezar un directo nuevo tras el hueco sin chat", () => {
  const { service, advance } = setup()
  send(service, advance, "ana", 5)
  advance(4 * HOUR)
  service.recordMessage(chat("bea"))
  const snapshot = service.snapshot()
  assert.deepEqual(names(snapshot), ["bea"])
  assert.equal(snapshot.entries[0].messages, 1)
})

test("con Twitch en vivo, cada stream tiene su propio top", () => {
  const { service, live, advance } = setup()
  live.value = { live: true, streamId: "A", startedAt: new Date(2026, 8, 28, 10).toISOString() }
  send(service, advance, "ana", 3)
  live.value = { live: true, streamId: "B", startedAt: new Date(2026, 8, 28, 18, 30).toISOString() }
  service.recordMessage(chat("bea"))
  assert.deepEqual(names(service.snapshot()), ["bea"])
})

test("empezar un directo a mano vacia el top y avisa al overlay", async () => {
  const { service, sessions, changes, advance } = setup()
  send(service, advance, "ana", 2)
  await flush()
  sessions.startNew()
  assert.deepEqual(changes.at(-1).entries, [])
  assert.deepEqual(service.snapshot().entries, [])
})

test("solo avisa cuando el top cambia y agrupa rafagas", async () => {
  const { service, changes, advance } = setup()
  send(service, advance, "ana", 3)
  await flush()
  // El primer mensaje abre el directo (aviso con el top vacio); despues, un
  // solo aviso para los 3 mensajes seguidos.
  assert.deepEqual(changes.map(change => change.entries.length), [0, 1])
  assert.equal(changes[1].entries[0].messages, 3)
  // Un 4o viewer con 1 mensaje no entra: el top no cambia y no hay aviso.
  send(service, advance, "bea", 1)
  send(service, advance, "cai", 1)
  await flush()
  const before = changes.length
  send(service, advance, "dan", 1)
  await flush()
  assert.equal(changes.length, before)
})

test("la actividad del chat mantiene el directo abierto aunque pasen horas", () => {
  const { service, advance } = setup()
  for (let hour = 0; hour < 6; hour++) {
    service.recordMessage(chat("ana"))
    advance(HOUR)
  }
  assert.equal(service.snapshot().entries[0].messages, 6)
})

test("la vista previa no toca la base", () => {
  const { service, db } = setup()
  assert.equal(service.preview(1).entries.length, 3)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chat_top_counts").get().n, 0)
})

test("guarda el avatar cuando llega y no lo borra si un mensaje posterior no lo trae", () => {
  const { service } = setup()
  service.recordMessage(chat("ana", "hola", { avatarUrl: "https://example.com/a.png" }))
  service.recordMessage(chat("ana"))
  assert.equal(service.snapshot().entries[0].avatar, "https://example.com/a.png")
})

// ── Fotos de perfil ──────────────────────────────────────────────────────────
function setupWithAvatars(photos) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const clock = { current: new Date(2026, 8, 28, 18, 0, 0) }
  const sessions = createStreamSessions({ db, getChannel: () => "canal", now: () => clock.current, getGapHours: () => 3 })
  const lookups = []
  const changes = []
  const service = createChatTopService({
    db, sessions, now: () => clock.current, debounceMs: 0, onChange: snap => changes.push(snap),
    getAvatar: async (platform, username) => { lookups.push(`${platform}:${username}`); return photos[username] || null },
  })
  const advance = ms => { clock.current = new Date(clock.current.getTime() + ms) }
  return { service, lookups, changes, advance }
}

test("el top 3 busca la foto de Twitch de quien entra y la manda al overlay", async () => {
  const { service, lookups, changes, advance } = setupWithAvatars({ ana: "https://cdn.example/ana.png" })
  send(service, advance, "ana", 2)
  await flush()
  await flush()
  assert.deepEqual(lookups, ["twitch:ana"])
  assert.equal(service.snapshot().entries[0].avatar, "https://cdn.example/ana.png")
  assert.equal(changes.at(-1).entries[0].avatar, "https://cdn.example/ana.png")
})

test("la foto se busca una sola vez por viewer", async () => {
  const { service, lookups, advance } = setupWithAvatars({})
  send(service, advance, "ana", 1)
  await flush()
  send(service, advance, "ana", 3)
  await flush()
  await flush()
  assert.deepEqual(lookups, ["twitch:ana"])
})

test("no se buscan fotos de quien no esta en el top 3", async () => {
  const { service, lookups, advance } = setupWithAvatars({})
  send(service, advance, "ana", 5)
  send(service, advance, "bea", 4)
  send(service, advance, "cai", 3)
  send(service, advance, "dan", 1)
  await flush()
  assert.equal(lookups.includes("twitch:dan"), false)
})

test("si el evento ya trae la foto (TikTok) no se consulta nada", async () => {
  const { service, lookups } = setupWithAvatars({})
  service.recordMessage({ ...chat("mimi", "hola", { avatarUrl: "https://tiktok.example/m.jpg" }), platform: "tiktok" })
  await flush()
  assert.deepEqual(lookups, [])
  assert.equal(service.snapshot().entries[0].avatar, "https://tiktok.example/m.jpg")
})
