// services/canje-duels.js — duelos entre viewers en la pagina de canje.
//
// Quien reta elige juego y apuesta; sus puntos quedan apartados. Al rival le
// llega al Buzon; si acepta, aparta lo mismo. El ganador se lleva el bote
// menos la comision (DUEL_FEE); en empate cada uno recupera lo suyo.
// Rechazar, cancelar o dejar pasar 24 h sin respuesta devuelve la apuesta.
// Todo se decide en el servidor.
//
// Juegos:
// - "bj" (Duelo a 21): quien reta juega su mano al retar (queda oculta) y el
//   rival la suya al aceptar, cada uno con su baraja. Gana el mas cerca de
//   21 sin pasarse; un blackjack de dos cartas gana a un 21 de mas cartas.
// - "checkers" (Damas): partida por turnos (core/checkers.js). Quien reta
//   lleva las rojas y empieza. Quien no mueve en TURN_MS pierde; se puede
//   rendir; QUIET_LIMIT jugadas sin comer ni coronar es tablas.
const { randomUUID } = require("node:crypto")
const { handTotal, isBlackjack } = require("./minigames-risk.js")
const { isKnownBot } = require("../core/known-bots.js")
const checkers = require("../core/checkers.js")

const GAMES = { bj: "Duelo a 21", checkers: "Damas" }
const DUEL_FEE = 0.05
const EXPIRE_MS = 24 * 60 * 60_000
const DRAFT_EXPIRE_MS = 60 * 60_000 // una mano de 21 empezada y no enviada
const TURN_MS = 12 * 60 * 60_000
const QUIET_LIMIT = 40
const MAX_PENDING = 3
const RECENT = 10
const KEY_PATTERN = /^[a-z0-9-]{8,64}$/i
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
const SUITS = ["S", "H", "D", "C"]

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "no-rival": "Esa persona no usa la página todavía.",
  self: "No puedes retarte a ti mismo.",
  bot: "Los bots no aceptan duelos.",
  "bad-game": "Elige un juego.",
  "bad-bet": "La apuesta no está dentro de los límites.",
  insufficient: "No te alcanzan los puntos.",
  "too-many": "Ya tienes 3 duelos esperando respuesta. Espera a que te contesten.",
  "no-duel": "Ese duelo ya no existe o ya terminó.",
  "not-yours": "Ese duelo no es tuyo.",
  "not-your-turn": "No es tu turno.",
  "bad-move": "Ese movimiento no vale. Recuerda que comer es obligatorio.",
  "bad-key": "Petición no válida. Recarga la página.",
}

function createCanjeDuels({ platform, getChannel, getLimits, feed = null, now = Date.now, random = Math.random }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }
  function iso(at = now()) { return new Date(at).toISOString() }

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }
  function byLogin(login) {
    const username = String(login || "").trim().toLowerCase()
    if (!/^[a-z0-9_]{1,25}$/.test(username)) return null
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND lower(username)=?").get(username) || null
  }
  function identity(id) { return db.prepare("SELECT * FROM viewer_identities WHERE id=?").get(id) || {} }
  function nameOf(row) { return row.display || row.username || "?" }
  function gameName(game) { return GAMES[game] || "Duelo" }

  function move(viewerId, delta, key, reason) {
    platform.economy.applyMovement({ channelId: activeChannel(), viewerId, balanceDelta: delta, idempotencyKey: key, reason, sourceType: "duel", sourceId: "duelo" })
  }

  function load(id) {
    const row = db.prepare("SELECT * FROM canje_duels WHERE id=? AND channel_id=?").get(String(id || ""), activeChannel())
    if (!row) return null
    return { ...row, challenger: JSON.parse(row.challenger_json || "{}"), opponent: JSON.parse(row.opponent_json || "{}") }
  }
  function save(duel, fields = {}) {
    const next = { ...duel, ...fields }
    db.prepare(`UPDATE canje_duels SET status=?, challenger_json=?, opponent_json=?, winner=?, payout=?, fee=?, sent_at=?, accepted_at=?, resolved_at=?,
      challenger_seen=?, opponent_seen=? WHERE id=?`).run(next.status, JSON.stringify(next.challenger), JSON.stringify(next.opponent), next.winner || null,
      next.payout || 0, next.fee || 0, next.sent_at || null, next.accepted_at || null, next.resolved_at || null, next.challenger_seen ? 1 : 0, next.opponent_seen ? 1 : 0, duel.id)
    return next
  }

  // ── Duelo a 21 ──
  function deck() {
    const cards = []
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit })
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]] }
    return cards
  }
  function newHand() {
    const cards = deck()
    return settleHand({ deck: cards, hand: [cards.pop(), cards.pop()], done: false })
  }
  function settleHand(side) {
    const total = handTotal(side.hand).total
    if (total >= 21) side.done = true
    side.total = total
    side.natural = isBlackjack(side.hand)
    return side
  }
  function bjWinner(a, b) {
    const aBust = a.total > 21
    const bBust = b.total > 21
    if (aBust && bBust) return "push"
    if (aBust) return "opponent"
    if (bBust) return "challenger"
    if (a.total !== b.total) return a.total > b.total ? "challenger" : "opponent"
    if (a.natural !== b.natural) return a.natural ? "challenger" : "opponent"
    return "push"
  }

  // ── Damas ── (el estado va en challenger_json: board, turn, continueFrom...)
  const SIDE_OF = { challenger: "a", opponent: "b" }
  const ROLE_OF = { a: "challenger", b: "opponent" }
  function newGame() {
    return { board: checkers.initialBoard(), turn: "a", continueFrom: null, quiet: 0, moves: 0, lastMove: null, turnStartedAt: iso() }
  }

  // ── Resultado ──
  function resolve(duel, winner, extra = {}) {
    const pot = duel.bet * 2
    const fee = winner === "push" ? 0 : Math.floor(pot * DUEL_FEE)
    const payout = winner === "push" ? 0 : pot - fee
    db.transaction(() => {
      if (winner === "push") {
        move(duel.challenger_id, duel.bet, `duelo:${duel.id}:devolucion-reta`, `${gameName(duel.game)}: empate`)
        move(duel.opponent_id, duel.bet, `duelo:${duel.id}:devolucion-rival`, `${gameName(duel.game)}: empate`)
      } else {
        const winnerId = winner === "challenger" ? duel.challenger_id : duel.opponent_id
        move(winnerId, payout, `duelo:${duel.id}:premio`, `${gameName(duel.game)}: ganaste`)
      }
    })()
    const done = save({ ...duel, ...extra }, { status: "done", winner, payout, fee, resolved_at: iso(), challenger_seen: 0, opponent_seen: 0 })
    report(done)
    return done
  }

  function report(duel) {
    if (!feed) return
    try {
      const a = identity(duel.challenger_id)
      const b = identity(duel.opponent_id)
      const label = duel.game === "checkers" ? "una partida de damas" : "un duelo a 21"
      if (duel.winner === "push") {
        feed.record(activeChannel(), { game: "duelo", viewerId: duel.challenger_id, who: nameOf(a), label: `Empató ${label} con ${nameOf(b)}`, net: 0, outcome: "even" })
        return
      }
      const winner = duel.winner === "challenger" ? a : b
      const loser = duel.winner === "challenger" ? b : a
      feed.record(activeChannel(), {
        game: "duelo", viewerId: winner.id, who: nameOf(winner), owner: nameOf(loser), ownerId: loser.id,
        label: `Le ganó ${label} a ${nameOf(loser)}`, net: duel.payout - duel.bet, outcome: "win", big: duel.bet >= 25000,
      })
    } catch (error) { /* el tablon nunca debe romper un duelo */ }
  }

  function refundChallenger(duel, status, why) {
    db.transaction(() => {
      move(duel.challenger_id, duel.bet, `duelo:${duel.id}:devolucion-reta`, `${gameName(duel.game)}: ${why}`)
      save(duel, { status, resolved_at: iso() })
    })()
  }

  // Caducados: retos sin respuesta (se devuelve), manos de 21 a medias y
  // partidas de damas en las que el que tenia que mover no movio (pierde).
  function sweep() {
    const channelId = activeChannel()
    const rows = db.prepare("SELECT id FROM canje_duels WHERE channel_id=? AND status IN ('drafting','open','playing')").all(channelId)
    for (const { id } of rows) {
      const duel = load(id)
      if (!duel) continue
      if (!GAMES[duel.game] && duel.status !== "playing") { refundChallenger(duel, "expired", "juego retirado"); continue }
      if (duel.status === "open" && Date.parse(duel.sent_at) < now() - EXPIRE_MS) { refundChallenger(duel, "expired", "caducado"); continue }
      if (duel.status === "drafting" && Date.parse(duel.created_at) < now() - DRAFT_EXPIRE_MS) { refundChallenger(duel, "expired", "caducado"); continue }
      if (duel.status !== "playing") continue
      if (duel.game === "bj" && Date.parse(duel.accepted_at) < now() - DRAFT_EXPIRE_MS) {
        const closed = settleHand({ ...duel.opponent, done: true })
        resolve(duel, bjWinner(duel.challenger, closed), { opponent: closed })
      }
      if (duel.game === "checkers" && Date.parse(duel.challenger.turnStartedAt) < now() - TURN_MS) {
        // Se le acabo el tiempo al que tenia que mover.
        resolve(duel, duel.challenger.turn === "a" ? "opponent" : "challenger", { challenger: { ...duel.challenger, ended: "timeout" } })
      } else if (!GAMES[duel.game]) {
        resolve(duel, "push")
      }
    }
  }

  // ── Lo que ve cada uno ──
  function bjSide(side, reveal) {
    if (!side || !Object.keys(side).length) return null
    return reveal ? { hand: side.hand, total: side.total, natural: !!side.natural, done: !!side.done } : { hidden: true, done: !!side.done }
  }

  function checkersView(duel, role) {
    const state = duel.challenger
    if (!state || !state.board) return null
    const mySide = SIDE_OF[role]
    const playing = duel.status === "playing"
    const myTurn = playing && state.turn === mySide
    return {
      board: state.board, mySide, turn: state.turn, lastMove: state.lastMove, continueFrom: state.continueFrom,
      moves: myTurn ? checkers.legalMoves(state.board, mySide, state.continueFrom) : [],
      pieces: { mine: checkers.count(state.board, mySide), rival: checkers.count(state.board, checkers.other(mySide)) },
      turnEndsAt: playing ? iso(Date.parse(state.turnStartedAt) + TURN_MS) : null, ended: state.ended || null, moveCount: state.moves || 0,
    }
  }

  function view(duel, me) {
    const role = duel.challenger_id === me.id ? "challenger" : "opponent"
    const done = duel.status === "done"
    const a = identity(duel.challenger_id)
    const b = identity(duel.opponent_id)
    const person = row => ({ login: row.username, display: nameOf(row), avatar: /^https:\/\//.test(row.avatar_url || "") ? row.avatar_url : null })
    let myTurn = false
    if (duel.game === "bj") myTurn = (duel.status === "drafting" && role === "challenger") || (duel.status === "playing" && role === "opponent")
    if (duel.game === "checkers") myTurn = duel.status === "playing" && duel.challenger.turn === SIDE_OF[role]
    const base = {
      id: duel.id, game: duel.game, gameName: gameName(duel.game), bet: duel.bet, status: duel.status, role,
      challenger: person(a), opponent: person(b), myTurn,
      canAccept: duel.status === "open" && role === "opponent", canCancel: duel.status === "open" && role === "challenger",
      canResign: duel.game === "checkers" && duel.status === "playing",
      winner: duel.winner || null, won: done && duel.winner === role, payout: duel.payout || 0, fee: duel.fee || 0,
      createdAt: duel.created_at, sentAt: duel.sent_at, resolvedAt: duel.resolved_at,
      expiresAt: duel.sent_at && duel.status === "open" ? iso(Date.parse(duel.sent_at) + EXPIRE_MS) : null,
      unseen: done && !(role === "challenger" ? duel.challenger_seen : duel.opponent_seen),
    }
    if (duel.game === "checkers") return { ...base, checkers: checkersView(duel, role) }
    return {
      ...base,
      me: bjSide(role === "challenger" ? duel.challenger : duel.opponent, true),
      rival: bjSide(role === "challenger" ? duel.opponent : duel.challenger, done),
    }
  }

  function validBet(value) {
    const { riskMin, riskMax } = getLimits()
    const bet = Number(value)
    return Number.isInteger(bet) && bet >= riskMin && bet <= riskMax ? bet : 0
  }
  function balanceOf(me) { return platform.economy.getBalance(activeChannel(), me.id).balance }

  // ── Retar ──
  function create(twitchId, input = {}) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    if (!KEY_PATTERN.test(String(input.key || ""))) return { ok: false, reason: "bad-key" }
    const requestKey = `${twitchId}:${input.key}`
    const repeated = db.prepare("SELECT id FROM canje_duels WHERE request_key=?").get(requestKey)
    if (repeated) return { ok: true, duel: view(load(repeated.id), me) }
    const rival = byLogin(input.login)
    if (!rival || !db.prepare("SELECT 1 FROM viewer_profiles WHERE channel_id=? AND viewer_id=?").get(activeChannel(), rival.id)) return { ok: false, reason: "no-rival" }
    if (rival.id === me.id) return { ok: false, reason: "self" }
    if (isKnownBot(rival.username)) return { ok: false, reason: "bot" }
    const game = GAMES[input.game] ? input.game : null
    if (!game) return { ok: false, reason: "bad-game" }
    const bet = validBet(input.bet)
    if (!bet) return { ok: false, reason: "bad-bet" }
    const pending = db.prepare("SELECT COUNT(*) AS n FROM canje_duels WHERE channel_id=? AND challenger_id=? AND status IN ('drafting','open')").get(activeChannel(), me.id).n
    if (pending >= MAX_PENDING) return { ok: false, reason: "too-many" }
    const challenger = game === "bj" ? newHand() : {}
    const id = randomUUID()
    const status = game === "checkers" || challenger.done ? "open" : "drafting"
    try {
      db.transaction(() => {
        move(me.id, -bet, `duelo:${id}:apuesta-reta`, `${gameName(game)} contra ${nameOf(rival)}`)
        db.prepare(`INSERT INTO canje_duels(id, channel_id, game, challenger_id, opponent_id, bet, status, challenger_json, opponent_json, request_key, created_at, sent_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, activeChannel(), game, me.id, rival.id, bet, status, JSON.stringify(challenger), "{}", requestKey, iso(), status === "open" ? iso() : null)
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
    return { ok: true, duel: view(load(id), me) }
  }

  // ── Duelo a 21: pedir / plantarse ──
  function step(twitchId, id, action) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    const duel = load(id)
    if (!duel || duel.game !== "bj") return { ok: false, reason: "no-duel" }
    const side = duel.status === "drafting" && duel.challenger_id === me.id ? "challenger" : duel.status === "playing" && duel.opponent_id === me.id ? "opponent" : null
    if (!side) return { ok: false, reason: duel.challenger_id === me.id || duel.opponent_id === me.id ? "not-your-turn" : "not-yours" }
    const hand = duel[side]
    if (action === "hit") hand.hand.push(hand.deck.pop())
    if (action === "stand") hand.done = true
    settleHand(hand)
    if (!hand.done) return { ok: true, duel: view(save(duel), me) }
    if (side === "challenger") return { ok: true, duel: view(save(duel, { status: "open", sent_at: iso() }), me) }
    return { ok: true, duel: view(resolve(duel, bjWinner(duel.challenger, duel.opponent)), me), balance: balanceOf(me) }
  }

  // ── Damas: mover y rendirse ──
  function playMove(twitchId, id, from, to) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    const duel = load(id)
    if (!duel || duel.game !== "checkers" || duel.status !== "playing") return { ok: false, reason: "no-duel" }
    const role = duel.challenger_id === me.id ? "challenger" : duel.opponent_id === me.id ? "opponent" : null
    if (!role) return { ok: false, reason: "not-yours" }
    const state = duel.challenger
    const side = SIDE_OF[role]
    if (state.turn !== side) return { ok: false, reason: "not-your-turn" }
    const square = value => (Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n >= 0 && n < 8) ? value : null)
    if (!square(from) || !square(to)) return { ok: false, reason: "bad-move" }
    const result = checkers.applyMove(state.board, side, from, to, state.continueFrom)
    if (!result) return { ok: false, reason: "bad-move" }
    const next = {
      ...state, board: result.board, continueFrom: result.continueFrom, moves: (state.moves || 0) + 1,
      quiet: result.captured || result.promoted ? 0 : (state.quiet || 0) + 1,
      lastMove: { from, to, side, captured: result.captured, promoted: result.promoted },
    }
    if (!result.continueFrom) {
      next.turn = checkers.other(side)
      next.turnStartedAt = iso()
    }
    const stuck = result.continueFrom ? null : checkers.loserIfStuck(next.board, next.turn)
    if (stuck) return { ok: true, duel: view(resolve(duel, ROLE_OF[checkers.other(stuck)], { challenger: { ...next, ended: "win" } }), me), balance: balanceOf(me) }
    if (next.quiet >= QUIET_LIMIT) return { ok: true, duel: view(resolve(duel, "push", { challenger: { ...next, ended: "quiet" } }), me), balance: balanceOf(me) }
    return { ok: true, duel: view(save(duel, { challenger: next }), me) }
  }

  function resign(twitchId, id) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    const duel = load(id)
    if (!duel || duel.game !== "checkers" || duel.status !== "playing") return { ok: false, reason: "no-duel" }
    const role = duel.challenger_id === me.id ? "challenger" : duel.opponent_id === me.id ? "opponent" : null
    if (!role) return { ok: false, reason: "not-yours" }
    const done = resolve(duel, role === "challenger" ? "opponent" : "challenger", { challenger: { ...duel.challenger, ended: "resign" } })
    return { ok: true, duel: view(done, me), balance: balanceOf(me) }
  }

  // ── Responder ──
  function accept(twitchId, id) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    const duel = load(id)
    if (!duel || duel.status !== "open") return { ok: false, reason: "no-duel" }
    if (duel.opponent_id !== me.id) return { ok: false, reason: "not-yours" }
    const opponent = duel.game === "bj" ? newHand() : {}
    const challenger = duel.game === "checkers" ? newGame() : duel.challenger
    try {
      db.transaction(() => {
        move(me.id, -duel.bet, `duelo:${duel.id}:apuesta-rival`, `${gameName(duel.game)} contra ${nameOf(identity(duel.challenger_id))}`)
        const changed = db.prepare("UPDATE canje_duels SET status='playing', accepted_at=?, opponent_json=?, challenger_json=? WHERE id=? AND status='open'")
          .run(iso(), JSON.stringify(opponent), JSON.stringify(challenger), duel.id).changes
        if (!changed) throw new Error("duelo-ocupado")
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      if (error.message === "duelo-ocupado") return { ok: false, reason: "no-duel" }
      throw error
    }
    const playing = { ...duel, status: "playing", accepted_at: iso(), opponent, challenger }
    if (duel.game === "bj" && opponent.done) return { ok: true, duel: view(resolve(playing, bjWinner(playing.challenger, opponent)), me), balance: balanceOf(me) }
    return { ok: true, duel: view(playing, me), balance: balanceOf(me) }
  }

  // Rechazar (rival) o cancelar (quien reta, antes de que respondan).
  function decline(twitchId, id) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    const duel = load(id)
    if (!duel || (duel.status !== "open" && duel.status !== "drafting")) return { ok: false, reason: "no-duel" }
    const asOpponent = duel.opponent_id === me.id && duel.status === "open"
    const asChallenger = duel.challenger_id === me.id
    if (!asOpponent && !asChallenger) return { ok: false, reason: "not-yours" }
    db.transaction(() => {
      move(duel.challenger_id, duel.bet, `duelo:${duel.id}:devolucion-reta`, `${gameName(duel.game)}: ${asOpponent ? "rechazado" : "cancelado"}`)
      save(duel, { status: asOpponent ? "declined" : "cancelled", resolved_at: iso(), challenger_seen: asChallenger ? 1 : 0, opponent_seen: 1 })
    })()
    return { ok: true, balance: balanceOf(me) }
  }

  function markSeen(twitchId, id) {
    const me = findViewer(twitchId)
    const duel = me && load(id)
    if (!duel) return { ok: false, reason: "no-duel" }
    if (duel.challenger_id === me.id) db.prepare("UPDATE canje_duels SET challenger_seen=1 WHERE id=?").run(duel.id)
    else if (duel.opponent_id === me.id) db.prepare("UPDATE canje_duels SET opponent_seen=1 WHERE id=?").run(duel.id)
    else return { ok: false, reason: "not-yours" }
    return { ok: true }
  }

  // ── Listas ──
  function get(twitchId, id) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    const duel = load(id)
    if (!duel) return { ok: false, reason: "no-duel" }
    if (duel.challenger_id !== me.id && duel.opponent_id !== me.id) return { ok: false, reason: "not-yours" }
    return { ok: true, duel: view(duel, me) }
  }

  function list(twitchId) {
    sweep()
    const me = findViewer(twitchId)
    if (!me) return { ok: false, reason: "unknown-viewer" }
    const channelId = activeChannel()
    const rows = sql => db.prepare(sql).all(channelId, me.id, me.id).map(row => view(load(row.id), me))
    const { riskMin, riskMax } = getLimits()
    return {
      ok: true,
      active: rows("SELECT id FROM canje_duels WHERE channel_id=? AND (challenger_id=? OR opponent_id=?) AND status IN ('drafting','open','playing') ORDER BY created_at DESC"),
      recent: rows(`SELECT id FROM canje_duels WHERE channel_id=? AND (challenger_id=? OR opponent_id=?) AND status='done' ORDER BY resolved_at DESC LIMIT ${RECENT}`),
      fee: DUEL_FEE, limits: { min: riskMin, max: riskMax },
    }
  }

  // Para la cabecera (/api/state): retos por contestar, turnos y resultados sin ver.
  function summary(twitchId) {
    const me = findViewer(twitchId)
    if (!me) return { incoming: 0, myTurn: 0, results: 0 }
    sweep()
    const channelId = activeChannel()
    const one = (sql, ...params) => db.prepare(sql).get(channelId, ...params).n
    const playing = db.prepare("SELECT id FROM canje_duels WHERE channel_id=? AND status IN ('drafting','playing') AND (challenger_id=? OR opponent_id=?)").all(channelId, me.id, me.id)
    return {
      incoming: one("SELECT COUNT(*) AS n FROM canje_duels WHERE channel_id=? AND opponent_id=? AND status='open'", me.id),
      myTurn: playing.filter(row => view(load(row.id), me).myTurn).length,
      results: one("SELECT COUNT(*) AS n FROM canje_duels WHERE channel_id=? AND status='done' AND ((challenger_id=? AND challenger_seen=0) OR (opponent_id=? AND opponent_seen=0))", me.id, me.id),
    }
  }

  return { create, step, playMove, resign, accept, decline, markSeen, get, list, summary, sweep }
}

const DUELS_ROUTES = {
  "/api/duels": "GET",
  "/api/duels/one": "GET",
  "/api/duels/create": "POST",
  "/api/duels/hit": "POST",
  "/api/duels/stand": "POST",
  "/api/duels/move": "POST",
  "/api/duels/resign": "POST",
  "/api/duels/accept": "POST",
  "/api/duels/decline": "POST",
  "/api/duels/seen": "POST",
}

async function handleDuelsApi({ pathname, url, readJson, user, duels }) {
  const reply = result => {
    if (result.ok) return [200, result]
    const status = result.reason === "no-duel" || result.reason === "no-rival" ? 404 : result.reason === "not-yours" ? 403 : ["bad-key", "bad-game", "bad-bet", "bad-move"].includes(result.reason) ? 400 : 409
    return [status, { error: MESSAGES[result.reason] || "No se pudo completar." }]
  }
  if (pathname === "/api/duels") return reply(duels.list(user.twitchId))
  if (pathname === "/api/duels/one") return reply(duels.get(user.twitchId, url && url.searchParams.get("id")))
  const body = await readJson()
  if (pathname === "/api/duels/create") return reply(duels.create(user.twitchId, body))
  if (pathname === "/api/duels/hit") return reply(duels.step(user.twitchId, body.id, "hit"))
  if (pathname === "/api/duels/stand") return reply(duels.step(user.twitchId, body.id, "stand"))
  if (pathname === "/api/duels/move") return reply(duels.playMove(user.twitchId, body.id, body.from, body.to))
  if (pathname === "/api/duels/resign") return reply(duels.resign(user.twitchId, body.id))
  if (pathname === "/api/duels/accept") return reply(duels.accept(user.twitchId, body.id))
  if (pathname === "/api/duels/decline") return reply(duels.decline(user.twitchId, body.id))
  if (pathname === "/api/duels/seen") return reply(duels.markSeen(user.twitchId, body.id))
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjeDuels, handleDuelsApi, DUELS_ROUTES, MESSAGES, DUEL_FEE, GAMES, TURN_MS, QUIET_LIMIT }
