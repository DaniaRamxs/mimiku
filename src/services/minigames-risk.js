// services/minigames-risk.js — minijuegos por pasos de la pagina de canje:
// "Alta o baja", "Buscaminas de cofres" y "Blackjack contra Hikki".
//
// La apuesta se cobra al empezar. Cada acierto sube el multiplicador y el
// viewer puede cobrar (apuesta x multiplicador) cuando quiera; si falla, lo
// pierde. Las minas y el resultado de cada paso se deciden en el servidor y
// nunca se mandan antes de tiempo. Una partida activa por viewer y juego; si
// recarga la pagina, sigue donde estaba.
const { randomUUID } = require("node:crypto")
const { normalizeRarity } = require("./canje-data.js")
const { createMinigames } = require("./minigames.js")

const HOUSE = { hilo: 0.96, mines: 0.97 }
const HILO_MAX_STEPS = 12
const HILO_TOP = 13
const MINES_CELLS = 25
const MINES_OPTIONS = [3, 5, 8, 12]
const LABELS = { hilo: "Alta o baja", mines: "Buscaminas de cofres", blackjack: "Blackjack contra Hikki" }

// ── Blackjack ──
// Una baraja de 52 cartas barajada por partida (en el servidor). Blackjack
// natural paga 3:2, ganar paga 1:1, empate devuelve la apuesta. Hikki (la
// dealer) pide hasta 17 y se planta en cualquier 17. Doblar: solo con las dos
// primeras cartas, dobla la apuesta, recibe una carta y se planta. Dividir:
// con dos cartas del mismo valor se juegan dos manos (una apuesta mas); 21
// tras dividir no es blackjack, y los ases divididos reciben una carta cada uno.
//
// Doble o nada: si la mano deja ganancia, el premio no se cobra todavia; Hikki
// ofrece arriesgarlo entero a carta mas alta (cada uno saca una de una baraja
// nueva; el As es la mas alta y los empates se repiten). Ganar duplica el bote
// y vuelve a ofrecer; perder lo deja en nada. Como mucho GAMBLE_MAX_ROUNDS
// veces y sin pasar de GAMBLE_CAP_TIMES veces la apuesta maxima del panel: al
// llegar al limite se cobra solo. La partida sigue "active" mientras se
// decide, asi que la oferta sobrevive a recargar la pagina o reiniciar.
const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
const BJ_SUITS = ["S", "H", "D", "C"]
const BJ_PAYS = { blackjack: 2.5, win: 2, "dealer-bust": 2, push: 1 }
const GAMBLE_MAX_ROUNDS = 5
const GAMBLE_CAP_TIMES = 10
const HIGH_VALUES = { A: 14, K: 13, Q: 12, J: 11 }

function highValue(rank) { return HIGH_VALUES[rank] || Number(rank) }

function cardPoints(rank) {
  if (rank === "A") return 11
  if (rank === "J" || rank === "Q" || rank === "K") return 10
  return Number(rank)
}

// Total de una mano; los ases valen 11 salvo que pasen de 21. `soft`: queda un as valiendo 11.
function handTotal(cards) {
  let total = 0
  let aces = 0
  for (const card of cards) { total += cardPoints(card.rank); if (card.rank === "A") aces += 1 }
  while (total > 21 && aces) { total -= 10; aces -= 1 }
  return { total, soft: aces > 0 }
}

function isBlackjack(cards) { return cards.length === 2 && handTotal(cards).total === 21 }

function floor2(value) { return Math.floor(value * 100) / 100 }

// Multiplicador de buscaminas tras `found` cofres con `mines` trampas.
function minesMultiplier(mines, found) {
  let value = HOUSE.mines
  for (let i = 0; i < found; i++) value *= (MINES_CELLS - i) / (MINES_CELLS - mines - i)
  return found ? floor2(value) : 1
}

// Lo que se multiplica al acertar "alta" o "baja" desde `power`.
function hiloStep(power, guess) {
  const favorable = guess === "higher" ? HILO_TOP - power : power - 1
  return favorable > 0 ? floor2(HOUSE.hilo / (favorable / HILO_TOP)) : 0
}

function createRiskGames({ platform, getChannel, now = Date.now, random = Math.random }) {
  const db = platform.db
  const base = createMinigames({ platform, getChannel, now, random })

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso() { return new Date(now()).toISOString() }

  function load(viewerId, game) {
    const row = db.prepare("SELECT * FROM minigame_sessions WHERE channel_id=? AND viewer_id=? AND game=? AND status='active' ORDER BY created_at DESC LIMIT 1")
      .get(activeChannel(), viewerId, game)
    return row ? { ...row, state: JSON.parse(row.state_json) } : null
  }

  function byId(viewerId, id, game) {
    const row = db.prepare("SELECT * FROM minigame_sessions WHERE id=? AND channel_id=? AND viewer_id=? AND game=?").get(String(id), activeChannel(), viewerId, game)
    return row ? { ...row, state: JSON.parse(row.state_json) } : null
  }

  function save(session, status = "active", payout = 0) {
    db.prepare("UPDATE minigame_sessions SET state_json=?, status=?, payout=?, updated_at=? WHERE id=? AND status='active'")
      .run(JSON.stringify(session.state), status, payout, iso(), session.id)
  }

  function validBet(value) {
    const { riskMin, riskMax } = base.getConfig()
    const bet = Number(value)
    return Number.isInteger(bet) && bet >= riskMin && bet <= riskMax ? bet : 0
  }

  // Cobra la apuesta y crea la partida.
  function begin(viewerId, game, betInput, key, state) {
    const existing = load(viewerId, game)
    if (existing) return { ok: false, reason: "active", session: existing }
    const bet = validBet(betInput)
    if (!bet) return { ok: false, reason: "bad-bet" }
    const id = randomUUID()
    try {
      db.transaction(() => {
        base.move(viewerId, -bet, `riesgo:${game}:${key}`, LABELS[game])
        db.prepare("INSERT INTO minigame_sessions(id, channel_id, viewer_id, game, bet, state_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)")
          .run(id, activeChannel(), viewerId, game, bet, JSON.stringify(state), iso(), iso())
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
    return { ok: true, session: byId(viewerId, id, game) }
  }

  // Paga apuesta x multiplicador y cierra la partida (una sola vez).
  function payOut(viewerId, session, multiplier) {
    return payAmount(viewerId, session, Math.floor(session.bet * multiplier))
  }

  function payAmount(viewerId, session, payout) {
    return db.transaction(() => {
      const closed = db.prepare("UPDATE minigame_sessions SET status='cashed', payout=?, updated_at=? WHERE id=? AND status='active'")
        .run(payout, iso(), session.id).changes
      if (!closed) return 0
      if (payout > 0) base.move(viewerId, payout, `riesgo:${session.id}:cobro`, LABELS[session.game])
      return payout
    })()
  }

  // Carta decorativa (un personaje al azar) para el valor que sale.
  function flavorCard() {
    const cards = platform.profiles.droppableCards(activeChannel())
    if (!cards.length) return null
    const card = cards[Math.floor(random() * cards.length)]
    return { id: card.id, name: card.name, rarity: normalizeRarity(card.rarity), imagePath: card.image_path }
  }

  // ── Alta o baja ─────────────────────────────────────────────────────────────
  function hiloPublic(session) {
    const state = session.state
    return {
      id: session.id, bet: session.bet, status: session.status, payout: session.payout,
      power: state.power, card: state.card, multiplier: state.multiplier, steps: state.steps, history: state.history,
      odds: session.status === "active" ? { higher: hiloStep(state.power, "higher"), lower: hiloStep(state.power, "lower") } : null,
      cashout: Math.floor(session.bet * state.multiplier), maxSteps: HILO_MAX_STEPS,
    }
  }

  function hiloStart(viewerId, bet, key) {
    const started = begin(viewerId, "hilo", bet, key, {
      power: 1 + Math.floor(random() * HILO_TOP), card: flavorCard(), multiplier: 1, steps: 0, history: [],
    })
    if (!started.ok) return started.reason === "active" ? { ok: false, reason: "active", game: hiloPublic(started.session) } : started
    return { ok: true, game: hiloPublic(started.session) }
  }

  function hiloGuess(viewerId, id, guess) {
    if (guess !== "higher" && guess !== "lower") return { ok: false, reason: "bad-move" }
    const session = byId(viewerId, id, "hilo")
    if (!session || session.status !== "active") return { ok: false, reason: "no-game" }
    const state = session.state
    const step = hiloStep(state.power, guess)
    if (!step) return { ok: false, reason: "bad-move" }
    const next = 1 + Math.floor(random() * HILO_TOP)
    const previous = state.power
    const outcome = next === previous ? "push" : (guess === "higher" ? next > previous : next < previous) ? "win" : "lose"
    state.history = [...state.history, { from: previous, to: next, guess, outcome }].slice(-HILO_MAX_STEPS)
    state.power = next
    state.card = flavorCard()
    if (outcome === "lose") {
      save(session, "lost")
      return { ok: true, outcome, game: hiloPublic({ ...session, status: "lost" }) }
    }
    if (outcome === "win") { state.multiplier = floor2(state.multiplier * step); state.steps += 1 }
    save(session)
    if (state.steps >= HILO_MAX_STEPS) {
      const payout = payOut(viewerId, session, state.multiplier)
      return { ok: true, outcome, auto: true, game: hiloPublic({ ...session, status: "cashed", payout }) }
    }
    return { ok: true, outcome, game: hiloPublic(session) }
  }

  function hiloCashout(viewerId, id) {
    const session = byId(viewerId, id, "hilo")
    if (!session || session.status !== "active") return { ok: false, reason: "no-game" }
    const payout = payOut(viewerId, session, session.state.multiplier)
    return { ok: true, game: hiloPublic({ ...session, status: "cashed", payout }) }
  }

  // ── Buscaminas de cofres ────────────────────────────────────────────────────
  function minesPublic(session) {
    const state = session.state
    const found = state.revealed.length
    const multiplier = minesMultiplier(state.mines.length, found)
    return {
      id: session.id, bet: session.bet, status: session.status, payout: session.payout,
      mineCount: state.mines.length, revealed: state.revealed, hit: state.hit === undefined ? null : state.hit,
      multiplier, next: found < MINES_CELLS - state.mines.length ? minesMultiplier(state.mines.length, found + 1) : null,
      cashout: Math.floor(session.bet * multiplier),
      // Las trampas solo se ensenan cuando la partida termina.
      mines: session.status === "active" ? null : state.mines,
    }
  }

  function minesStart(viewerId, bet, mineCount, key) {
    const count = Number(mineCount)
    if (!MINES_OPTIONS.includes(count)) return { ok: false, reason: "bad-mines" }
    const cells = Array.from({ length: MINES_CELLS }, (_, index) => index)
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]] }
    const started = begin(viewerId, "mines", bet, key, { mines: cells.slice(0, count).sort((a, b) => a - b), revealed: [] })
    if (!started.ok) return started.reason === "active" ? { ok: false, reason: "active", game: minesPublic(started.session) } : started
    return { ok: true, game: minesPublic(started.session) }
  }

  function minesReveal(viewerId, id, cell) {
    const index = Number(cell)
    if (!Number.isInteger(index) || index < 0 || index >= MINES_CELLS) return { ok: false, reason: "bad-move" }
    const session = byId(viewerId, id, "mines")
    if (!session || session.status !== "active") return { ok: false, reason: "no-game" }
    const state = session.state
    if (state.revealed.includes(index)) return { ok: true, outcome: "repeat", game: minesPublic(session) }
    if (state.mines.includes(index)) {
      state.hit = index
      save(session, "lost")
      return { ok: true, outcome: "trap", game: minesPublic({ ...session, status: "lost" }) }
    }
    state.revealed = [...state.revealed, index]
    save(session)
    if (state.revealed.length >= MINES_CELLS - state.mines.length) {
      const payout = payOut(viewerId, session, minesMultiplier(state.mines.length, state.revealed.length))
      return { ok: true, outcome: "chest", auto: true, game: minesPublic({ ...session, status: "cashed", payout }) }
    }
    return { ok: true, outcome: "chest", game: minesPublic(session) }
  }

  function minesCashout(viewerId, id) {
    const session = byId(viewerId, id, "mines")
    if (!session || session.status !== "active") return { ok: false, reason: "no-game" }
    const payout = payOut(viewerId, session, minesMultiplier(session.state.mines.length, session.state.revealed.length))
    return { ok: true, game: minesPublic({ ...session, status: "cashed", payout }) }
  }

  // ── Blackjack contra Hikki ──────────────────────────────────────────────────
  function bjDeck() {
    const deck = []
    for (const suit of BJ_SUITS) for (const rank of BJ_RANKS) deck.push({ rank, suit })
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]] }
    return deck
  }

  // Manos del viewer. Las partidas de antes del split guardaban una sola mano
  // en `player`: se leen como una lista de una mano.
  function bjHands(session) {
    const state = session.state
    if (!state.hands) {
      state.hands = [{ cards: state.player, bet: session.bet, doubled: !!state.doubled, result: state.result || null }]
      state.current = 0
      delete state.player
      delete state.doubled
    }
    return state.hands
  }

  function bjCanSplit(session) {
    const hands = bjHands(session)
    if (hands.length !== 1 || hands[0].cards.length !== 2) return false
    const [a, b] = hands[0].cards
    return cardPoints(a.rank) === cardPoints(b.rank)
  }

  // ── Doble o nada ──
  function gambleCap() { return base.getConfig().riskMax * GAMBLE_CAP_TIMES }
  function canGamble(offer) { return offer.round < GAMBLE_MAX_ROUNDS && offer.pot * 2 <= gambleCap() }

  function gamblePublic(session) {
    const offer = session.state.offer
    if (!offer) return null
    const open = session.status === "active"
    return {
      pot: offer.pot, round: offer.round, maxRounds: GAMBLE_MAX_ROUNDS, next: offer.pot * 2,
      canGamble: open && canGamble(offer), last: offer.last || null, lost: !!offer.lost,
    }
  }

  // La carta tapada de Hikki y la baraja nunca salen mientras se juega.
  // `player`/`playerTotal` son la mano que se esta jugando (o la unica).
  // Con la oferta de doble o nada la mano ya termino: se ensena todo.
  function bjPublic(session) {
    const state = session.state
    const hands = bjHands(session)
    const done = session.status !== "active" || !!state.offer
    const current = Math.min(state.current || 0, hands.length - 1)
    const hand = hands[current]
    const player = handTotal(hand.cards)
    const dealerCards = done ? state.dealer : [state.dealer[0], { hidden: true }]
    const dealer = handTotal(done ? state.dealer : [state.dealer[0]])
    return {
      id: session.id, bet: session.bet, status: session.status, payout: session.payout,
      player: hand.cards, playerTotal: player.total, playerSoft: player.soft,
      hands: hands.map(item => { const total = handTotal(item.cards); return { cards: item.cards, total: total.total, soft: total.soft, bet: item.bet, doubled: !!item.doubled, result: item.result || null } }),
      current, split: hands.length > 1,
      dealer: dealerCards, dealerTotal: dealer.total,
      doubled: !!hand.doubled, result: hands.length > 1 ? (done ? "split" : null) : hand.result || null,
      canDouble: !done && hand.cards.length === 2 && !hand.doubled && !hand.splitAce,
      canSplit: !done && bjCanSplit(session),
      offering: session.status === "active" && !!state.offer,
      gamble: gamblePublic(session),
    }
  }

  // Cierra la mano: si deja ganancia, ofrece doble o nada (sin pagar aun);
  // si no, paga lo que sumen las manos o queda perdida.
  function bjSettle(viewerId, session) {
    const payout = bjHands(session).reduce((sum, hand) => sum + Math.floor(hand.bet * (BJ_PAYS[hand.result] || 0)), 0)
    if (!payout) {
      save(session, "lost")
      return { ...session, status: "lost", payout: 0 }
    }
    if (payout > session.bet && canGamble({ round: 0, pot: payout })) {
      session.state.offer = { pot: payout, round: 0, last: null }
      save(session)
      return session
    }
    save(session)
    return { ...session, status: "cashed", payout: payAmount(viewerId, session, payout) }
  }

  // Hikki juega su mano (si queda alguna mano viva) y se compara cada una.
  function bjDealerTurn(viewerId, session) {
    const state = session.state
    const hands = bjHands(session)
    const alive = hands.filter(hand => hand.result !== "bust")
    if (alive.length) {
      while (handTotal(state.dealer).total < 17) state.dealer.push(state.deck.pop())
      const dealer = handTotal(state.dealer).total
      for (const hand of alive) {
        const player = handTotal(hand.cards).total
        hand.result = dealer > 21 ? "dealer-bust" : player > dealer ? "win" : player < dealer ? "lose" : "push"
      }
    }
    return bjSettle(viewerId, session)
  }

  // Pasa a la siguiente mano (las de 21 se plantan solas); tras la ultima juega Hikki.
  function bjAdvance(viewerId, session) {
    const state = session.state
    const hands = bjHands(session)
    state.current = (state.current || 0) + 1
    while (state.current < hands.length && (hands[state.current].splitAce || handTotal(hands[state.current].cards).total >= 21)) state.current += 1
    if (state.current >= hands.length) {
      state.current = hands.length - 1
      return bjPublic(bjDealerTurn(viewerId, session))
    }
    save(session)
    return bjPublic(session)
  }

  function bjStart(viewerId, bet, key) {
    const deck = bjDeck()
    const player = [deck.pop()]
    const dealer = [deck.pop()]
    player.push(deck.pop())
    dealer.push(deck.pop())
    const state = { deck, dealer, hands: [{ cards: player, bet: validBet(bet), doubled: false, result: null }], current: 0 }
    const started = begin(viewerId, "blackjack", bet, key, state)
    if (!started.ok) return started.reason === "active" ? { ok: false, reason: "active", game: bjPublic(started.session) } : started
    const session = started.session
    // Naturales: se resuelve al momento (Hikki mira su carta tapada).
    const hand = session.state.hands[0]
    const playerBj = isBlackjack(hand.cards)
    const dealerBj = isBlackjack(session.state.dealer)
    if (playerBj || dealerBj) {
      hand.result = playerBj && dealerBj ? "push" : playerBj ? "blackjack" : "dealer-blackjack"
      return { ok: true, game: bjPublic(bjSettle(viewerId, session)) }
    }
    return { ok: true, game: bjPublic(session) }
  }

  function bjActive(viewerId, id) {
    const session = byId(viewerId, id, "blackjack")
    if (!session || session.status !== "active") return null
    bjHands(session)
    return session
  }

  // Mano que aun se esta jugando. Con la oferta de doble o nada abierta la
  // mano ya termino: pedir, plantarse, doblar o dividir no valen (una pagina
  // vieja que no conoce la oferta podria intentarlo y perder lo ganado).
  function bjPlaying(viewerId, id) {
    const session = bjActive(viewerId, id)
    if (!session) return { error: "no-game" }
    if (session.state.offer) return { error: "offer" }
    return { session }
  }

  function bjHit(viewerId, id) {
    const { session, error } = bjPlaying(viewerId, id)
    if (error) return { ok: false, reason: error }
    const hand = session.state.hands[session.state.current]
    if (hand.splitAce) return { ok: false, reason: "bad-move" }
    hand.cards.push(session.state.deck.pop())
    const total = handTotal(hand.cards).total
    if (total > 21) hand.result = "bust"
    if (total >= 21) return { ok: true, game: bjAdvance(viewerId, session) }
    save(session)
    return { ok: true, game: bjPublic(session) }
  }

  function bjStand(viewerId, id) {
    const { session, error } = bjPlaying(viewerId, id)
    if (error) return { ok: false, reason: error }
    return { ok: true, game: bjAdvance(viewerId, session) }
  }

  // Cobra otra apuesta igual a `amount` y la suma a la partida.
  function bjCharge(viewerId, session, amount, tag) {
    try {
      db.transaction(() => {
        base.move(viewerId, -amount, `riesgo:${session.id}:${tag}`, LABELS.blackjack)
        db.prepare("UPDATE minigame_sessions SET bet=? WHERE id=? AND status='active'").run(session.bet + amount, session.id)
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return false
      throw error
    }
    session.bet += amount
    return true
  }

  // Doblar: cobra otra apuesta igual (la de esa mano), una carta y se planta.
  function bjDouble(viewerId, id) {
    const { session, error } = bjPlaying(viewerId, id)
    if (error) return { ok: false, reason: error }
    const index = session.state.current
    const hand = session.state.hands[index]
    if (hand.cards.length !== 2 || hand.doubled || hand.splitAce) return { ok: false, reason: "bad-move" }
    if (!bjCharge(viewerId, session, hand.bet, `doble:${index}`)) return { ok: false, reason: "insufficient" }
    hand.bet *= 2
    hand.doubled = true
    hand.cards.push(session.state.deck.pop())
    if (handTotal(hand.cards).total > 21) hand.result = "bust"
    return { ok: true, game: bjAdvance(viewerId, session) }
  }

  // Dividir: dos cartas del mismo valor pasan a ser dos manos con la misma
  // apuesta, cada una recibe otra carta. Con ases, una carta por mano y se plantan.
  function bjSplit(viewerId, id) {
    const { session, error } = bjPlaying(viewerId, id)
    if (error) return { ok: false, reason: error }
    if (!bjCanSplit(session)) return { ok: false, reason: "bad-move" }
    const [hand] = session.state.hands
    if (!bjCharge(viewerId, session, hand.bet, "dividir")) return { ok: false, reason: "insufficient" }
    const deck = session.state.deck
    const aces = hand.cards[0].rank === "A"
    session.state.hands = hand.cards.map(card => ({ cards: [card, deck.pop()], bet: hand.bet, doubled: false, result: null, splitAce: aces }))
    session.state.current = -1
    return { ok: true, game: bjAdvance(viewerId, session) }
  }

  function bjOffer(viewerId, id) {
    const session = bjActive(viewerId, id)
    return session && session.state.offer ? session : null
  }

  // Cobrar el bote de la oferta.
  function bjTake(viewerId, id) {
    const session = bjOffer(viewerId, id)
    if (!session) return { ok: false, reason: "no-game" }
    save(session)
    const payout = payAmount(viewerId, session, session.state.offer.pot)
    return { ok: true, game: bjPublic({ ...session, status: "cashed", payout }) }
  }

  // Carta mas alta contra Hikki con una baraja nueva; los empates se repiten.
  function bjGamble(viewerId, id) {
    const session = bjOffer(viewerId, id)
    if (!session) return { ok: false, reason: "no-game" }
    const offer = session.state.offer
    if (!canGamble(offer)) return { ok: false, reason: "bad-move" }
    const deck = bjDeck()
    const ties = []
    let mine = deck.pop()
    let hers = deck.pop()
    while (highValue(mine.rank) === highValue(hers.rank) && deck.length >= 2) {
      ties.push({ mine, hers })
      mine = deck.pop()
      hers = deck.pop()
    }
    const won = highValue(mine.rank) > highValue(hers.rank)
    offer.last = { mine, hers, ties, won }
    if (!won) {
      offer.lost = true
      save(session, "lost")
      return { ok: true, outcome: "lose", game: bjPublic({ ...session, status: "lost", payout: 0 }) }
    }
    offer.pot *= 2
    offer.round += 1
    save(session)
    if (!canGamble(offer)) {
      const payout = payAmount(viewerId, session, offer.pot)
      return { ok: true, outcome: "win", auto: true, game: bjPublic({ ...session, status: "cashed", payout }) }
    }
    return { ok: true, outcome: "win", game: bjPublic(session) }
  }

  // Partidas a medias (para seguir tras recargar la pagina).
  function active(viewerId) {
    const hilo = load(viewerId, "hilo")
    const mines = load(viewerId, "mines")
    const blackjack = load(viewerId, "blackjack")
    return { hilo: hilo ? hiloPublic(hilo) : null, mines: mines ? minesPublic(mines) : null, blackjack: blackjack ? bjPublic(blackjack) : null }
  }

  return { hiloStart, hiloGuess, hiloCashout, minesStart, minesReveal, minesCashout, bjStart, bjHit, bjStand, bjDouble, bjSplit, bjTake, bjGamble, active }
}

module.exports = { createRiskGames, minesMultiplier, hiloStep, handTotal, isBlackjack, highValue, MINES_OPTIONS, MINES_CELLS, HILO_TOP, HILO_MAX_STEPS, GAMBLE_MAX_ROUNDS, GAMBLE_CAP_TIMES }
