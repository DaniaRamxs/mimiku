const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createRiskGames, handTotal, isBlackjack } = require("../src/services/minigames-risk.js")

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
const SUITS = ["S", "H", "D", "C"]

// Valores de random() para que la baraja salga en este orden (tu, Hikki, tu,
// Hikki y luego las que se pidan). Repite el mismo Fisher-Yates del servidor.
// Con varias listas, cada una es la siguiente baraja (la de la mano y despues
// una por ronda de doble o nada: [tu carta, la de Hikki, ...]).
function riggedDeck(...orders) {
  const values = orders.flatMap(deckValues)
  return () => (values.length ? values.shift() : 0.5)
}

function deckValues(order) {
  const deck = []
  for (const suit of SUITS) for (const rank of RANKS) deck.push(`${rank}${suit}`)
  const used = new Set()
  const wanted = order.map(rank => {
    const card = deck.find(item => item.slice(0, -1) === rank && !used.has(item))
    used.add(card)
    return card
  })
  const target = [...deck.filter(card => !used.has(card)), ...wanted.reverse()]
  const values = []
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.indexOf(target[i])
    values.push((j + 0.5) / (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return values
}

function setup(order, points = 100000, gambles = []) {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: points, idempotencyKey: "seed", reason: "seed" })
  const risk = createRiskGames({ platform, getChannel: () => "canal", random: order ? riggedDeck(order, ...gambles) : Math.random })
  const balance = () => platform.economy.getBalance("canal", viewer.id).balance
  const setLimits = (riskMin, riskMax) => platform.moderation.setConfig("canal", "minigames", { scratchPrice: 500, wheelPrice: 1000, slotsPrice: 300, riskMin, riskMax })
  return { risk, viewer, balance, setLimits }
}

const ranks = cards => cards.map(card => card.rank)

test("blackjack: cuenta el As como 1 u 11 y reconoce un natural", () => {
  const hand = (...list) => list.map(rank => ({ rank, suit: "S" }))
  assert.deepEqual(handTotal(hand("A", "K")), { total: 21, soft: true })
  assert.deepEqual(handTotal(hand("A", "A", "9")), { total: 21, soft: true })
  assert.deepEqual(handTotal(hand("A", "9", "5")), { total: 15, soft: false })
  assert.equal(isBlackjack(hand("A", "Q")), true)
  assert.equal(isBlackjack(hand("A", "5", "5")), false)
})

test("blackjack: la carta tapada de Hikki y la baraja no salen mientras juegas", () => {
  const { risk, viewer, balance } = setup(["10", "9", "7", "8"])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  assert.equal(start.ok, true)
  assert.equal(balance(), 99000)
  assert.deepEqual(ranks(start.game.player), ["10", "7"])
  assert.equal(start.game.dealer[0].rank, "9")
  assert.deepEqual(start.game.dealer[1], { hidden: true })
  assert.equal(start.game.dealerTotal, 9)
  assert.equal(start.game.deck, undefined)
  assert.equal(start.game.canDouble, true)
  assert.equal(risk.bjStart(viewer.id, 1000, "bj-2").reason, "active", "solo una mano a la vez")
  assert.equal(risk.active(viewer.id).blackjack.id, start.game.id, "se retoma tras recargar")
})

test("blackjack: un natural paga 3 a 2 (tras la oferta de doble o nada)", () => {
  const { risk, viewer, balance } = setup(["A", "9", "K", "7"])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  assert.equal(start.game.result, "blackjack")
  assert.equal(start.game.offering, true, "al ganar Hikki ofrece doble o nada")
  assert.equal(start.game.gamble.pot, 2500)
  assert.equal(start.game.dealer[1].rank, "7", "con la oferta ya se ve todo")
  assert.equal(balance(), 99000, "el premio no se cobra hasta decidir")
  const taken = risk.bjTake(viewer.id, start.game.id)
  assert.equal(taken.game.status, "cashed")
  assert.equal(taken.game.payout, 2500)
  assert.equal(balance(), 100000 + 1500)
  assert.equal(risk.active(viewer.id).blackjack, null)
  assert.equal(risk.bjTake(viewer.id, start.game.id).reason, "no-game", "no se cobra dos veces")
})

test("blackjack: el natural de Hikki gana y dos naturales empatan", () => {
  const lost = setup(["10", "A", "9", "K"])
  assert.equal(lost.risk.bjStart(lost.viewer.id, 1000, "bj-1").game.result, "dealer-blackjack")
  assert.equal(lost.balance(), 99000)
  const tie = setup(["A", "A", "K", "Q"])
  const push = tie.risk.bjStart(tie.viewer.id, 1000, "bj-1").game
  assert.equal(push.result, "push")
  assert.equal(tie.balance(), 100000)
})

test("blackjack: pasarse de 21 pierde la apuesta", () => {
  const { risk, viewer, balance } = setup(["10", "9", "6", "8", "K"])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  const hit = risk.bjHit(viewer.id, start.game.id)
  assert.equal(hit.game.result, "bust")
  assert.equal(hit.game.status, "lost")
  assert.equal(hit.game.dealer[1].rank, "8", "al terminar se ve la carta tapada")
  assert.equal(balance(), 99000)
  assert.equal(risk.bjHit(viewer.id, start.game.id).reason, "no-game")
})

test("blackjack: Hikki pide hasta 17 y se planta", () => {
  // Tu 19; Hikki 6+10=16, pide un 2 -> 18 y se planta: ganas.
  const won = setup(["10", "6", "9", "10", "2"])
  const start = won.risk.bjStart(won.viewer.id, 1000, "bj-1")
  const stand = won.risk.bjStand(won.viewer.id, start.game.id)
  assert.deepEqual(ranks(stand.game.dealer), ["6", "10", "2"])
  assert.equal(stand.game.result, "win")
  won.risk.bjTake(won.viewer.id, start.game.id)
  assert.equal(won.balance(), 101000)
  // Hikki 10+6 pide un 10 y se pasa.
  const busted = setup(["10", "10", "2", "6", "10"])
  const second = busted.risk.bjStart(busted.viewer.id, 1000, "bj-1")
  assert.equal(busted.risk.bjStand(busted.viewer.id, second.game.id).game.result, "dealer-bust")
  // Con 17 Hikki ya no pide: tu 17 contra su 17 es empate.
  const tied = setup(["10", "10", "7", "7"])
  const third = tied.risk.bjStart(tied.viewer.id, 1000, "bj-1")
  const push = tied.risk.bjStand(tied.viewer.id, third.game.id).game
  assert.deepEqual([push.result, push.dealer.length, tied.balance()], ["push", 2, 100000])
})

test("blackjack: doblar cobra otra apuesta, da una carta y paga el doble", () => {
  const { risk, viewer, balance } = setup(["5", "10", "6", "7", "10"])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  const doubled = risk.bjDouble(viewer.id, start.game.id)
  assert.equal(doubled.ok, true)
  assert.equal(doubled.game.bet, 2000)
  assert.equal(doubled.game.player.length, 3)
  assert.equal(doubled.game.result, "win")
  assert.equal(doubled.game.gamble.pot, 4000)
  assert.equal(risk.bjTake(viewer.id, start.game.id).game.payout, 4000)
  assert.equal(balance(), 100000 - 2000 + 4000)
})

test("blackjack: no se dobla con tres cartas ni sin puntos para la segunda apuesta", () => {
  const late = setup(["2", "10", "3", "7", "4"])
  const start = late.risk.bjStart(late.viewer.id, 1000, "bj-1")
  late.risk.bjHit(late.viewer.id, start.game.id)
  assert.equal(late.risk.bjDouble(late.viewer.id, start.game.id).reason, "bad-move")
  const poor = setup(["5", "10", "6", "7"], 1500)
  const second = poor.risk.bjStart(poor.viewer.id, 1000, "bj-1")
  assert.equal(poor.risk.bjDouble(poor.viewer.id, second.game.id).reason, "insufficient")
  assert.equal(poor.balance(), 500, "no se cobra nada al fallar")
  assert.equal(poor.risk.active(poor.viewer.id).blackjack.bet, 1000)
})

test("blackjack: dividir juega dos manos con otra apuesta y paga cada una", () => {
  // Tu 8+8 contra el 10+7 de Hikki. Mano 1: 8+3, dobla con un 10 (21). Mano 2: 8+K (18).
  const { risk, viewer, balance } = setup(["8", "10", "8", "7", "3", "K", "10"])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  assert.equal(start.game.canSplit, true)
  const split = risk.bjSplit(viewer.id, start.game.id)
  assert.equal(split.ok, true)
  assert.equal(balance(), 98000, "la segunda mano cobra otra apuesta")
  assert.deepEqual(split.game.hands.map(hand => ranks(hand.cards)), [["8", "3"], ["8", "K"]])
  assert.deepEqual([split.game.current, split.game.split, split.game.bet, split.game.canSplit], [0, true, 2000, false])
  const doubled = risk.bjDouble(viewer.id, start.game.id)
  assert.equal(doubled.game.current, 1, "tras doblar pasa a la segunda mano")
  assert.equal(doubled.game.status, "active")
  assert.equal(balance(), 97000)
  const done = risk.bjStand(viewer.id, start.game.id).game
  assert.equal(done.result, "split")
  assert.deepEqual(done.hands.map(hand => hand.result), ["win", "win"])
  assert.equal(done.gamble.pot, 2000 * 2 + 1000 * 2)
  risk.bjTake(viewer.id, start.game.id)
  assert.equal(balance(), 97000 + 6000)
})

test("blackjack: se divide con dos figuras de 10 pero no con cartas distintas; 21 tras dividir no es blackjack", () => {
  // J+Q contra 9+7. Mano 1: J+A (21, se planta sola). Mano 2: Q+5, pide 9 y se pasa. Hikki 16 pide 2 -> 18.
  const { risk, viewer, balance } = setup(["J", "9", "Q", "7", "A", "5", "9", "2"])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  const split = risk.bjSplit(viewer.id, start.game.id)
  assert.equal(split.game.current, 1, "la mano de 21 se planta sola")
  const done = risk.bjHit(viewer.id, start.game.id).game
  assert.deepEqual(done.hands.map(hand => hand.result), ["win", "bust"])
  assert.equal(done.payout, 2000, "21 tras dividir paga 1 a 1")
  assert.equal(done.offering, false, "sin ganancia no hay doble o nada: se cobra al momento")
  assert.equal(balance(), 100000)
  const other = setup(["10", "9", "9", "7"])
  const second = other.risk.bjStart(other.viewer.id, 1000, "bj-1")
  assert.equal(second.game.canSplit, false)
  assert.equal(other.risk.bjSplit(other.viewer.id, second.game.id).reason, "bad-move")
})

test("blackjack: los ases divididos reciben una carta y si las dos manos se pasan Hikki no pide", () => {
  const aces = setup(["A", "10", "A", "6", "9", "5", "8"])
  const start = aces.risk.bjStart(aces.viewer.id, 1000, "bj-1")
  const done = aces.risk.bjSplit(aces.viewer.id, start.game.id).game
  assert.equal(done.offering, true, "con ases se juega solo (y gana: oferta)")
  assert.deepEqual(done.hands.map(hand => ranks(hand.cards)), [["A", "9"], ["A", "5"]])
  assert.deepEqual(ranks(done.dealer), ["10", "6", "8"])
  assert.deepEqual(done.hands.map(hand => hand.result), ["dealer-bust", "dealer-bust"])
  const busts = setup(["8", "10", "8", "6", "6", "K", "K", "6"])
  const second = busts.risk.bjStart(busts.viewer.id, 1000, "bj-1")
  busts.risk.bjSplit(busts.viewer.id, second.game.id)
  busts.risk.bjHit(busts.viewer.id, second.game.id)
  const lost = busts.risk.bjHit(busts.viewer.id, second.game.id).game
  assert.equal(lost.status, "lost")
  assert.equal(lost.dealer.length, 2, "Hikki no pide si ya perdiste todas")
  assert.equal(busts.balance(), 98000)
})

test("blackjack: sin puntos para la segunda mano no se divide", () => {
  const { risk, viewer, balance } = setup(["8", "10", "8", "7"], 1500)
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  assert.equal(risk.bjSplit(viewer.id, start.game.id).reason, "insufficient")
  assert.equal(balance(), 500)
  assert.equal(risk.active(viewer.id).blackjack.split, false)
})

// ── Doble o nada ──
// Tu 19 contra el 18 de Hikki: ganas 1000 -> bote 2000.
const WIN_HAND = ["10", "10", "9", "8"]

test("doble o nada: ganar la carta alta duplica el bote y vuelve a ofrecer", () => {
  const { risk, viewer, balance } = setup(WIN_HAND, 100000, [["K", "5"]])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  const won = risk.bjStand(viewer.id, start.game.id)
  assert.equal(won.game.gamble.pot, 2000)
  const round = risk.bjGamble(viewer.id, start.game.id)
  assert.equal(round.outcome, "win")
  assert.deepEqual([round.game.gamble.last.mine.rank, round.game.gamble.last.hers.rank], ["K", "5"])
  assert.deepEqual([round.game.gamble.pot, round.game.gamble.round, round.game.offering], [4000, 1, true])
  assert.equal(balance(), 99000)
  assert.equal(risk.active(viewer.id).blackjack.gamble.pot, 4000, "la oferta sigue tras recargar")
  assert.equal(risk.bjTake(viewer.id, start.game.id).game.payout, 4000)
  assert.equal(balance(), 99000 + 4000)
})

test("doble o nada: perder la carta alta deja el bote en nada", () => {
  const { risk, viewer, balance } = setup(WIN_HAND, 100000, [["3", "A"]])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  risk.bjStand(viewer.id, start.game.id)
  const round = risk.bjGamble(viewer.id, start.game.id)
  assert.equal(round.outcome, "lose")
  assert.deepEqual([round.game.status, round.game.payout, round.game.gamble.lost], ["lost", 0, true])
  assert.equal(balance(), 99000)
  assert.equal(risk.bjTake(viewer.id, start.game.id).reason, "no-game")
})

test("doble o nada: los empates se repiten y el As es la carta mas alta", () => {
  const { risk, viewer } = setup(WIN_HAND, 100000, [["7", "7", "A", "K"]])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  risk.bjStand(viewer.id, start.game.id)
  const round = risk.bjGamble(viewer.id, start.game.id)
  assert.equal(round.outcome, "win")
  assert.equal(round.game.gamble.last.ties.length, 1)
  assert.deepEqual([round.game.gamble.last.mine.rank, round.game.gamble.last.hers.rank], ["A", "K"])
})

test("doble o nada: como mucho 5 rondas; en la quinta se cobra solo", () => {
  const win = ["A", "2"]
  const { risk, viewer, balance } = setup(WIN_HAND, 100000, [win, win, win, win, win])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  risk.bjStand(viewer.id, start.game.id)
  let round = null
  for (let i = 0; i < 4; i++) round = risk.bjGamble(viewer.id, start.game.id)
  assert.deepEqual([round.game.gamble.round, round.game.gamble.canGamble], [4, true])
  round = risk.bjGamble(viewer.id, start.game.id)
  assert.equal(round.auto, true)
  assert.deepEqual([round.game.status, round.game.payout], ["cashed", 2000 * 32])
  assert.equal(balance(), 99000 + 64000)
})

test("doble o nada: no pasa de 10 veces la apuesta maxima del panel", () => {
  const win = ["A", "2"]
  const { risk, viewer, balance, setLimits } = setup(WIN_HAND, 100000, [win, win])
  setLimits(100, 1000) // tope del bote: 10.000
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  assert.equal(risk.bjStand(viewer.id, start.game.id).game.gamble.pot, 2000)
  assert.equal(risk.bjGamble(viewer.id, start.game.id).game.gamble.pot, 4000)
  const round = risk.bjGamble(viewer.id, start.game.id)
  assert.equal(round.auto, true, "8000 x2 pasaria el tope: se cobra solo")
  assert.equal(round.game.payout, 8000)
  assert.equal(balance(), 99000 + 8000)
  const big = setup(["A", "9", "K", "7"], 100000)
  big.setLimits(100, 1000)
  const natural = big.risk.bjStart(big.viewer.id, 1000, "bj-1")
  assert.equal(natural.game.offering, true, "2500 x2 = 5000 cabe en el tope")
})

test("doble o nada: un empate o una mano perdida no ofrecen nada", () => {
  const tie = setup(["10", "10", "7", "7"])
  const start = tie.risk.bjStart(tie.viewer.id, 1000, "bj-1")
  const push = tie.risk.bjStand(tie.viewer.id, start.game.id).game
  assert.deepEqual([push.status, push.offering, push.gamble], ["cashed", false, null])
  assert.equal(tie.risk.bjGamble(tie.viewer.id, start.game.id).reason, "no-game")
})

test("doble o nada: con la oferta abierta no se puede pedir, plantarse, doblar ni dividir", () => {
  // La mano real que fallo: 3+A contra 8+6; te plantas, Hikki pide un 9 y se pasa. Luego una Q que no debe salir.
  const { risk, viewer, balance } = setup(["3", "8", "A", "6", "9", "Q"])
  const start = risk.bjStart(viewer.id, 1000, "bj-1")
  const won = risk.bjStand(viewer.id, start.game.id)
  assert.equal(won.game.offering, true)
  assert.equal(risk.bjHit(viewer.id, start.game.id).reason, "offer")
  assert.equal(risk.bjStand(viewer.id, start.game.id).reason, "offer")
  assert.equal(risk.bjDouble(viewer.id, start.game.id).reason, "offer")
  assert.equal(risk.bjSplit(viewer.id, start.game.id).reason, "offer")
  const still = risk.active(viewer.id).blackjack
  assert.deepEqual([still.offering, still.gamble.pot, still.hands[0].cards.length], [true, 2000, 2], "la mano y el bote siguen intactos")
  assert.equal(risk.bjTake(viewer.id, start.game.id).game.payout, 2000)
  assert.equal(balance(), 99000 + 2000)
})
