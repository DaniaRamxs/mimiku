// services/canje-games.js — minijuegos de la pagina de canje: Plinko, rasca y
// gana, ruleta, slots de personajes, alta o baja y buscaminas de cofres.
//
// Traduce la sesion de Twitch del viewer a su identidad en Mimiku, limita las
// bolas por minuto y guarda el resultado de cada peticion (un reintento con la
// misma clave no cobra ni juega otra vez). Una peticion puede tirar hasta
// MAX_BALLS bolas; cada una se cobra y se entrega por separado y, si se acaban
// los puntos a mitad, se devuelven las que si se jugaron. Reglas en plinko.js.
const { createPlinko, SLOTS } = require("./plinko.js")
const { publicImage, normalizeRarity } = require("./canje-data.js")
const { createMinigames, SCRATCH_SYMBOLS, WHEEL_SECTORS } = require("./minigames.js")
const { createRiskGames, MINES_OPTIONS, HILO_TOP, HILO_MAX_STEPS } = require("./minigames-risk.js")

const MAX_ACTIONS_PER_MINUTE = 120

const MAX_PLAYS_PER_MINUTE = 60
const MAX_BALLS = 10
const RESULTS_KEPT = 500
const KEY_PATTERN = /^[a-z0-9-]{8,64}$/i

const GAMES_ROUTES = {
  "/api/games": "GET",
  "/api/games/plinko": "POST",
  "/api/games/scratch": "POST",
  "/api/games/wheel": "POST",
  "/api/games/slots": "POST",
  "/api/games/hilo/start": "POST",
  "/api/games/hilo/guess": "POST",
  "/api/games/hilo/cashout": "POST",
  "/api/games/mines/start": "POST",
  "/api/games/mines/reveal": "POST",
  "/api/games/mines/cashout": "POST",
  "/api/games/blackjack/start": "POST",
  "/api/games/blackjack/hit": "POST",
  "/api/games/blackjack/stand": "POST",
  "/api/games/blackjack/double": "POST",
  "/api/games/blackjack/split": "POST",
}

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Vas muy rápido, espera un minuto.",
  insufficient: "No te alcanzan los puntos.",
  "bad-key": "Petición no válida. Recarga la página.",
  "bad-count": "Puedes tirar de 1 a " + MAX_BALLS + " bolas a la vez.",
  "no-cards": "El gachapon necesita al menos 3 personajes para los slots.",
  "bad-bet": "Esa apuesta no está permitida.",
  "bad-mines": "Elige cuántas trampas quieres.",
  "bad-move": "Esa jugada no es válida.",
  "no-game": "Esa partida ya terminó.",
  active: "Ya tienes una partida empezada.",
}

// `feed`: tablon "En vivo" (live-feed.js); cada jugada terminada se apunta ahi.
// `gachapon`: para que los personajes legendarios de Plinko se puedan robar
// desde el aviso en vivo (solo web; ver gachapon.openWebDrop).
function createCanjeGames({ platform, getChannel, feed = null, gachapon = null, now = Date.now, random = Math.random }) {
  const db = platform.db
  const plinko = createPlinko({ platform, getChannel, random })
  const minigames = createMinigames({ platform, getChannel, now, random })
  const risk = createRiskGames({ platform, getChannel, now, random })
  const recentPlays = new Map()
  const recentActions = new Map()
  const results = new Map()

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  // Cuenta bolas, no peticiones: 10 bolas de golpe gastan 10 del limite.
  function underLimit(twitchId, balls) {
    const since = now() - 60_000
    const recent = (recentPlays.get(twitchId) || []).filter(time => time > since)
    if (recent.length + balls > MAX_PLAYS_PER_MINUTE) { recentPlays.set(twitchId, recent); return false }
    recentPlays.set(twitchId, [...recent, ...Array(balls).fill(now())])
    return true
  }

  function publicPrize(prize) {
    if (!prize) return null
    const row = prize.row
    return prize.kind === "card"
      ? { kind: "card", name: row.name, rarity: normalizeRarity(row.rarity), image: publicImage(row.image_path), icon: "" }
      : { kind: "mimic", name: row.name, rarity: normalizeRarity(row.rarity), image: null, icon: row.icon || "" }
  }

  function actionAllowed(twitchId) {
    const since = now() - 60_000
    const recent = (recentActions.get(twitchId) || []).filter(time => time > since)
    if (recent.length >= MAX_ACTIONS_PER_MINUTE) { recentActions.set(twitchId, recent); return false }
    recentActions.set(twitchId, [...recent, now()])
    return true
  }

  function publicCard(card) {
    if (!card) return null
    return { id: card.id, name: card.name, rarity: normalizeRarity(card.rarity), image: publicImage(card.imagePath !== undefined ? card.imagePath : card.image_path) }
  }

  // Premio listo para ensenar (sin rutas internas de imagen).
  function publicReward(prize) {
    if (!prize) return null
    if (prize.type === "card") return { type: "card", ...publicCard(prize) }
    return prize
  }

  // Partida por pasos con la carta decorativa lista para ensenar.
  function publicRisk(game) {
    if (!game) return null
    return game.card !== undefined ? { ...game, card: publicCard(game.card) } : game
  }

  function info(twitchId) {
    const viewer = twitchId ? findViewer(twitchId) : null
    const freeBalls = viewer ? platform.tickets.get(getChannelId(), viewer.id).plinko : 0
    const config = minigames.getConfig()
    const running = viewer ? risk.active(viewer.id) : { hilo: null, mines: null, blackjack: null }
    return {
      plinko: { price: plinko.getConfig().price, slots: SLOTS, odds: plinko.odds(), maxBalls: MAX_BALLS, freeBalls },
      scratch: { price: config.scratchPrice, symbols: Object.fromEntries(Object.entries(SCRATCH_SYMBOLS).map(([id, symbol]) => [id, symbol.label])) },
      wheel: { price: config.wheelPrice, sectors: WHEEL_SECTORS.map(sector => ({ id: sector.id, label: sector.label, color: sector.color, big: !!sector.big })), freeSpin: viewer ? minigames.freeSpinAvailable(viewer.id) : false },
      slots: { price: config.slotsPrice, strip: minigames.slotsStrip().map(card => publicCard(card)) },
      risk: { min: config.riskMin, max: config.riskMax, minesOptions: MINES_OPTIONS, hiloTop: HILO_TOP, hiloMaxSteps: HILO_MAX_STEPS },
      hilo: publicRisk(running.hilo), mines: running.mines, blackjack: running.blackjack,
    }
  }

  // Jugada con clave (un reintento no cobra otra vez) y limite por minuto.
  function keyed(twitchId, requestKey, name, run) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!KEY_PATTERN.test(String(requestKey || ""))) return { ok: false, reason: "bad-key" }
    const cacheKey = `${name}:${twitchId}:${requestKey}`
    if (results.has(cacheKey)) return results.get(cacheKey)
    if (!actionAllowed(String(twitchId))) return { ok: false, reason: "rate-limit" }
    const before = balanceOf(viewer)
    const raw = run(viewer, `${twitchId}:${requestKey}`)
    const result = raw.ok ? { ...raw, balance: balanceOf(viewer) } : raw
    if (result.ok && (name === "wheel" || name === "slots" || name === "scratch")) reportInstant(name, viewer, before, result)
    // Blackjack con natural al repartir: la partida termina al empezar y tambien va al tablon.
    if (result.ok && name === "blackjack" && result.game && result.game.status !== "active") reportRisk("blackjack", viewer, result)
    if (results.size >= RESULTS_KEPT) results.delete(results.keys().next().value)
    results.set(cacheKey, result)
    return result
  }

  // Paso de una partida (sin clave: cada paso cambia el estado una sola vez).
  // `name`: "hilo" o "mines", para apuntar en vivo como termino la partida.
  function step(twitchId, run, name) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!actionAllowed(String(twitchId))) return { ok: false, reason: "rate-limit" }
    const raw = run(viewer)
    const result = raw.ok ? { ...raw, balance: balanceOf(viewer) } : raw
    if (result.ok && name) reportRisk(name, viewer, result)
    return result
  }

  function instant(name, play) {
    return (twitchId, requestKey) => keyed(twitchId, requestKey, name, (viewer, key) => {
      const result = play(viewer.id, key)
      return result.ok ? { ...result, prize: publicReward(result.prize), bonus: publicReward(result.bonus) } : result
    })
  }

  const withGame = result => (result.game ? { ...result, game: publicRisk(result.game) } : result)

  // ── En vivo ─────────────────────────────────────────────────────────────────
  const fmt = value => Math.abs(value).toLocaleString("es")

  function rewardText(prize) {
    if (!prize) return ""
    if (prize.type === "points") return `+${fmt(prize.amount)} pts`
    if (prize.type === "lose") return `-${fmt(prize.amount)} pts`
    if (prize.type === "chest") return `${prize.amount} ${prize.amount === 1 ? "cofre" : "cofres"} ${prize.name || ""}`.trim()
    if (prize.type === "plinko") return `${prize.amount} bolas de Plinko`
    if (prize.type === "gacha") return `${prize.amount} tiradas de gachapon`
    if (prize.type === "sleeve") return "Funda rara"
    if (prize.type === "card") return prize.name
    return "Premio"
  }

  function balanceOf(viewer) { return platform.economy.getBalance(getChannelId(), viewer.id).balance }

  function report(viewer, event) {
    if (!feed) return null
    try {
      return feed.record(getChannelId(), { ...event, viewerId: viewer.id, who: viewer.display || viewer.username })
    } catch (error) { return null /* el tablon en vivo nunca debe romper una jugada */ }
  }

  const TIER_RANK = { nada: 0, raro: 1, epico: 2, legendario: 3 }

  // Jugadas de un solo golpe: lo ganado o perdido es la diferencia de saldo.
  // `steal`: { stealUntil, shielded, item } de un personaje legendario robable.
  function reportInstant(name, viewer, before, result, steal = {}) {
    const net = result.balance - before
    if (name === "plinko") {
      const won = result.balls.filter(ball => ball.prize)
      const best = result.balls.reduce((top, ball) => (TIER_RANK[ball.tier] > TIER_RANK[top.tier] ? ball : top), result.balls[0])
      const label = !won.length ? (result.balls.length > 1 ? `Nada en ${result.balls.length} bolas` : "Nada")
        : result.balls.length > 1 ? `${won.length} ${won.length === 1 ? "premio" : "premios"} en ${result.balls.length} bolas · ${best.prize.name}` : best.prize.name
      return report(viewer, { game: "plinko", label, net, outcome: won.length ? "win" : net < 0 ? "lose" : "even", rarity: best.tier !== "nada" ? best.tier : null, big: best.tier === "legendario", count: result.balls.length, ...steal })
    }
    if (name === "wheel") {
      const sector = WHEEL_SECTORS[result.sector] || {}
      const lost = !result.prize || result.prize.type === "lose"
      return report(viewer, { game: "wheel", label: result.prize && result.prize.type !== "points" && result.prize.type !== "lose" ? rewardText(result.prize) : sector.label || "Ruleta", net, outcome: lost ? (net < 0 ? "lose" : "even") : "win", big: !!sector.big })
    }
    if (name === "slots") {
      const label = result.line === "triple" ? `Triple · ${rewardText(result.prize)}` : result.line === "pair" ? "Dos iguales" : "Sin premio"
      return report(viewer, { game: "slots", label, net, outcome: result.line === "triple" ? "win" : net < 0 ? "lose" : "even", rarity: result.prize && result.prize.rarity, big: !!result.jackpot })
    }
    if (name === "scratch") {
      const label = result.win ? rewardText(result.prize) + (result.bonus ? ` + ${rewardText(result.bonus)}` : "") : "Sin premio"
      return report(viewer, { game: "scratch", label, net, outcome: result.win ? "win" : net < 0 ? "lose" : "even", rarity: result.prize && result.prize.rarity, big: result.win === "legendario" || result.win === "diamante" })
    }
  }

  function reportPlinko(viewer, before, result, legendaryCard) {
    if (!legendaryCard || !gachapon) return reportInstant("plinko", viewer, before, result)
    const opened = gachapon.openWebDrop({ ownerId: viewer.id, ownerName: viewer.display || viewer.username, card: legendaryCard })
    const event = reportInstant("plinko", viewer, before, result, { stealUntil: opened.stealUntil, shielded: opened.shielded, item: legendaryCard.name })
    if (event) opened.link(event.id)
  }

  const BLACKJACK_LABELS = {
    blackjack: "¡Blackjack!", win: "Le ganó a Hikki", "dealer-bust": "Hikki se pasó", push: "Empate con Hikki",
    lose: "Hikki le ganó", bust: "Se pasó de 21", "dealer-blackjack": "Blackjack de Hikki",
  }

  function splitLabel(hands) {
    const won = hands.filter(hand => hand.result === "win" || hand.result === "dealer-bust").length
    return won === hands.length ? "Dividió y ganó las dos manos" : won ? `Dividió y ganó ${won} de ${hands.length}` : "Dividió y no ganó ninguna"
  }

  // Alta o baja, buscaminas y blackjack: solo cuenta el final (perder o cobrar).
  function reportRisk(name, viewer, result) {
    const game = result.game
    if (!game || (game.status !== "lost" && game.status !== "cashed")) return
    if (name === "blackjack") {
      const net = game.status === "cashed" ? game.payout - game.bet : -game.bet
      const label = game.result === "split" ? splitLabel(game.hands) : BLACKJACK_LABELS[game.result] || "Blackjack"
      return report(viewer, { game: "blackjack", label, net, outcome: net > 0 ? "win" : net < 0 ? "lose" : "even", big: game.result === "blackjack" && game.bet >= 5000, result: game.result })
    }
    if (game.status === "lost") return report(viewer, { game: name, label: "Perdió la apuesta", net: -game.bet, outcome: "lose" })
    const multiplier = game.bet ? game.payout / game.bet : 1
    report(viewer, {
      game: name, label: `Cobró x${multiplier.toFixed(2)}`, net: game.payout - game.bet,
      outcome: game.payout > game.bet ? "win" : game.payout < game.bet ? "lose" : "even", big: multiplier >= 5,
    })
  }

  function playPlinko(twitchId, requestKey, count = 1) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!KEY_PATTERN.test(String(requestKey || ""))) return { ok: false, reason: "bad-key" }
    const balls = Number(count)
    if (!Number.isInteger(balls) || balls < 1 || balls > MAX_BALLS) return { ok: false, reason: "bad-count" }
    const cacheKey = `${twitchId}:${requestKey}`
    if (results.has(cacheKey)) return results.get(cacheKey)
    if (!underLimit(String(twitchId), balls)) return { ok: false, reason: "rate-limit" }
    const before = balanceOf(viewer)
    const played = []
    let price = 0
    let stop = null
    let legendaryCard = null // el primer personaje legendario: se puede robar desde la web
    for (let i = 0; i < balls && !stop; i++) {
      const ball = plinko.play(viewer.id, `plinko:${twitchId}:${requestKey}:${i}`)
      if (ball.ok) {
        price = Math.max(price, ball.price)
        played.push({ slot: ball.slot, tier: ball.tier, prize: publicPrize(ball.prize), free: !!ball.free })
        if (!legendaryCard && ball.tier === "legendario" && ball.prize && ball.prize.kind === "card") legendaryCard = ball.prize.row
      } else stop = ball
    }
    const result = played.length
      ? { ok: true, requested: balls, price, balls: played, balance: balanceOf(viewer) }
      : stop
    if (result.ok) reportPlinko(viewer, before, result, legendaryCard)
    if (results.size >= RESULTS_KEPT) results.delete(results.keys().next().value)
    results.set(cacheKey, result)
    return result
  }

  function getChannelId() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  return {
    info, playPlinko,
    scratch: instant("scratch", minigames.scratch),
    wheel: instant("wheel", minigames.wheel),
    slots: instant("slots", minigames.slots),
    hiloStart: (twitchId, key, bet) => keyed(twitchId, key, "hilo", viewer => withGame(risk.hiloStart(viewer.id, bet, `${twitchId}:${key}`))),
    hiloGuess: (twitchId, id, guess) => step(twitchId, viewer => withGame(risk.hiloGuess(viewer.id, id, guess)), "hilo"),
    hiloCashout: (twitchId, id) => step(twitchId, viewer => withGame(risk.hiloCashout(viewer.id, id)), "hilo"),
    minesStart: (twitchId, key, bet, mines) => keyed(twitchId, key, "mines", viewer => risk.minesStart(viewer.id, bet, mines, `${twitchId}:${key}`)),
    minesReveal: (twitchId, id, cell) => step(twitchId, viewer => risk.minesReveal(viewer.id, id, cell), "mines"),
    minesCashout: (twitchId, id) => step(twitchId, viewer => risk.minesCashout(viewer.id, id), "mines"),
    blackjackStart: (twitchId, key, bet) => keyed(twitchId, key, "blackjack", viewer => risk.bjStart(viewer.id, bet, `${twitchId}:${key}`)),
    blackjackHit: (twitchId, id) => step(twitchId, viewer => risk.bjHit(viewer.id, id), "blackjack"),
    blackjackStand: (twitchId, id) => step(twitchId, viewer => risk.bjStand(viewer.id, id), "blackjack"),
    blackjackDouble: (twitchId, id) => step(twitchId, viewer => risk.bjDouble(viewer.id, id), "blackjack"),
    blackjackSplit: (twitchId, id) => step(twitchId, viewer => risk.bjSplit(viewer.id, id), "blackjack"),
  }
}

// Atiende una ruta de GAMES_ROUTES ya autenticada. Devuelve [status, json].
async function handleGamesApi({ pathname, readJson, user, games }) {
  if (pathname === "/api/games") return [200, games.info(user.twitchId)]
  const body = await readJson()
  const key = typeof body.key === "string" ? body.key : ""
  const id = typeof body.id === "string" ? body.id.slice(0, 64) : ""
  const routes = {
    "/api/games/plinko": () => games.playPlinko(user.twitchId, key, body.count === undefined ? 1 : body.count),
    "/api/games/scratch": () => games.scratch(user.twitchId, key),
    "/api/games/wheel": () => games.wheel(user.twitchId, key),
    "/api/games/slots": () => games.slots(user.twitchId, key),
    "/api/games/hilo/start": () => games.hiloStart(user.twitchId, key, body.bet),
    "/api/games/hilo/guess": () => games.hiloGuess(user.twitchId, id, body.guess),
    "/api/games/hilo/cashout": () => games.hiloCashout(user.twitchId, id),
    "/api/games/mines/start": () => games.minesStart(user.twitchId, key, body.bet, body.mines),
    "/api/games/mines/reveal": () => games.minesReveal(user.twitchId, id, body.cell),
    "/api/games/mines/cashout": () => games.minesCashout(user.twitchId, id),
    "/api/games/blackjack/start": () => games.blackjackStart(user.twitchId, key, body.bet),
    "/api/games/blackjack/hit": () => games.blackjackHit(user.twitchId, id),
    "/api/games/blackjack/stand": () => games.blackjackStand(user.twitchId, id),
    "/api/games/blackjack/double": () => games.blackjackDouble(user.twitchId, id),
    "/api/games/blackjack/split": () => games.blackjackSplit(user.twitchId, id),
  }
  if (!routes[pathname]) return [404, { error: "No encontrado" }]
  const result = routes[pathname]()
  if (result.ok) return [200, result]
  // Partida ya empezada: se devuelve para que la pagina la retome.
  if (result.reason === "active") return [409, { error: MESSAGES.active, game: result.game }]
  return [result.reason === "rate-limit" ? 429 : 409, { error: MESSAGES[result.reason] || "No se pudo jugar." }]
}

module.exports = { createCanjeGames, handleGamesApi, GAMES_ROUTES, MAX_PLAYS_PER_MINUTE, MAX_BALLS }
