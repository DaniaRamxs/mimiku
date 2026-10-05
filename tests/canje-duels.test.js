const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createCanjeDuels, handleDuelsApi } = require("../src/services/canje-duels.js")
const { createLiveFeed } = require("../src/services/live-feed.js")

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
const SUITS = ["S", "H", "D", "C"]

// random() que deja la baraja de forma que salgan estas cartas (en orden).
function deckValues(order) {
  const deck = []
  for (const suit of SUITS) for (const rank of RANKS) deck.push(`${rank}${suit}`)
  const used = new Set()
  const wanted = order.map(rank => { const card = deck.find(c => c.slice(0, -1) === rank && !used.has(c)); used.add(card); return card })
  const target = [...deck.filter(c => !used.has(c)), ...wanted.reverse()]
  const values = []
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.indexOf(target[i])
    values.push((j + 0.5) / (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return values
}

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const clock = { t: Date.parse("2026-10-06T18:00:00Z") }
  const queue = []
  const random = () => (queue.length ? queue.shift() : 0.5)
  const people = {}
  for (const [id, name] of [["1", "luna"], ["2", "sol"], ["3", "nightbot"], ["4", "nube"]]) {
    const row = platform.identities.resolve({ platform: "twitch", platformUserId: id, username: name, display: name[0].toUpperCase() + name.slice(1) })
    platform.economy.applyMovement({ channelId: "canal", viewerId: row.id, balanceDelta: 100000, idempotencyKey: `seed-${id}`, reason: "seed" })
    db.prepare("INSERT INTO viewer_profiles(channel_id, viewer_id, joined_at, last_seen_at) VALUES('canal', ?, ?, ?)").run(row.id, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")
    people[name] = row
  }
  const feed = createLiveFeed()
  const duels = createCanjeDuels({ platform, getChannel: () => "canal", feed, getLimits: () => ({ riskMin: 100, riskMax: 100000 }), now: () => clock.t, random })
  const balance = name => platform.economy.getBalance("canal", people[name].id).balance
  let n = 0
  const key = () => `clave-duelo-${++n}`
  return { db, platform, clock, queue, people, feed, duels, balance, key }
}

test("duelo a 21: quien reta juega oculto, el rival gana y se lleva el bote menos la comision", () => {
  const { duels, queue, balance, key, feed } = setup()
  queue.push(...deckValues(["10", "7"])) // Luna: 17
  const created = duels.create("1", { login: "sol", game: "bj", bet: 10000, key: key() })
  assert.equal(created.ok, true)
  assert.equal(created.duel.status, "drafting")
  assert.deepEqual(created.duel.me.hand.map(c => c.rank), ["10", "7"])
  assert.equal(balance("luna"), 90000, "la apuesta queda apartada")
  const sent = duels.step("1", created.duel.id, "stand")
  assert.equal(sent.duel.status, "open")
  // Sol ve el reto pero no la mano de Luna.
  const incoming = duels.list("2").active[0]
  assert.deepEqual([incoming.canAccept, incoming.rival], [true, { hidden: true, done: true }])
  assert.deepEqual(duels.summary("2"), { incoming: 1, myTurn: 0, results: 0 })
  queue.push(...deckValues(["9", "9"])) // Sol: 18
  const accepted = duels.accept("2", created.duel.id)
  assert.equal(accepted.duel.status, "playing")
  assert.equal(balance("sol"), 90000)
  const done = duels.step("2", created.duel.id, "stand").duel
  assert.deepEqual([done.status, done.winner, done.won, done.payout, done.fee], ["done", "opponent", true, 19000, 1000])
  assert.equal(done.rival.total, 17, "al terminar se ve la mano del otro")
  assert.equal(balance("sol"), 109000)
  assert.equal(balance("luna"), 90000)
  assert.deepEqual(duels.summary("1"), { incoming: 0, myTurn: 0, results: 1 })
  duels.markSeen("1", created.duel.id)
  assert.equal(duels.summary("1").results, 0)
  const event = feed.list("canal").events.pop()
  assert.deepEqual([event.game, event.who, event.net], ["duelo", "Sol", 9000])
  assert.match(event.label, /Le ganó un duelo a 21 a Luna/)
})

test("duelo a 21: pasarse pierde, empate devuelve y blackjack gana a un 21 de tres cartas", () => {
  const { duels, queue, balance, key } = setup()
  queue.push(...deckValues(["10", "6", "9"]))
  const busted = duels.create("1", { login: "sol", game: "bj", bet: 5000, key: key() }).duel
  assert.equal(duels.step("1", busted.id, "hit").duel.status, "open", "pasarse envia el reto solo")
  queue.push(...deckValues(["2", "3"]))
  duels.accept("2", busted.id)
  assert.equal(duels.step("2", busted.id, "stand").duel.winner, "opponent")
  // Empate: 20 contra 20.
  queue.push(...deckValues(["K", "Q"]))
  const tie = duels.create("1", { login: "sol", game: "bj", bet: 5000, key: key() }).duel
  duels.step("1", tie.id, "stand")
  const before = [balance("luna"), balance("sol")]
  queue.push(...deckValues(["J", "10"]))
  duels.accept("2", tie.id)
  const pushed = duels.step("2", tie.id, "stand").duel
  assert.equal(pushed.winner, "push")
  assert.deepEqual([balance("luna"), balance("sol")], [before[0] + 5000, before[1]], "cada uno recupera lo suyo")
  // Blackjack natural de quien reta contra un 21 de tres cartas.
  queue.push(...deckValues(["A", "K"]))
  const natural = duels.create("1", { login: "sol", game: "bj", bet: 5000, key: key() }).duel
  assert.equal(natural.status, "open", "con 21 ya no se juega mas")
  queue.push(...deckValues(["7", "7", "7"]))
  duels.accept("2", natural.id)
  assert.equal(duels.step("2", natural.id, "hit").duel.winner, "challenger")
})

test("damas: al aceptar empieza la partida; mueve primero quien reta y por turnos", () => {
  const { duels, balance, key } = setup()
  const created = duels.create("1", { login: "sol", game: "checkers", bet: 4000, key: key() }).duel
  assert.deepEqual([created.status, created.checkers], ["open", null])
  assert.equal(balance("luna"), 96000)
  const accepted = duels.accept("2", created.id).duel
  assert.deepEqual([accepted.status, accepted.myTurn, accepted.checkers.mySide, accepted.checkers.moves.length], ["playing", false, "b", 0])
  assert.equal(balance("sol"), 96000)
  assert.equal(duels.summary("1").myTurn, 1, "a Luna le toca mover")
  assert.equal(duels.playMove("2", created.id, [2, 1], [3, 0]).reason, "not-your-turn")
  assert.equal(duels.playMove("1", created.id, [5, 0], [3, 2]).reason, "bad-move", "no se salta sin comer")
  const luna = duels.get("1", created.id).duel
  assert.equal(luna.checkers.moves.length, 7)
  const moved = duels.playMove("1", created.id, [5, 0], [4, 1]).duel
  assert.deepEqual([moved.myTurn, moved.checkers.turn, moved.checkers.lastMove.to], [false, "b", [4, 1]])
  assert.equal(duels.get("2", created.id).duel.myTurn, true)
  assert.equal(duels.playMove("2", created.id, [2, 3], [3, 2]).ok, true)
  assert.equal(duels.playMove("4", created.id, [5, 2], [4, 3]).reason, "not-yours")
})

test("damas: comer es obligatorio; quedarse sin piezas pierde y el ganador cobra", () => {
  const { db, duels, balance, key, feed } = setup()
  const created = duels.create("1", { login: "sol", game: "checkers", bet: 4000, key: key() }).duel
  duels.accept("2", created.id)
  // Posicion preparada: a Luna le toca y puede comer la ultima pieza de Sol.
  const board = Array.from({ length: 8 }, () => Array(8).fill(""))
  board[5][2] = "a"
  board[4][3] = "b"
  board[7][0] = "a"
  const row = db.prepare("SELECT challenger_json FROM canje_duels WHERE id=?").get(created.id)
  const state = { ...JSON.parse(row.challenger_json), board, turn: "a" }
  db.prepare("UPDATE canje_duels SET challenger_json=? WHERE id=?").run(JSON.stringify(state), created.id)
  assert.equal(duels.playMove("1", created.id, [7, 0], [6, 1]).reason, "bad-move", "tiene que comer")
  const done = duels.playMove("1", created.id, [5, 2], [3, 4]).duel
  assert.deepEqual([done.status, done.winner, done.won, done.payout], ["done", "challenger", true, 7600])
  assert.equal(balance("luna"), 96000 + 7600)
  assert.equal(balance("sol"), 96000)
  assert.match(feed.list("canal").events.pop().label, /Le ganó una partida de damas a Sol/)
})

test("damas: rendirse da la partida al otro; quien no mueve en 12 h pierde", () => {
  const { duels, clock, balance, key } = setup()
  const first = duels.create("1", { login: "sol", game: "checkers", bet: 2000, key: key() }).duel
  duels.accept("2", first.id)
  const resigned = duels.resign("1", first.id).duel
  assert.deepEqual([resigned.winner, resigned.checkers.ended], ["opponent", "resign"])
  assert.equal(balance("sol"), 100000 - 2000 + 3800)
  const second = duels.create("1", { login: "sol", game: "checkers", bet: 2000, key: key() }).duel
  duels.accept("2", second.id)
  duels.playMove("1", second.id, [5, 0], [4, 1])
  clock.t += 13 * 60 * 60_000
  const timedOut = duels.get("1", second.id).duel
  assert.deepEqual([timedOut.status, timedOut.winner, timedOut.won, timedOut.checkers.ended], ["done", "challenger", true, "timeout"], "Sol no movio a tiempo")
})

test("damas: 40 jugadas sin comer ni coronar es tablas y cada uno recupera lo suyo", () => {
  const { db, duels, balance, key } = setup()
  const created = duels.create("1", { login: "sol", game: "checkers", bet: 3000, key: key() }).duel
  duels.accept("2", created.id)
  const row = db.prepare("SELECT challenger_json FROM canje_duels WHERE id=?").get(created.id)
  db.prepare("UPDATE canje_duels SET challenger_json=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(row.challenger_json), quiet: 39 }), created.id)
  const draw = duels.playMove("1", created.id, [5, 0], [4, 1]).duel
  assert.deepEqual([draw.winner, draw.checkers.ended], ["push", "quiet"])
  assert.deepEqual([balance("luna"), balance("sol")], [100000, 100000])
})

test("duelos: no se reta a uno mismo, a bots ni a quien no usa la web; maximo 3 pendientes", () => {
  const { duels, platform, key } = setup()
  assert.equal(duels.create("1", { login: "luna", game: "bj", bet: 1000, key: key() }).reason, "self")
  assert.equal(duels.create("1", { login: "nightbot", game: "bj", bet: 1000, key: key() }).reason, "bot")
  platform.identities.resolve({ platform: "twitch", platformUserId: "9", username: "fantasma" })
  assert.equal(duels.create("1", { login: "fantasma", game: "bj", bet: 1000, key: key() }).reason, "no-rival")
  assert.equal(duels.create("1", { login: "sol", game: "bj", bet: 50, key: key() }).reason, "bad-bet")
  assert.equal(duels.create("1", { login: "sol", game: "poker", bet: 1000, key: key() }).reason, "bad-game")
  assert.equal(duels.create("1", { login: "sol", game: "bj", bet: 100001, key: key() }).reason, "bad-bet")
  for (let i = 0; i < 3; i++) assert.equal(duels.create("1", { login: "sol", game: "bj", bet: 1000, key: key() }).ok, true)
  assert.equal(duels.create("1", { login: "nube", game: "bj", bet: 1000, key: key() }).reason, "too-many")
  const same = key()
  const first = duels.create("4", { login: "sol", game: "bj", bet: 1000, key: same })
  assert.equal(duels.create("4", { login: "sol", game: "bj", bet: 1000, key: same }).duel.id, first.duel.id, "reintento sin cobrar otra vez")
})

test("duelos: rechazar, cancelar y caducar devuelven la apuesta; no se juega el turno de otro", () => {
  const { duels, queue, clock, balance, key } = setup()
  queue.push(...deckValues(["10", "7"]))
  const a = duels.create("1", { login: "sol", game: "bj", bet: 3000, key: key() }).duel
  assert.equal(duels.step("2", a.id, "hit").reason, "not-your-turn")
  assert.equal(duels.step("4", a.id, "hit").reason, "not-yours")
  duels.step("1", a.id, "stand")
  assert.equal(duels.accept("1", a.id).reason, "not-yours", "no puedes aceptar tu propio reto")
  assert.equal(duels.decline("2", a.id).ok, true)
  assert.equal(balance("luna"), 100000)
  queue.push(...deckValues(["10", "7"]))
  const b = duels.create("1", { login: "sol", game: "bj", bet: 3000, key: key() }).duel
  duels.step("1", b.id, "stand")
  assert.equal(duels.decline("1", b.id).ok, true, "cancelar antes de que conteste")
  assert.equal(balance("luna"), 100000)
  queue.push(...deckValues(["10", "7"]))
  const c = duels.create("1", { login: "sol", game: "bj", bet: 3000, key: key() }).duel
  duels.step("1", c.id, "stand")
  clock.t += 25 * 60 * 60_000
  assert.equal(duels.summary("2").incoming, 0, "caducado")
  assert.equal(balance("luna"), 100000)
  assert.equal(duels.accept("2", c.id).reason, "no-duel")
})

test("duelos: la API no deja ver la baraja ni la mano del rival antes de terminar", async () => {
  const { duels, queue, key } = setup()
  queue.push(...deckValues(["10", "7"]))
  const created = duels.create("1", { login: "sol", game: "bj", bet: 1000, key: key() }).duel
  duels.step("1", created.id, "stand")
  const [status, body] = await handleDuelsApi({ pathname: "/api/duels", readJson: async () => ({}), user: { twitchId: "2" }, duels })
  assert.equal(status, 200)
  const text = JSON.stringify(body)
  assert.ok(!text.includes("deck"), "nunca sale la baraja")
  assert.ok(!text.includes('"rank":"10"'), "la mano de Luna esta oculta")
})
