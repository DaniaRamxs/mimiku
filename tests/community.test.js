const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createViewerProfiles } = require("../src/services/viewer-profiles.js")
const { createCommunity, statsOf, ONLINE_WINDOW_MS } = require("../src/services/community.js")
const { createLiveFeed } = require("../src/services/live-feed.js")

function setup({ subs = [], chatters = [] } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-10-05T15:00:00Z") }
  const now = () => clock.t
  const getChannel = () => "canal"
  const people = {}
  for (const [id, name] of [["111", "luna"], ["222", "sol"], ["333", "nube"]]) {
    people[name] = platform.identities.resolve({ platform: "twitch", platformUserId: id, username: name, display: name[0].toUpperCase() + name.slice(1) })
  }
  const isSub = viewerId => subs.includes(viewerId)
  const profiles = createViewerProfiles({ platform, getChannel, now, isSub })
  const community = createCommunity({ platform, getChannel, now, isSub, getChatters: () => chatters })
  return { db, platform, clock, people, profiles, community, isSub }
}

test("logros: cada evento suma a su contador", () => {
  assert.deepEqual(statsOf({ game: "gacha", count: 10, rarity: "legendario" }), { pulls: 10, legendaries: 1 })
  assert.deepEqual(statsOf({ game: "blackjack", net: 750, outcome: "win", result: "blackjack" }), { plays: 1, hikki_wins: 1, naturals: 1 })
  assert.deepEqual(statsOf({ game: "plinko", big: true, outcome: "win", net: 9000 }), { plays: 1, big_wins: 1 })
  assert.deepEqual(statsOf({ game: "robar", kind: "rob", net: 500 }), { steals: 1 })
  assert.deepEqual(statsOf({ game: "regalo", kind: "gift", net: 25000 }), { gifts: 25000 })
})

test("logros: una tirada desbloquea 'Primera tirada' y la pagina lo avisa una sola vez", () => {
  const { community, people } = setup()
  community.track("canal", { game: "gacha", viewerId: people.luna.id, count: 1, rarity: "comun" })
  assert.deepEqual(community.takeFresh("111").map(item => item.id), ["primera-tirada"])
  assert.deepEqual(community.takeFresh("111"), [], "ya visto")
  community.track("canal", { game: "gacha", viewerId: people.luna.id, count: 1 })
  assert.deepEqual(community.takeFresh("111"), [], "no se desbloquea dos veces")
})

test("logros: el tuyo trae el progreso de lo que falta; el de otro solo lo conseguido", () => {
  const { community, profiles, people } = setup()
  profiles.touch(people.luna.id)
  for (let i = 0; i < 3; i++) community.track("canal", { game: "blackjack", viewerId: people.luna.id, net: 500, outcome: "win" })
  const own = community.achievementsOf(people.luna.id, { own: true })
  const rival = own.list.find(item => item.id === "rival-hikki")
  const nightmare = own.list.find(item => item.id === "pesadilla-hikki")
  assert.equal(rival.unlocked, true)
  assert.deepEqual([nightmare.unlocked, nightmare.progress, nightmare.goal], [false, 3, 50])
  assert.equal(own.list[0].unlocked, true, "primero los conseguidos")
  const other = community.achievementsOfLogin("luna")
  assert.ok(other.list.every(item => item.unlocked && item.progress === undefined))
  assert.equal(other.unlocked, own.unlocked)
  assert.equal(community.achievementsOfLogin("nadie"), null)
})

test("logros: los de perfil (nivel, antiguedad) se miran al abrir el perfil", () => {
  const { community, profiles, platform, people, clock } = setup()
  profiles.touch(people.sol.id)
  platform.levels.addXp("canal", people.sol.id, 10_000_000)
  clock.t += 31 * 86400000
  const ids = community.achievementsOf(people.sol.id).list.map(item => item.id)
  assert.ok(ids.includes("nivel-10"))
  assert.ok(ids.includes("veterano"))
  assert.ok(community.takeFresh("222").some(item => item.id === "veterano"))
})

test("ahora en el canal: quien usa la pagina y quien escribe en el chat", () => {
  const { community, profiles, people, clock } = setup({ chatters: [{ username: "sol", platformUserId: "222", platform: "twitch" }, { username: "luna", platformUserId: "111" }] })
  profiles.touch(people.luna.id)
  community.seen("111")
  const now = community.online()
  assert.equal(now.total, 2)
  assert.deepEqual(now.list.map(item => [item.login, item.where]), [["luna", "both"], ["sol", "chat"]])
  assert.equal(now.list[1].hasProfile, false, "sol nunca entro en la web")
  clock.t += ONLINE_WINDOW_MS + 1000
  assert.equal(community.online().list.find(item => item.login === "luna").where, "chat", "la web caduca; el chat lo decide watch-time")
})

test("destacados de la semana: legendarios, puntos ganados a Hikki y niveles, guardados en la base de datos", () => {
  const { db, community, platform, people, clock } = setup()
  const { createGachaponService } = require("../src/services/gachapon.js")
  // Un legendario de verdad del gachapon se apunta al tirar (sin pasar por la pagina).
  platform.profiles.createCard("canal", { name: "Dragon", rarity: "legendario" })
  const gacha = createGachaponService({ platform, getChannel: () => "canal", random: () => 0.999, now: () => clock.t, broadcast: () => {}, log: { error() {} } })
  gacha.setConfig({ price: 0 })
  for (const key of ["g1", "g2"]) assert.equal(gacha.pull({ platform: "twitch", platformUserId: "111", username: "luna" }, key).ok, true)
  platform.activity.record("canal", people.sol.id, "legendary", 1, new Date(clock.t).toISOString())
  // Manos de blackjack terminadas (como las guarda minigames-risk.js).
  const hand = (viewer, status, bet, payout) => db.prepare(`INSERT INTO minigame_sessions(id, channel_id, viewer_id, game, bet, state_json, status, payout, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(require("node:crypto").randomUUID(), "canal", viewer.id, "blackjack", bet, "{}", status, payout, new Date(clock.t).toISOString(), new Date(clock.t).toISOString())
  hand(people.sol, "cashed", 1000, 2500)
  hand(people.sol, "lost", 500, 0)
  hand(people.nube, "lost", 500, 0)
  hand(people.luna, "cashed", 1000, 1000)
  platform.levels.addXp("canal", people.nube.id, 5000)
  // Lo de hace mas de una semana no cuenta.
  platform.activity.record("canal", people.nube.id, "legendary", 9, new Date(clock.t - 8 * 86400000).toISOString())
  const [legends, hikki, levels] = community.highlights()
  assert.deepEqual(legends.entries.map(row => [row.login, row.value]), [["luna", 2], ["sol", 1]])
  assert.deepEqual(hikki.entries.map(row => [row.login, row.value]), [["sol", 1000]], "solo quien va ganando (1500 - 500)")
  assert.equal(levels.entries[0].login, "nube")
  // Otro proceso (Mimiku reiniciado) ve lo mismo: no depende de la memoria.
  const again = createCommunity({ platform, getChannel: () => "canal", now: () => clock.t })
  assert.deepEqual(again.highlights().map(group => group.entries.length), [2, 1, 1])
})

test("comunidad: ordenar por nivel o coleccion, solo subs y recien llegados", () => {
  const { profiles, platform, people, clock } = setup({ subs: [] })
  for (const name of ["luna", "sol", "nube"]) { profiles.touch(people[name].id); clock.t += 60_000 }
  platform.levels.addXp("canal", people.sol.id, 50_000)
  const card = platform.profiles.createCard("canal", { name: "Gato", rarity: "comun" })
  platform.profiles.grantCard("canal", people.luna.id, card.id, 1, "k-gato")
  assert.deepEqual(profiles.search("", 0, { sort: "recent" }).results.map(row => row.login), ["nube", "sol", "luna"])
  assert.equal(profiles.search("", 0, { sort: "level" }).results[0].login, "sol")
  assert.equal(profiles.search("", 0, { sort: "collection" }).results[0].login, "luna")
  assert.deepEqual(profiles.newcomers().map(row => row.login), ["nube", "sol", "luna"])
  const subbed = createViewerProfiles({ platform, getChannel: () => "canal", isSub: id => id === people.sol.id })
  assert.deepEqual(subbed.search("", 0, { subs: true }).results.map(row => [row.login, row.sub]), [["sol", true]])
})

test("el tablon avisa a los suscritos una sola vez aunque se suscriba de nuevo", () => {
  const feed = createLiveFeed()
  const seen = []
  feed.subscribe("logros", (channel, event) => seen.push([channel, event.viewerId]))
  feed.subscribe("logros", (channel, event) => seen.push([channel, event.viewerId]))
  feed.record("Canal", { game: "plinko", viewerId: "v1", who: "Luna" })
  assert.deepEqual(seen, [["canal", "v1"]])
})
