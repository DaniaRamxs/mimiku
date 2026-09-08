// services/games.js — Blackjack y Ruleta
const { getViewer, addPoints } = require("./economy.js")

// ── BLACKJACK ─────────────────────────────────────────────────────────────────
const SUITS  = ["♠","♥","♦","♣"]
const VALUES = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"]

function newDeck() {
  const deck = []
  for (const s of SUITS) for (const v of VALUES) deck.push({ s, v })
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

function cardValue(card) {
  if (["J","Q","K"].includes(card.v)) return 10
  if (card.v === "A") return 11
  return parseInt(card.v)
}

function handValue(hand) {
  let total = hand.reduce((s, c) => s + cardValue(c), 0)
  let aces  = hand.filter(c => c.v === "A").length
  while (total > 21 && aces > 0) { total -= 10; aces-- }
  return total
}

function cardStr(card) { return `${card.v}${card.s}` }
function handStr(hand) { return hand.map(cardStr).join(" ") }

// Estado de partidas activas: username → { deck, hand, dealer, bet, done }
const bjGames = {}
let bjActive  = false   // si el juego está abierto para nuevas partidas

function bjOpen()  { bjActive = true }
function bjClose() { bjActive = false; Object.keys(bjGames).forEach(k => delete bjGames[k]) }
function bjIsOpen() { return bjActive }

function bjJoin(username, bet) {
  const viewer = getViewer(username)
  if (!viewer) return { error: "No tenés puntos registrados. Chateá primero." }
  if (viewer.points < bet) return { error: `No tenés suficientes puntos. Tenés ${viewer.points}.` }
  if (bjGames[username]) return { error: "Ya tenés una partida en curso. Usá !hit o !stand." }

  const deck   = newDeck()
  const hand   = [deck.pop(), deck.pop()]
  const dealer = [deck.pop(), deck.pop()]

  addPoints(username, -bet, "bj-apuesta")
  bjGames[username] = { deck, hand, dealer, bet, done: false }

  const val = handValue(hand)
  if (val === 21) return bjFinish(username, "blackjack")

  return {
    ok: true,
    msg: `@${username} | Tu mano: ${handStr(hand)} (${val}) | Dealer muestra: ${cardStr(dealer[0])} | !hit para pedir carta, !stand para plantarte`,
    value: val
  }
}

function bjHit(username) {
  const game = bjGames[username]
  if (!game || game.done) return { error: "No tenés partida activa. Usá !bj [apuesta]." }
  game.hand.push(game.deck.pop())
  const val = handValue(game.hand)
  if (val > 21) return bjFinish(username, "bust")
  if (val === 21) return bjFinish(username, "blackjack")
  return {
    ok: true,
    msg: `@${username} | Tu mano: ${handStr(game.hand)} (${val}) | !hit o !stand`
  }
}

function bjStand(username) {
  const game = bjGames[username]
  if (!game || game.done) return { error: "No tenés partida activa." }

  // Dealer juega: pide hasta 17
  while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop())

  const playerVal = handValue(game.hand)
  const dealerVal = handValue(game.dealer)

  if (dealerVal > 21 || playerVal > dealerVal) return bjFinish(username, "win")
  if (playerVal === dealerVal)                  return bjFinish(username, "push")
  return bjFinish(username, "lose")
}

function bjFinish(username, result) {
  const game = bjGames[username]
  if (!game) return { error: "Sin partida." }
  game.done = true
  delete bjGames[username]

  const playerVal = handValue(game.hand)
  const dealerVal = handValue(game.dealer)
  let msg = "", payout = 0

  if (result === "blackjack") {
    payout = Math.floor(game.bet * 2.5)
    addPoints(username, payout, "bj-blackjack")
    msg = `🃏 ¡BLACKJACK! @${username} ganó ${payout} pts | Mano: ${handStr(game.hand)}`
  } else if (result === "win") {
    payout = game.bet * 2
    addPoints(username, payout, "bj-win")
    msg = `🃏 @${username} ganó ${payout} pts | Tu mano: ${handStr(game.hand)} (${playerVal}) | Dealer: ${handStr(game.dealer)} (${dealerVal})`
  } else if (result === "push") {
    addPoints(username, game.bet, "bj-push")
    msg = `🃏 Empate @${username} | Tu mano: ${handStr(game.hand)} (${playerVal}) | Dealer: ${handStr(game.dealer)} (${dealerVal}) | Devuelven tu apuesta`
  } else if (result === "bust") {
    msg = `🃏 @${username} se pasó de 21 | Mano: ${handStr(game.hand)} (${playerVal}) | Perdiste ${game.bet} pts`
  } else {
    msg = `🃏 @${username} perdió | Tu mano: ${handStr(game.hand)} (${playerVal}) | Dealer: ${handStr(game.dealer)} (${dealerVal})`
  }

  return { ok: true, msg, result, payout, bet: game.bet }
}

// ── RULETA ────────────────────────────────────────────────────────────────────
// Tipos de apuesta: número (0-36), rojo/negro, par/impar, alto/bajo
const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]

function rouletteColor(n) { return n === 0 ? "verde" : RED_NUMBERS.includes(n) ? "rojo" : "negro" }

function rouletteSpin(username, betType, bet) {
  const viewer = getViewer(username)
  if (!viewer) return { error: "Chateá primero para registrarte." }
  if (viewer.points < bet) return { error: `No tenés suficientes puntos. Tenés ${viewer.points}.` }
  if (bet <= 0) return { error: "La apuesta debe ser mayor a 0." }

  const number = Math.floor(Math.random() * 37)  // 0-36
  const color  = rouletteColor(number)
  const isEven = number !== 0 && number % 2 === 0
  const isHigh = number >= 19 && number <= 36

  let win = false, multiplier = 0

  const type = betType.toLowerCase()

  if (!isNaN(parseInt(type))) {
    // apuesta a número exacto
    const target = parseInt(type)
    if (target < 0 || target > 36) return { error: "Número inválido (0-36)." }
    win = number === target
    multiplier = 35
  } else if (type === "rojo" || type === "red") {
    win = color === "rojo"; multiplier = 1
  } else if (type === "negro" || type === "black") {
    win = color === "negro"; multiplier = 1
  } else if (type === "par" || type === "even") {
    win = isEven; multiplier = 1
  } else if (type === "impar" || type === "odd") {
    win = !isEven && number !== 0; multiplier = 1
  } else if (type === "alto" || type === "high") {
    win = isHigh; multiplier = 1
  } else if (type === "bajo" || type === "low") {
    win = number >= 1 && number <= 18; multiplier = 1
  } else {
    return { error: `Apuesta inválida. Opciones: rojo negro par impar alto bajo [0-36]` }
  }

  addPoints(username, -bet, "ruleta-apuesta")
  let gained = 0
  if (win) {
    gained = bet * (multiplier + 1)
    addPoints(username, gained, "ruleta-ganadora")
  }

  const resultViewer = getViewer(username)
  return {
    ok: true,
    number, color,
    win, gained, bet,
    totalPoints: resultViewer?.points ?? 0,
    msg: win
      ? `🎡 Salió ${number} ${color} | @${username} apostó a "${betType}" y GANÓ ${gained} pts! Total: ${resultViewer?.points?.toLocaleString()}`
      : `🎡 Salió ${number} ${color} | @${username} apostó a "${betType}" y perdió ${bet} pts. Total: ${resultViewer?.points?.toLocaleString()}`
  }
}


// ── SLOTS ─────────────────────────────────────────────────────────────────────
const SYMBOLS = ["🍒","🍋","🍊","🍇","⭐","💎","7️⃣","🎰"]

function playSlots(username, bet) {
  const viewer = getViewer(username)
  if (!viewer) return { error: "Chateá primero para registrarte." }
  if (viewer.points < bet) return { error: `No tenés suficientes puntos. Tenés ${viewer.points}.` }
  if (bet <= 0) return { error: "La apuesta debe ser mayor a 0." }

  const s1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
  const s2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
  const s3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]

  addPoints(username, -bet, "slots-apuesta")

  let result, payout = 0, multiplier = 0

  if (s1 === s2 && s2 === s3) {
    // Jackpot especial para 💎 y 7️⃣
    multiplier = (s1 === "💎" || s1 === "7️⃣") ? 20 : 10
    payout = bet * multiplier
    result = "jackpot"
  } else if (s1 === s2 || s2 === s3 || s1 === s3) {
    multiplier = 2
    payout = bet * multiplier
    result = "par"
  } else {
    result = "miss"
  }

  if (payout > 0) addPoints(username, payout, "slots-" + result)

  const finalViewer = getViewer(username)
  const display = `[ ${s1} | ${s2} | ${s3} ]`

  let msg = ""
  if (result === "jackpot") {
    msg = `🎰 ${display} ¡¡JACKPOT!! @${username} ganó ${payout} pts (${multiplier}x)! Total: ${finalViewer?.points?.toLocaleString() ?? 0} ✦`
  } else if (result === "par") {
    msg = `🎰 ${display} ¡Par! @${username} ganó ${payout} pts (2x). Total: ${finalViewer?.points?.toLocaleString() ?? 0}`
  } else {
    msg = `🎰 ${display} Sin suerte @${username}, perdiste ${bet} pts. Total: ${finalViewer?.points?.toLocaleString() ?? 0}`
  }

  return { ok: true, s1, s2, s3, result, payout, bet, multiplier, msg }
}

module.exports = {
  bjOpen, bjClose, bjIsOpen, bjJoin, bjHit, bjStand,
  rouletteSpin, playSlots,
}
