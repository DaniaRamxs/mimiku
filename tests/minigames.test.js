const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createMinigames, WHEEL_SECTORS, DEFAULTS } = require("../src/services/minigames.js")
const { createRiskGames, minesMultiplier, hiloStep } = require("../src/services/minigames-risk.js")
const { createCanjeGames } = require("../src/services/canje-games.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")

// random() devuelve los valores de la lista en orden (y luego `rest`).
function sequence(values, rest = 0.5) {
  const queue = [...values]
  return () => (queue.length ? queue.shift() : rest)
}

function setup({ random = Math.random, points = 100000, cards = true } = {}) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-10-01T15:00:00") }
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: points, idempotencyKey: "seed", reason: "seed" })
  if (cards) {
    for (const [name, rarity] of [["Gato", "comun"], ["Buho", "comun"], ["Robot", "raro"], ["Hada", "epico"], ["Dragon", "legendario"]]) {
      platform.profiles.createCard("canal", { name, rarity })
    }
  }
  const getChannel = () => "canal"
  const random_ = typeof random === "function" ? random : () => random
  const games = createMinigames({ platform, getChannel, now: () => clock.t, random: random_ })
  const risk = createRiskGames({ platform, getChannel, now: () => clock.t, random: random_ })
  const balance = () => platform.economy.getBalance("canal", viewer.id).balance
  const cardCount = () => platform.profiles.getCards("canal", viewer.id).reduce((sum, row) => sum + row.quantity, 0)
  return { db, platform, clock, viewer, games, risk, balance, cardCount, getChannel }
}

// ── Rasca y gana ─────────────────────────────────────────────────────────────
test("rasca y gana: sin premio cobra y nunca salen 3 iguales", () => {
  for (let i = 0; i < 40; i++) {
    const { games, viewer, balance } = setup({ random: sequence([0], Math.random()) })
    const result = games.scratch(viewer.id, `k${i}`)
    assert.equal(result.win, null)
    assert.ok(!(result.cells[0] === result.cells[1] && result.cells[1] === result.cells[2]))
    assert.equal(balance(), 100000 - DEFAULTS.scratchPrice)
  }
})

test("rasca y gana: 3 legendarios dan un personaje legendario", () => {
  const { games, viewer, cardCount } = setup({ random: sequence([0.9999, 0]) })
  const result = games.scratch(viewer.id, "k1")
  assert.deepEqual(result.cells, ["legendario", "legendario", "legendario"])
  assert.equal(result.prize.type, "card")
  assert.equal(result.prize.rarity, "legendario")
  assert.equal(cardCount(), 1)
})

test("rasca y gana: sin puntos no juega", () => {
  const { games, viewer } = setup({ points: 10 })
  assert.deepEqual(games.scratch(viewer.id, "k1"), { ok: false, reason: "insufficient" })
})

// ── Ruleta ───────────────────────────────────────────────────────────────────
test("ruleta: el primer giro del dia es gratis y el segundo se paga; x2 paga el doble", () => {
  const { games, viewer, balance, clock } = setup({ random: () => 0 })
  assert.equal(WHEEL_SECTORS[0].id, "x2")
  const free = games.wheel(viewer.id, "g1")
  assert.equal(free.free, true)
  assert.equal(free.sector, 0)
  assert.equal(balance(), 100000 + 2 * DEFAULTS.wheelPrice)
  const paid = games.wheel(viewer.id, "g2")
  assert.equal(paid.free, false)
  assert.equal(balance(), 100000 + 2 * DEFAULTS.wheelPrice + DEFAULTS.wheelPrice)
  clock.t += 24 * 3600 * 1000
  assert.equal(games.freeSpinAvailable(viewer.id), true, "al dia siguiente vuelve a haber giro gratis")
})

test("ruleta: -50% quita la mitad del precio, pero no en el giro gratis", () => {
  const index = WHEEL_SECTORS.findIndex(sector => sector.id === "menos")
  const total = WHEEL_SECTORS.reduce((sum, sector) => sum + sector.weight, 0)
  const before = WHEEL_SECTORS.slice(0, index).reduce((sum, sector) => sum + sector.weight, 0)
  const roll = (before + 0.5) / total
  const { games, viewer, balance } = setup({ random: () => roll })
  assert.equal(games.wheel(viewer.id, "g1").prize, null, "gratis: no quita nada")
  assert.equal(balance(), 100000)
  const paid = games.wheel(viewer.id, "g2")
  assert.deepEqual(paid.prize, { type: "lose", amount: DEFAULTS.wheelPrice / 2 })
  assert.equal(balance(), 100000 - DEFAULTS.wheelPrice - DEFAULTS.wheelPrice / 2)
})

// ── Slots ────────────────────────────────────────────────────────────────────
test("slots: 3 iguales dan ese personaje; 2 iguales devuelven la apuesta", () => {
  const triple = setup({ random: () => 0 })
  const strip = triple.games.slotsStrip()
  assert.ok(strip.length >= 3)
  const won = triple.games.slots(triple.viewer.id, "s1")
  assert.equal(won.line, "triple")
  assert.equal(won.prize.id, strip[0].id)
  assert.equal(triple.cardCount(), 1)

  const pair = setup({ random: sequence([0, 0, 0.99]) })
  const result = pair.games.slots(pair.viewer.id, "s1")
  assert.equal(result.line, "pair")
  assert.equal(pair.balance(), 100000)
})

test("slots: la tira del dia no cambia en el mismo dia y hace falta tener 3 personajes", () => {
  const { games, clock } = setup()
  const first = games.slotsStrip().map(card => card.id)
  assert.deepEqual(games.slotsStrip().map(card => card.id), first)
  clock.t += 3600 * 1000
  assert.deepEqual(games.slotsStrip().map(card => card.id), first)
  const empty = setup({ cards: false })
  assert.equal(empty.games.slots(empty.viewer.id, "s1").reason, "no-cards")
})

// ── Alta o baja ──────────────────────────────────────────────────────────────
test("alta o baja: acertar multiplica, cobrar paga apuesta x multiplicador", () => {
  // Empieza en 4 (0.25*13 -> 3 -> 4); luego sale 13 (acierta "alta").
  const { risk, viewer, balance } = setup({ random: sequence([0.25, 0.1, 0.99, 0.1]) })
  const start = risk.hiloStart(viewer.id, 1000, "h1")
  assert.equal(start.game.power, 4)
  assert.equal(balance(), 100000 - 1000)
  assert.equal(risk.hiloStart(viewer.id, 1000, "h2").reason, "active", "solo una partida a la vez")
  const guess = risk.hiloGuess(viewer.id, start.game.id, "higher")
  assert.equal(guess.outcome, "win")
  assert.equal(guess.game.multiplier, hiloStep(4, "higher"))
  const cashed = risk.hiloCashout(viewer.id, start.game.id)
  assert.equal(cashed.game.payout, Math.floor(1000 * hiloStep(4, "higher")))
  assert.equal(balance(), 100000 - 1000 + cashed.game.payout)
  assert.equal(risk.hiloCashout(viewer.id, start.game.id).reason, "no-game", "no se cobra dos veces")
})

test("alta o baja: fallar pierde la apuesta; no se puede pedir 'alta' con el 13", () => {
  const { risk, viewer, balance } = setup({ random: sequence([0.5, 0.1, 0]) })
  const start = risk.hiloStart(viewer.id, 1000, "h1")
  assert.equal(start.game.power, 7)
  const lost = risk.hiloGuess(viewer.id, start.game.id, "higher")
  assert.equal(lost.outcome, "lose")
  assert.equal(lost.game.status, "lost")
  assert.equal(balance(), 100000 - 1000)
  assert.equal(hiloStep(13, "higher"), 0)
  assert.equal(hiloStep(1, "lower"), 0)
})

test("alta o baja: apuestas fuera de los limites no valen", () => {
  const { risk, viewer } = setup()
  assert.equal(risk.hiloStart(viewer.id, 5, "h1").reason, "bad-bet")
  assert.equal(risk.hiloStart(viewer.id, 999999999, "h2").reason, "bad-bet")
})

// ── Buscaminas ───────────────────────────────────────────────────────────────
test("buscaminas: cofres suben el multiplicador, las trampas no se ven hasta el final", () => {
  const { risk, viewer, balance } = setup({ random: () => 0 })
  const start = risk.minesStart(viewer.id, 1000, 3, "m1")
  assert.equal(start.game.mines, null, "no se mandan las trampas")
  const session = start.game
  // Con random=0 el barajado deja las trampas en posiciones fijas; se busca una casilla segura probando.
  let safe = null
  for (let cell = 0; cell < 25 && safe === null; cell++) {
    const probe = setup({ random: () => 0 })
    const game = probe.risk.minesStart(probe.viewer.id, 1000, 3, "p").game
    const step = probe.risk.minesReveal(probe.viewer.id, game.id, cell)
    if (step.outcome === "chest") safe = cell
  }
  assert.notEqual(safe, null)
  const found = risk.minesReveal(viewer.id, session.id, safe)
  assert.equal(found.outcome, "chest")
  assert.equal(found.game.multiplier, minesMultiplier(3, 1))
  const cashed = risk.minesCashout(viewer.id, session.id)
  assert.equal(cashed.game.payout, Math.floor(1000 * minesMultiplier(3, 1)))
  assert.equal(cashed.game.mines.length, 3, "al terminar se ensenan")
  assert.equal(balance(), 100000 - 1000 + cashed.game.payout)
})

test("buscaminas: abrir una trampa pierde todo y ensena donde estaban", () => {
  const { risk, viewer, balance, db } = setup({ random: () => 0 })
  const start = risk.minesStart(viewer.id, 1000, 5, "m1")
  const trap = JSON.parse(db.prepare("SELECT state_json FROM minigame_sessions WHERE id=?").get(start.game.id).state_json).mines[0]
  const boom = risk.minesReveal(viewer.id, start.game.id, trap)
  assert.equal(boom.outcome, "trap")
  assert.equal(boom.game.hit, trap)
  assert.equal(boom.game.mines.length, 5)
  assert.equal(balance(), 100000 - 1000)
  assert.equal(risk.minesStart(viewer.id, 1000, 4, "m2").reason, "bad-mines")
})

// ── Por la web ───────────────────────────────────────────────────────────────
test("por la web: info, jugar, reintento sin cobrar y retomar la partida a medias", async t => {
  const { platform, getChannel, balance } = setup()
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, games: createCanjeGames({ platform, getChannel }), sessions,
    validator: { validate: async () => null }, assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const token = sessions.issue({ twitchId: "111", login: "luna" }).token
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, json: await response.json() }
  }
  const info = (await call("/api/games")).json
  assert.equal(info.wheel.sectors.length, WHEEL_SECTORS.length)
  assert.equal(info.wheel.freeSpin, true)
  assert.ok(info.slots.strip.length >= 3)
  const scratch = await call("/api/games/scratch", { key: "rasca-web-1" })
  assert.equal(scratch.status, 200)
  const again = await call("/api/games/scratch", { key: "rasca-web-1" })
  assert.deepEqual(again.json, scratch.json)
  const before = balance()
  const hilo = await call("/api/games/hilo/start", { key: "hilo-web-1", bet: 500 })
  assert.equal(hilo.status, 200)
  assert.equal(balance(), before - 500)
  assert.equal((await call("/api/games")).json.hilo.id, hilo.json.game.id, "la partida a medias sale en info")
  const busy = await call("/api/games/hilo/start", { key: "hilo-web-2", bet: 500 })
  assert.equal(busy.status, 409)
  assert.equal(busy.json.game.id, hilo.json.game.id)
})

test("ruleta: los premios gordos dan tiradas gratis de gachapon y bolas de Plinko", () => {
  const total = WHEEL_SECTORS.reduce((sum, sector) => sum + sector.weight, 0)
  const rollFor = id => {
    const index = WHEEL_SECTORS.findIndex(sector => sector.id === id)
    const before = WHEEL_SECTORS.slice(0, index).reduce((sum, sector) => sum + sector.weight, 0)
    return (before + WHEEL_SECTORS[index].weight / 2) / total
  }
  for (const [id, kind, amount] of [["tiradas40", "gachapon", 40], ["tiradas10", "gachapon", 10], ["bolas30", "plinko", 30]]) {
    const { games, viewer, platform } = setup({ random: () => rollFor(id) })
    const result = games.wheel(viewer.id, "gordo-" + id)
    assert.equal(result.sectorId || WHEEL_SECTORS[result.sector].id, id)
    assert.deepEqual(result.prize, { type: kind === "gachapon" ? "gacha" : "plinko", amount })
    assert.equal(platform.tickets.get("canal", viewer.id)[kind], amount)
  }
  assert.deepEqual(WHEEL_SECTORS.filter(sector => sector.big).map(sector => sector.id), ["tiradas40", "bolas30", "legendario", "x10"])
})

test("rasca y gana: el legendario trae 10 tiradas extra y el diamante paga x20", () => {
  const { games, viewer, platform, cardCount } = setup({ random: sequence([0.9999, 0]) })
  const legend = games.scratch(viewer.id, "k-legend")
  assert.equal(legend.win, "legendario")
  assert.equal(cardCount(), 1)
  assert.deepEqual(legend.bonus, { type: "gacha", amount: 10 })
  assert.equal(platform.tickets.get("canal", viewer.id).gachapon, 10)
  const odds = { nada: 55, moneda: 15, bolas: 8, tiradas: 6, bolsa: 5, cofre: 4, raro: 3.5, diamante: 0.5, epico: 1.5, legendario: 0.4 }
  const total = Object.values(odds).reduce((sum, weight) => sum + weight, 0)
  const rollFor = id => { let before = 0; for (const [key, weight] of Object.entries(odds)) { if (key === id) return (before + weight / 2) / total; before += weight } }
  const diamond = setup({ random: sequence([rollFor("diamante")]) })
  const won = diamond.games.scratch(diamond.viewer.id, "k-diamante")
  assert.deepEqual(won.cells, ["diamante", "diamante", "diamante"])
  assert.deepEqual(won.prize, { type: "points", amount: DEFAULTS.scratchPrice * 20 })
  const balls = setup({ random: sequence([rollFor("bolas")]) })
  assert.deepEqual(balls.games.scratch(balls.viewer.id, "k-bolas").prize, { type: "plinko", amount: 5 })
  assert.equal(balls.platform.tickets.get("canal", balls.viewer.id).plinko, 5)
})
