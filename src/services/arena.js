// services/arena.js — Motor de juegos en tiempo real (autoridad: Mimiku Desktop)
// Fase 1: salas + lobby. La mecánica de cada juego se añade en fases siguientes.
const { getLocalPlatform } = require("./local-runtime.js")

let _broadcast = null
let _channel   = null

// estado en memoria de la sala activa de este canal
let room = null   // { code, game, status, config, state, players: [...] }

function init(channel, broadcastFn) {
  _channel   = channel
  _broadcast = broadcastFn
}

function setBroadcast(fn) { _broadcast = fn }

// genera un código corto legible (sin caracteres ambiguos)
function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// ── Crear partida ───────────────────────────────────────────────────────────
async function createRoom(game, config) {
  // cerrar cualquier sala previa de este canal
  await closeExistingRooms()

  let code = genCode()
  const platform = getLocalPlatform()
  const selectedGame = game || "palabra_bomba"
  platform.arena.setConfig(_channel, selectedGame, config || {})
  const session = platform.arena.startSession(_channel, code, selectedGame)
  room = { ...session, config: config || {}, state: {}, players: [] }
  broadcastLobby()
  return room
}

async function closeExistingRooms() {
  if (room?.id) getLocalPlatform().arena.finishSession(room.id, { summary: { reason: "replaced" } })
  room = null
}

// ── Suscripción a jugadores que entran/salen del lobby ──────────────────────
function subscribePlayers(code) {
  return code
}

async function refreshPlayers() {
  if (!room) return []
  broadcastLobby()
  return room.players
}

function joinRoom(identity) {
  if (!room || room.status !== "lobby") throw new Error("La sala no acepta jugadores")
  const viewer = getLocalPlatform().identities.resolve(identity)
  if (!room.players.some(player => player.viewer_id === viewer.id)) {
    room.players.push({ viewer_id: viewer.id, username: viewer.username, display: viewer.display, avatar: viewer.avatar_url, is_guest: false, is_ready: true, alive: true, seat: room.players.length })
  }
  broadcastLobby()
  return room.players.find(player => player.viewer_id === viewer.id)
}

// ── Comenzar / terminar ─────────────────────────────────────────────────────
let turnTimer = null
const dict = require("./dictionary.js")

async function startGame() {
  if (!room) throw new Error("No hay sala activa")
  if (!room.players.length) throw new Error("No hay jugadores en el lobby")
  if (room.players.length < 2) throw new Error("Se necesitan al menos 2 jugadores")

  // cargar diccionario (si aún no está)
  dict.ensureLoaded()

  const cfg = room.config || {}
  const diff = cfg.difficulty || { startTime: 15, reduction: 1, minTime: 3 }
  const lives = parseInt(cfg.lives) || 2
  const level = cfg.syllableLevel || "medio"

  // asignar asientos y vidas
  room.players.forEach((p, i) => { p.seat = i })

  const firstSyllable = dict.randomSyllable(level)

  room.state = {
    phase: "playing",
    round: 1,
    turnCount: 0,
    activeSeat: 0,
    syllable: firstSyllable,          // fragmento que debe contener la palabra
    syllableLevel: level,
    lastWord: "",
    usedWords: [],
    // bomba continua: el tiempo NO se reinicia por turno, sigue corriendo
    bombTime: diff.startTime,          // tiempo actual de la bomba (baja con rondas)
    turnEndsAt: Date.now() + diff.startTime * 1000,
    lives: {},                         // username -> vidas restantes
    alive: room.players.map(p => p.username),
    eliminated: [],
    usedLetters: {},                   // username -> set de letras usadas (para bonus)
    winner: null,
  }
  // inicializar vidas
  room.players.forEach(p => { room.state.lives[p.username] = lives; room.state.usedLetters[p.username] = [] })

  room.status = "playing"

  broadcastGameState()
  startTurnTimer()
  return room
}

// ── Reloj de la bomba (autoridad) ───────────────────────────────────────────
function startTurnTimer() {
  clearTimeout(turnTimer)
  if (!room || room.state.phase !== "playing") return
  const ms = Math.max(0, room.state.turnEndsAt - Date.now())
  turnTimer = setTimeout(() => onTimeout(), ms + 150)
}

async function onTimeout() {
  if (!room || room.state.phase !== "playing") return
  // explota en quien tiene la bomba → pierde una vida
  const victim = room.state.alive[activeIndex()]
  await loseLife(victim, "timeout")
}

function activeIndex() {
  return room.state.activeSeat % room.state.alive.length
}

// ── Jugada ──────────────────────────────────────────────────────────────────
async function submitWord(username, word) {
  if (!room || room.state.phase !== "playing") return { ok: false, reason: "no_active" }
  const activeUser = room.state.alive[activeIndex()]
  if (username !== activeUser) return { ok: false, reason: "not_your_turn" }

  const w = (word || "").trim().toLowerCase()
  if (!w) return { ok: false, reason: "empty" }
  const wn = dict.normalize(w)
  const syl = dict.normalize(room.state.syllable)

  // 1) debe CONTENER la sílaba
  if (!wn.includes(syl)) {
    broadcastReject(username, "no_contiene")
    return { ok: false, reason: "no_contiene" }
  }
  // 2) no repetida
  if (room.state.usedWords.includes(wn)) {
    broadcastReject(username, "repetida")
    return { ok: false, reason: "repetida" }
  }
  // 3) debe ser palabra real (si el diccionario está listo)
  const valid = dict.isValidWord(w)
  if (valid === false) {
    broadcastReject(username, "no_existe")
    return { ok: false, reason: "no_existe" }
  }
  // (si valid === null, el diccionario no cargó aún → validación laxa, se acepta)

  // ✓ palabra válida
  room.state.usedWords.push(wn)
  room.state.lastWord = w

  // registrar letras usadas (para bonus de vida)
  trackLetters(username, wn)

  // nueva sílaba y pasar bomba
  room.state.syllable = dict.randomSyllable(room.state.syllableLevel)
  advanceTurn(true)  // true = jugada exitosa
  return { ok: true }
}

function trackLetters(username, wn) {
  const set = new Set(room.state.usedLetters[username] || [])
  for (const ch of wn) if (/[a-z]/.test(ch)) set.add(ch)
  room.state.usedLetters[username] = [...set]
  // bonus: usó todas las letras jugables del abecedario → +1 vida
  const ALPHABET = "abcdefghilmnoprstuv".split("")  // letras razonables en español
  const hasAll = ALPHABET.every(l => set.has(l))
  if (hasAll) {
    room.state.lives[username] = (room.state.lives[username] || 0) + 1
    room.state.usedLetters[username] = []  // resetear para poder volver a ganar bonus
    broadcastBonus(username)
  }
}

function advanceTurn(success) {
  const cfg = room.config || {}
  const diff = cfg.difficulty || { startTime: 15, reduction: 1, minTime: 3 }
  room.state.turnCount++
  // siguiente jugador vivo
  room.state.activeSeat = (room.state.activeSeat + 1) % room.state.alive.length
  if (room.state.activeSeat === 0) {
    room.state.round++
    // la bomba se acelera cada ronda completa
    room.state.bombTime = Math.max(diff.minTime, diff.startTime - diff.reduction * (room.state.round - 1))
  }
  // bomba continua: si la jugada fue exitosa, recarga un poco de tiempo (pero no al máximo)
  // esto mantiene la tensión: el tiempo baja globalmente
  const recharge = success ? room.state.bombTime : room.state.bombTime
  room.state.turnEndsAt = Date.now() + recharge * 1000
  persistState()
  broadcastGameState()
  startTurnTimer()
}

async function loseLife(username, reason) {
  if (!room) return
  room.state.lives[username] = (room.state.lives[username] || 1) - 1
  broadcastExplosion(username, room.state.lives[username])

  if (room.state.lives[username] <= 0) {
    await eliminate(username)
    return
  }
  // aún tiene vidas: nueva sílaba y sigue el juego (pasa al siguiente)
  room.state.syllable = dict.randomSyllable(room.state.syllableLevel)
  advanceTurn(false)
}

async function eliminate(username) {
  const idx = room.state.alive.indexOf(username)
  if (idx === -1) return
  const placement = room.state.alive.length
  room.state.alive.splice(idx, 1)
  room.state.eliminated.push({ username, placement })
  const eliminatedPlayer = room.players.find(player => player.username === username)
  if (eliminatedPlayer) { eliminatedPlayer.alive = false; eliminatedPlayer.placement = placement }

  if (room.state.alive.length <= 1) {
    const winner = room.state.alive[0] || null
    const winnerPlayer = room.players.find(player => player.username === winner)
    if (winnerPlayer) winnerPlayer.placement = 1
    room.state.winner = winner
    room.state.phase = "finished"
    clearTimeout(turnTimer)
    persistState()
    broadcastGameState()
    await endWithRewards(winner)
    return
  }

  if (idx < room.state.activeSeat) room.state.activeSeat--
  room.state.activeSeat = room.state.activeSeat % room.state.alive.length
  room.state.syllable = dict.randomSyllable(room.state.syllableLevel)
  room.state.turnEndsAt = Date.now() + room.state.bombTime * 1000
  persistState()
  broadcastGameState()
  startTurnTimer()
}

async function endWithRewards(winner) {
  if (!winner) return
  const reward = room.config?.reward
  if (!reward || reward.type === "none") return
  try {
    if (reward.type === "points") {
      const amount = parseInt(reward.value) || 0
      if (amount > 0) { try { require("./economy.js").addPoints(winner, amount, "arena-ganador") } catch (e) {} }
    }
  } catch (e) { console.error("[arena] reward:", e.message) }
}

async function persistState() {
  return room?.state
}

async function finishGame() {
  if (!room) return
  clearTimeout(turnTimer)
  getLocalPlatform().arena.finishSession(room.id, {
    winnerViewerId: room.players.find(player => player.username === room.state?.winner)?.viewer_id || null,
    summary: { winner: room.state?.winner || null, rounds: room.state?.round || 0, players: room.players.length },
  })
  room.status = "finished"
  broadcastLobby()
}

// ── Estado actual (para la página de Mimiku) ────────────────────────────────
function getRoom() { return room }

function broadcastLobby() {
  if (!_broadcast || !room) return
  _broadcast({
    type: "arena_lobby",
    code: room.code,
    game: room.game,
    status: room.status,
    players: room.players.map(p => ({
      username: p.username, display: p.display, avatar: p.avatar,
      is_guest: p.is_guest, is_ready: p.is_ready, alive: p.alive, seat: p.seat,
    })),
  })
}

// nombre visible de un username
function displayOf(username) {
  const p = (room.players || []).find(x => x.username === username)
  return p ? p.display : username
}

// estado del juego (broadcast a overlay; el panel lee de Supabase realtime)
function broadcastGameState() {
  if (!_broadcast || !room) return
  const s = room.state
  _broadcast({
    type: "arena_game",
    code: room.code,
    phase: s.phase,
    round: s.round,
    syllable: s.syllable,
    lastWord: s.lastWord,
    bombTime: s.bombTime,
    turnEndsAt: s.turnEndsAt,
    activeUser: s.alive[activeIndex()] || null,
    activeDisplay: displayOf(s.alive[activeIndex()] || ""),
    aliveCount: s.alive.length,
    lives: s.lives,
    winner: s.winner,
    winnerDisplay: s.winner ? displayOf(s.winner) : null,
  })
}

function broadcastExplosion(username, livesLeft) {
  if (!_broadcast) return
  _broadcast({ type: "arena_explosion", username, display: displayOf(username), livesLeft })
}

function broadcastReject(username, reason) {
  if (!_broadcast) return
  _broadcast({ type: "arena_reject", username, display: displayOf(username), reason })
}

function broadcastBonus(username) {
  if (!_broadcast) return
  _broadcast({ type: "arena_bonus", username, display: displayOf(username) })
}

module.exports = {
  init, setBroadcast,
  createRoom, startGame, finishGame, getRoom, refreshPlayers,
  joinRoom, submitWord,
}
