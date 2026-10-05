const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createCanjePosts, handlePostsApi } = require("../src/services/canje-posts.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-10-05T20:00:00Z") }
  const person = (id, username) => {
    const row = platform.identities.resolve({ platform: "twitch", platformUserId: id, username })
    db.prepare("UPDATE viewer_identities SET created_at='2026-09-01 10:00:00' WHERE id=?").run(row.id)
    return row
  }
  const people = { hikki: person("1", "hikkidx"), luna: person("2", "luna"), sol: person("3", "sol") }
  const subs = new Set([people.sol.id])
  const posts = createCanjePosts({
    platform, getChannel: () => "hikkidx", now: () => clock.t,
    isSub: viewer => subs.has(viewer.id), isStreamer: login => login === "hikkidx",
  })
  const balance = viewer => platform.economy.getBalance("hikkidx", viewer.id).balance
  let n = 0
  const key = () => `clave-prueba-${++n}`
  return { db, platform, clock, people, posts, balance, key }
}

test("posts: solo la streamer publica, y valida lo que llega", () => {
  const { posts, key } = setup()
  assert.equal(posts.create("2", "luna", { kind: "post", body: "hola", key: key() }).reason, "not-streamer")
  assert.equal(posts.create("1", "hikkidx", { kind: "post", body: "", key: key() }).reason, "bad-request")
  assert.equal(posts.create("1", "hikkidx", { kind: "update", body: "sin titulo", key: key() }).reason, "bad-request")
  assert.equal(posts.create("1", "hikkidx", { kind: "post", body: "x", image: "javascript:alert(1)", key: key() }).reason, "bad-request")
  assert.equal(posts.create("1", "hikkidx", { kind: "post", body: "x", reward: 5_000_000, key: key() }).reason, "bad-request")
  const ok = posts.create("1", "hikkidx", { kind: "post", body: "¡Directo hoy a las 8!", image: "https://media1.tenor.com/m/x/a.gif", key: "mismo-clave-1" })
  assert.equal(ok.ok, true)
  assert.equal(posts.create("1", "hikkidx", { kind: "post", body: "¡Directo hoy a las 8!", key: "mismo-clave-1" }).item.id, ok.item.id, "reintento sin duplicar")
})

test("posts: lo de subs le llega bloqueado a quien no es sub", () => {
  const { posts, key } = setup()
  posts.create("1", "hikkidx", { kind: "post", title: "Secreto", body: "Fondo de pantalla exclusivo", image: "https://example.com/a.png", audience: "subs", key: key() })
  const luna = posts.list("2", "luna", "post")
  assert.deepEqual([luna.items[0].locked, luna.items[0].body, luna.items[0].image, luna.items[0].title], [true, "", "", ""])
  const sol = posts.list("3", "sol", "post").items[0]
  assert.deepEqual([sol.locked, sol.body], [false, "Fondo de pantalla exclusivo"])
  assert.equal(posts.list("1", "hikkidx", "post").items[0].locked, false, "la streamer lo ve todo")
  assert.equal(posts.list("1", "hikkidx", "post").isStreamer, true)
})

test("novedades: el regalo se reclama una vez desde el buzon", () => {
  const { posts, people, balance, key, clock } = setup()
  posts.create("1", "hikkidx", { kind: "update", title: "Blackjack contra Hikki", body: "Nuevo minijuego", reward: 100000, key: key() })
  const box = posts.mailbox("2", "luna")
  assert.deepEqual([box.unread, box.claimable, box.newUpdates], [1, 1, 1])
  const id = box.items[0].id
  const claimed = posts.claim("2", "luna", id)
  assert.deepEqual([claimed.ok, claimed.points], [true, 100000])
  assert.equal(balance(people.luna), 100000)
  assert.equal(posts.claim("2", "luna", id).reason, "claimed")
  assert.equal(balance(people.luna), 100000, "no cobra dos veces")
  assert.equal(posts.summary("2", "luna").claimable, 0)
  posts.markSeen("2")
  assert.equal(posts.summary("2", "luna").unread, 0)
  clock.t += 60_000
  posts.create("1", "hikkidx", { kind: "post", body: "otro", key: key() })
  assert.equal(posts.summary("2", "luna").unread, 1, "lo nuevo vuelve a estar sin leer")
})

test("novedades: regalo solo para subs y nada para cuentas creadas despues", () => {
  const { posts, platform, db, balance, key, people } = setup()
  posts.create("1", "hikkidx", { kind: "update", title: "Para subs", body: "gracias", reward: 50000, rewardAudience: "subs", key: key() })
  const id = posts.list("2", "luna", "update").items[0].id
  assert.equal(posts.claim("2", "luna", id).reason, "subs-only")
  assert.equal(posts.claim("3", "sol", id).ok, true)
  assert.equal(balance(people.sol), 50000)
  posts.create("1", "hikkidx", { kind: "update", title: "Para todos", body: "x", reward: 100000, key: key() })
  const later = platform.identities.resolve({ platform: "twitch", platformUserId: "9", username: "nuevo" })
  db.prepare("UPDATE viewer_identities SET created_at='2026-10-06 10:00:00' WHERE id=?").run(later.id)
  const fresh = posts.list("9", "nuevo", "update").items[0]
  assert.deepEqual([fresh.reward.canClaim, fresh.reward.reason], [false, "too-new"])
  assert.equal(posts.claim("9", "nuevo", fresh.id).reason, "too-new")
})

test("posts: borrar oculta la publicacion y su regalo", () => {
  const { posts, key } = setup()
  const item = posts.create("1", "hikkidx", { kind: "update", title: "Ups", body: "error", reward: 1000, key: key() }).item
  assert.equal(posts.remove("luna", item.id).reason, "not-streamer")
  assert.equal(posts.remove("hikkidx", item.id).ok, true)
  assert.equal(posts.list("2", "luna", "update").items.length, 0)
  assert.equal(posts.claim("2", "luna", item.id).reason, "no-post")
})

test("posts: la API responde 403 a quien no es la streamer", async () => {
  const { posts } = setup()
  const [status, body] = await handlePostsApi({ pathname: "/api/posts/create", url: new URL("http://x/api/posts/create"), readJson: async () => ({ kind: "post", body: "hola", key: "clave-12345" }), user: { twitchId: "2", login: "luna" }, posts })
  assert.equal(status, 403)
  assert.match(body.error, /streamer/)
})

test("vistas y likes: una vista por persona, like que se pone y se quita, y se guardan en la base de datos", () => {
  const { db, platform, posts, key, clock } = setup()
  const open = posts.create("1", "hikkidx", { kind: "post", body: "Para todos", key: key() }).item
  const subs = posts.create("1", "hikkidx", { kind: "post", body: "Solo subs", audience: "subs", key: key() }).item
  assert.deepEqual(posts.recordViews("2", "luna", [open.id, open.id, subs.id]), { ok: true, counted: 1 }, "lo bloqueado no cuenta")
  posts.recordViews("2", "luna", [open.id])
  posts.recordViews("3", "sol", [open.id, subs.id])
  assert.equal(posts.toggleLike("2", "luna", subs.id).reason, "locked")
  const liked = posts.toggleLike("2", "luna", open.id)
  assert.deepEqual([liked.likes, liked.liked], [1, true])
  posts.toggleLike("3", "sol", open.id)
  assert.deepEqual([posts.toggleLike("2", "luna", open.id).likes, posts.toggleLike("2", "luna", open.id).liked], [1, true], "quitar y volver a poner")
  // Otra instancia (Mimiku reiniciado) ve lo mismo.
  const again = createCanjePosts({ platform, getChannel: () => "hikkidx", now: () => clock.t, isSub: () => false, isStreamer: () => false })
  const item = again.list("2", "luna", "post").items.find(row => row.id === open.id)
  assert.deepEqual([item.views, item.likes, item.liked], [2, 2, true])
  const locked = again.list("2", "luna", "post").items.find(row => row.id === subs.id)
  assert.equal(locked.views, 1)
  assert.equal(posts.recordViews("2", "luna", "no-es-lista").reason, "bad-request")
  assert.ok(db)
})

test("comentarios: comenta quien puede verlo, se guardan y cuentan", () => {
  const { platform, posts, key, clock } = setup()
  const open = posts.create("1", "hikkidx", { kind: "post", body: "¿Qué juego para el viernes?", key: key() }).item
  const subs = posts.create("1", "hikkidx", { kind: "post", body: "Solo subs", audience: "subs", key: key() }).item
  const first = posts.addComment("2", "luna", open.id, { body: "  ¡Blackjack!  ", key: key() })
  assert.deepEqual([first.ok, first.item.body, first.item.author.login, first.item.mine, first.comments], [true, "¡Blackjack!", "luna", true, 1])
  assert.equal(posts.addComment("2", "luna", subs.id, { body: "hola", key: key() }).reason, "locked")
  assert.equal(posts.addComment("3", "sol", subs.id, { body: "gracias", key: key() }).ok, true, "el sub si")
  assert.equal(posts.addComment("2", "luna", open.id, { body: "   ", key: key() }).reason, "empty-comment")
  assert.equal(posts.addComment("2", "luna", open.id, { body: "otra vez", key: key() }).reason, "rate-limit", "espera entre comentarios")
  clock.t += 6000
  const streamer = posts.addComment("1", "hikkidx", open.id, { body: "Me gusta la idea", key: key() })
  assert.equal(streamer.item.author.streamer, true)
  assert.equal(posts.addComment("1", "hikkidx", open.id, { body: "x".repeat(900), key: key() }).reason, "rate-limit")
  // Otra instancia (reinicio): siguen ahi, en orden.
  const again = createCanjePosts({ platform, getChannel: () => "hikkidx", now: () => clock.t, isSub: () => false, isStreamer: login => login === "hikkidx" })
  const list = again.comments("2", "luna", open.id)
  assert.deepEqual(list.items.map(c => c.author.login), ["luna", "hikkidx"])
  assert.equal(list.canComment, true)
  assert.equal(again.list("2", "luna", "post").items.find(p => p.id === open.id).comments, 2)
  assert.equal(again.comments("2", "luna", subs.id).reason, "locked")
})

test("comentarios: la streamer borra cualquiera y silencia; cada uno borra los suyos", () => {
  const { posts, key, clock } = setup()
  const post = posts.create("1", "hikkidx", { kind: "post", body: "Hola", key: key() }).item
  const bad = posts.addComment("2", "luna", post.id, { body: "comentario feo", key: key() }).item
  const good = posts.addComment("3", "sol", post.id, { body: "buen directo", key: key() }).item
  assert.equal(posts.deleteComment("2", "luna", good.id).reason, "not-yours")
  assert.equal(posts.muteAuthor("2", "luna", bad.id, true).reason, "not-streamer")
  const view = posts.comments("1", "hikkidx", post.id).items.find(c => c.id === bad.id)
  assert.deepEqual([view.canDelete, view.canMute], [true, true])
  assert.equal(posts.deleteComment("1", "hikkidx", bad.id).comments, 1, "la streamer lo borra")
  assert.equal(posts.muteAuthor("1", "hikkidx", bad.id, true).muted, true)
  clock.t += 10_000
  assert.equal(posts.addComment("2", "luna", post.id, { body: "otra vez", key: key() }).reason, "muted")
  assert.equal(posts.comments("2", "luna", post.id).reason, "muted")
  posts.muteAuthor("1", "hikkidx", bad.id, false)
  assert.equal(posts.addComment("2", "luna", post.id, { body: "perdón", key: key() }).ok, true)
  assert.equal(posts.deleteComment("3", "sol", good.id).ok, true, "el autor borra el suyo")
  assert.deepEqual(posts.comments("2", "luna", post.id).items.map(c => c.body), ["perdón"])
})
