const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createViewerProfiles, SEARCH_PAGE } = require("../src/services/viewer-profiles.js")
const { createCanjeProfiles, handleProfilesApi } = require("../src/services/canje-profiles.js")

const LUNA = { platform: "twitch", platformUserId: "111", username: "luna", displayName: "Luna" }
const ZORRO = { platform: "twitch", platformUserId: "222", username: "zorro", displayName: "Zorro" }

function setup({ points = 1_000_000, subs = [] } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-10-01T12:00:00Z") }
  const person = identity => {
    const row = platform.identities.resolve({ platform: identity.platform, platformUserId: identity.platformUserId, username: identity.username, display: identity.displayName })
    platform.economy.applyMovement({ channelId: "canal", viewerId: row.id, balanceDelta: points, idempotencyKey: `seed-${row.id}`, reason: "seed" })
    return row
  }
  const luna = person(LUNA)
  const zorro = person(ZORRO)
  const profiles = createViewerProfiles({ platform, getChannel: () => "canal", now: () => clock.t, isSub: id => subs.includes(id) })
  const card = (name, rarity = "comun") => platform.profiles.createCard("canal", { name, rarity, imagePath: "" })
  const give = (viewer, cardRow, quantity = 1, options = {}) => platform.profiles.grantCard("canal", viewer.id, cardRow.id, quantity, undefined, options)
  return { db, platform, clock, luna, zorro, profiles, card, give, balance: v => platform.economy.getBalance("canal", v.id).balance }
}

test("entrar crea el perfil con saldo propio y sin cosmeticos equipados", () => {
  const { profiles, luna } = setup()
  const me = profiles.me(luna.id)
  assert.equal(me.display, "Luna")
  assert.equal(me.points, 1_000_000)
  assert.equal(me.bank, 0)
  assert.equal(me.banner, "")
  assert.equal(me.frame, "")
  assert.ok(me.cosmetics.length >= 16)
  assert.ok(me.cosmetics.every(c => !c.owned))
})

test("comprar un banner cobra una vez, se puede equipar y no se compra dos veces", () => {
  const { profiles, luna, balance } = setup()
  assert.deepEqual(profiles.equip(luna.id, "banner", "banner-galaxia"), { ok: false, reason: "not-owned" })
  const bought = profiles.buy(luna.id, "banner-galaxia", "k1")
  assert.equal(bought.ok, true)
  assert.equal(balance(luna), 1_000_000 - 300000)
  assert.deepEqual(profiles.buy(luna.id, "banner-galaxia", "k2"), { ok: false, reason: "owned" })
  assert.equal(profiles.equip(luna.id, "banner", "banner-galaxia").ok, true)
  assert.equal(profiles.me(luna.id).banner, "banner-galaxia")
  assert.equal(profiles.equip(luna.id, "frame", "banner-galaxia").reason, "unknown")
})

test("sin puntos suficientes no se compra ni se descuenta nada", () => {
  const { profiles, luna, balance } = setup({ points: 1000 })
  assert.deepEqual(profiles.buy(luna.id, "frame-corona", "k1"), { ok: false, reason: "insufficient" })
  assert.equal(balance(luna), 1000)
  assert.equal(profiles.me(luna.id).cosmetics.find(c => c.id === "frame-corona").owned, false)
})

test("el Marco Sub no se vende y solo lo tienen los subs mientras lo sean", () => {
  const subs = []
  const { profiles, luna } = setup({ subs })
  assert.equal(profiles.buy(luna.id, "frame-sub", "k1").reason, "not-for-sale")
  assert.equal(profiles.equip(luna.id, "frame", "frame-sub").reason, "not-owned")
  subs.push(luna.id)
  assert.equal(profiles.equip(luna.id, "frame", "frame-sub").ok, true)
  assert.equal(profiles.me(luna.id).frame, "frame-sub")
  assert.ok(profiles.me(luna.id).badges.includes("sub"))
  subs.length = 0
  assert.equal(profiles.me(luna.id).frame, "")
})

test("la vitrina solo acepta cartas propias y respeta rango y funda", () => {
  const { profiles, luna, card, give, platform } = setup()
  const goku = card("Goku", "legendario")
  const krillin = card("Krillin")
  const vegeta = card("Vegeta", "epico")
  give(luna, goku)
  give(luna, krillin, 2)
  give(luna, krillin, 1, { rank: "epico", sleeve: "prisma" })
  assert.equal(profiles.setShowcase(luna.id, [{ id: vegeta.id }]).reason, "not-owned-card")
  assert.equal(profiles.setShowcase(luna.id, [{ id: krillin.id, rank: "mitico" }]).reason, "not-owned-card")
  const saved = profiles.setShowcase(luna.id, [
    { id: krillin.id, rank: "epico", sleeve: "prisma" }, { id: goku.id }, { id: goku.id },
  ])
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.showcase.map(c => [c.name, c.rarity, c.sleeve]), [["Krillin", "epico", "prisma"], ["Goku", "legendario", null]])
  assert.deepEqual(saved.showcase.map(c => c.number), [2, 1])
})

test("si una carta de la vitrina se va de la coleccion, deja de mostrarse", () => {
  const { profiles, luna, card, give, platform } = setup()
  const goku = card("Goku")
  give(luna, goku)
  profiles.setShowcase(luna.id, [{ id: goku.id }])
  platform.profiles.takeCard("canal", luna.id, goku.id, 1)
  assert.deepEqual(profiles.me(luna.id).showcase, [])
})

test("la vitrina no admite mas de 6 cartas ni datos raros", () => {
  const { profiles, luna } = setup()
  assert.equal(profiles.setShowcase(luna.id, new Array(7).fill({ id: "x" })).reason, "bad-request")
  assert.equal(profiles.setShowcase(luna.id, [{ id: "x", sleeve: "<script>" }]).reason, "bad-request")
  assert.equal(profiles.setShowcase(luna.id, "nada").reason, "bad-request")
})

test("el perfil publico muestra vitrina y nivel pero nunca puntos ni banco", () => {
  const { profiles, luna } = setup()
  profiles.me(luna.id)
  const view = profiles.publicProfile("LUNA")
  assert.equal(view.display, "Luna")
  assert.equal(view.level, 1)
  assert.equal("points" in view, false)
  assert.equal("bank" in view, false)
  assert.equal(profiles.publicProfile("zorro"), null)
  assert.equal(profiles.publicProfile("x' OR 1=1 --"), null)
})

test("la comunidad lista solo a quien uso la web y busca por nombre", () => {
  const { profiles, luna, zorro, clock } = setup()
  assert.deepEqual(profiles.search("").results, [])
  profiles.me(luna.id)
  clock.t += 1000
  profiles.me(zorro.id)
  assert.deepEqual(profiles.search("").results.map(r => r.login), ["zorro", "luna"])
  assert.deepEqual(profiles.search("LU").results.map(r => r.login), ["luna"])
  assert.deepEqual(profiles.search("%").results, [])
  assert.deepEqual(profiles.search("_").results, [])
})

test("la busqueda pagina de 24 en 24", () => {
  const { platform, profiles } = setup({ points: 0 })
  for (let i = 0; i < SEARCH_PAGE + 3; i++) {
    const row = platform.identities.resolve({ platform: "twitch", platformUserId: `p${i}`, username: `fan${i}`, display: `Fan ${i}` })
    profiles.me(row.id)
  }
  const first = profiles.search("fan", 0)
  assert.equal(first.results.length, SEARCH_PAGE)
  assert.equal(first.hasMore, true)
  assert.equal(profiles.search("fan", 1).results.length, 3)
})

test("rutas: comprar con la misma clave no cobra dos veces y se limita el ritmo", async () => {
  const { platform, luna, balance } = setup()
  const routes = createCanjeProfiles({ platform, getChannel: () => "canal" })
  const user = { twitchId: "111" }
  const call = (pathname, body = {}, query = "") => handleProfilesApi({
    pathname, url: new URL(`http://canje${pathname}${query}`), readJson: async () => body, user, profiles: routes,
  })
  const [status1] = await call("/api/profile/buy", { id: "frame-gato", key: "clave-0001" })
  const [status2, again] = await call("/api/profile/buy", { id: "frame-gato", key: "clave-0001" })
  assert.equal(status1, 200)
  assert.equal(status2, 200)
  assert.equal(again.name, "Orejas de gato")
  assert.equal(balance(luna), 1_000_000 - 75000)
  const [bad] = await call("/api/profile/buy", { id: "frame-gato", key: "x" })
  assert.equal(bad, 400)
  let limited = 0
  for (let i = 0; i < 25; i++) if ((await call("/api/profile/equip", { slot: "frame", id: "" }))[0] === 429) limited++
  assert.ok(limited > 0)
  const [missing] = await call("/api/community/profile", {}, "?login=nadie")
  assert.equal(missing, 404)
  const [, me] = await call("/api/profile/me")
  assert.equal(me.profile.frame, "")
})

test("estilo de nombre: se compra, se equipa y sale en el perfil y fuera de el", () => {
  const { profiles, luna, zorro, balance } = setup()
  assert.equal(profiles.nameStyleOf(luna.id), "")
  assert.equal(profiles.equip(luna.id, "name", "name-fuego").reason, "not-owned")
  assert.equal(profiles.buy(luna.id, "name-fuego", "k1").ok, true)
  assert.equal(balance(luna), 1_000_000 - 275000)
  assert.equal(profiles.equip(luna.id, "name", "name-fuego").ok, true)
  assert.equal(profiles.equip(luna.id, "name", "banner-galaxia").reason, "unknown")
  assert.equal(profiles.equip(luna.id, "nombre", "name-fuego").reason, "bad-request")
  const me = profiles.me(luna.id)
  assert.equal(me.nameStyle, "name-fuego")
  assert.equal(me.cosmetics.find(c => c.id === "name-fuego").equipped, true)
  assert.equal(profiles.nameStyleOf(luna.id), "name-fuego")
  assert.equal(profiles.publicProfile("luna").nameStyle, "name-fuego")
  assert.equal(profiles.miniOf(luna.id).nameStyle, "name-fuego")
  assert.equal(profiles.nameStyleOf(zorro.id), "")
  assert.equal(profiles.equip(luna.id, "name", "").ok, true)
  assert.equal(profiles.nameStyleOf(luna.id), "")
})

test("el nombre sub solo vale mientras se es sub", () => {
  const subs = []
  const { profiles, luna } = setup({ subs })
  assert.equal(profiles.equip(luna.id, "name", "name-sub").reason, "not-owned")
  subs.push(luna.id)
  assert.equal(profiles.equip(luna.id, "name", "name-sub").ok, true)
  assert.equal(profiles.nameStyleOf(luna.id), "name-sub")
  subs.pop()
  assert.equal(profiles.nameStyleOf(luna.id), "")
  assert.equal(profiles.me(luna.id).nameStyle, "")
})
