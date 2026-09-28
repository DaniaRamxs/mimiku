// services/events.js — Panel de Eventos para el broadcaster
const { getDb } = require("./db.js")
const { addPoints, getRanking, getViewer } = require("./economy.js")

// Estado global de eventos activos
const activeEvents = {
  multiplier:      null,  // { value: 2, timer: null }
  economyFrozen:   false,
  betsFrozen:      false,
  shieldActive:    false,
  bossActive:      null,  // { hp: 1000, maxHp: 1000, participants: {} }
  lotteryActive:   null,  // { tickets: {}, pricePerTicket: 100 }
  happyHour:       false, // todos los juegos pagan doble
  muerteSubita:    false, // duelos pagan x5
  coinActive:      false, // !coin habilitado
  coinMaxBet:      200,
}

let _say    = null  // función para mandar mensajes al chat
let _overlay = null // función para mandar al overlay
let _channel = null

function init(channel, sayFn, overlayFn) {
  _channel = channel
  _say     = sayFn
  _overlay = overlayFn
}

function say(msg) { if (_say) _say(msg) }
function overlay(payload) { if (_overlay) _overlay(payload) }

// ── ECONOMÍA ──────────────────────────────────────────────────────────────────

// 🎉 Lluvia de puntos — todos los viewers activos reciben X puntos
async function rainPoints(amount = 100) {
  const viewers = getRanking(9999)
  let count = 0
  for (const v of viewers) {
    addPoints(v.username, amount, "lluvia-de-puntos", { platform: v.platform, platformUserId: v.platform_user_id })
    count++
  }
  say(`🎉 ¡LLUVIA DE PUNTOS! Todos los viewers recibieron ${amount} puntos! (${count} viewers)`)
  overlay({ type: "alert", text: `🎉 ¡Lluvia de puntos! +${amount} para todos!`, duration: 6000 })
  overlay({ type: "game_event", event: "rain", amount, count })
  return { count, amount }
}

// 💸 Regalar 500 pts a todos
async function gift500() {
  return rainPoints(500)
}

// 🔥 Multiplicador de recompensas
function setMultiplier(value = 2, minutes = 5) {
  if (activeEvents.multiplier) clearTimeout(activeEvents.multiplier.timer)
  const timer = setTimeout(() => {
    activeEvents.multiplier = null
    say(`⏰ El multiplicador x${value} ha terminado.`)
    overlay({ type: "alert", text: `⏰ Multiplicador x${value} terminado`, duration: 4000 })
  }, minutes * 60 * 1000)
  activeEvents.multiplier = { value, timer }
  say(`🔥 ¡Multiplicador x${value} activado por ${minutes} minutos!`)
  overlay({ type: "alert", text: `🔥 x${value} de recompensas por ${minutes} min!`, duration: 6000 })
  overlay({ type: "game_event", event: "multiplier", value, minutes })
}

// Obtener multiplicador actual (usado por economy.js)
function getMultiplier() {
  return activeEvents.multiplier?.value || 1
}

// 🧲 Equilibrador — el viewer con menos puntos recibe el doble por X minutos
async function equalizer(minutes = 5) {
  const viewers = getRanking(9999)
  if (!viewers.length) return
  const poorest = viewers[viewers.length - 1]
  const bonus   = poorest.points
  addPoints(poorest.username, bonus, "equilibrador", { platform: poorest.platform, platformUserId: poorest.platform_user_id })
  say(`🧲 ¡Equilibrador! @${poorest.display||poorest.username} tenía menos puntos y recibió ${bonus} pts extra!`)
  overlay({ type: "alert", text: `🧲 ¡${poorest.display||poorest.username} recibió boost de equilibrio!`, duration: 5000 })
  return { username: poorest.username, bonus }
}

// ── CONTROL ───────────────────────────────────────────────────────────────────

// 🛑 Congelar economía
function freezeEconomy(minutes = 5) {
  activeEvents.economyFrozen = true
  say(`🛑 ¡Economía congelada por ${minutes} minutos! Nadie gana puntos.`)
  overlay({ type: "alert", text: `🛑 Economía congelada por ${minutes} min`, duration: 5000 })
  setTimeout(() => {
    activeEvents.economyFrozen = false
    say("✅ La economía fue descongelada.")
    overlay({ type: "alert", text: "✅ Economía descongelada", duration: 4000 })
  }, minutes * 60 * 1000)
}

function isEconomyFrozen() { return activeEvents.economyFrozen }

// ❄ Congelar apuestas
function freezeBets(minutes = 5) {
  activeEvents.betsFrozen = true
  say(`❄ ¡Apuestas congeladas por ${minutes} minutos! No se puede apostar.`)
  overlay({ type: "alert", text: `❄ Apuestas congeladas por ${minutes} min`, duration: 5000 })
  setTimeout(() => {
    activeEvents.betsFrozen = false
    say("✅ Las apuestas fueron descongeladas.")
  }, minutes * 60 * 1000)
}

function areBetsFrozen() { return activeEvents.betsFrozen }

// 🛡 Escudo — nadie puede robar
function activateShield(minutes = 5) {
  activeEvents.shieldActive = true
  say(`🛡 ¡Escudo activado por ${minutes} minutos! Nadie puede robar.`)
  overlay({ type: "alert", text: `🛡 Escudo activo por ${minutes} min`, duration: 5000 })
  setTimeout(() => {
    activeEvents.shieldActive = false
    say("✅ El escudo ha terminado.")
  }, minutes * 60 * 1000)
}

function isShieldActive() { return activeEvents.shieldActive }

// ── BOSS ──────────────────────────────────────────────────────────────────────

function spawnBoss(hp = 5000) {
  if (activeEvents.bossActive) { say("⚠ Ya hay un boss activo. Usa !atacar para atacar!"); return }
  activeEvents.bossActive = { hp, maxHp: hp, participants: {} }
  say(`👾 ¡¡BOSS INVOCADO!! HP: ${hp} — Usa !atacar [cantidad] para atacar con tus puntos!`)
  overlay({ type: "alert", text: `👾 ¡BOSS INVOCADO! HP: ${hp}`, duration: 5000 })
  overlay({ type: "game_event", event: "boss_spawn", hp, maxHp: hp })
}

// Claves de participante namespaced por identidad completa (Fase 1.45): el
// boss es un evento compartido de todo el canal (boss.hp SÍ es global a
// propósito), pero la contribución/recompensa de cada participante es por
// viewer. La Fase 1.4 ya separaba por plataforma; esta fase corrige que
// además use platformUserId real cuando existe (y no solo "legacy:username")
// para no fragmentar a un mismo viewer en dos entradas dentro de la MISMA
// plataforma. Cada entrada guarda la identidad completa, no solo un número,
// así la recompensa final vuelve a Economy con el platformUserId correcto.
function participantKey(username, platformName, platformUserId) {
  return `${platformName}::${platformUserId || "legacy:" + username}`
}

function attackBoss(username, display, amount, platformName = "twitch", platformUserId = "") {
  const boss = activeEvents.bossActive
  if (!boss) return { error: "No hay boss activo. El broadcaster debe invocar uno." }
  const viewer = getViewer(username, platformName)
  if (!viewer || viewer.points < amount) return { error: `No tienes suficientes puntos. Tienes ${viewer?.points ?? 0}.` }

  addPoints(username, -amount, "boss-ataque", { platform: platformName, platformUserId })
  boss.hp -= amount
  const key = participantKey(username, platformName, platformUserId)
  if (!boss.participants[key]) boss.participants[key] = { username, platformName, platformUserId, damage: 0 }
  boss.participants[key].damage += amount

  if (boss.hp <= 0) {
    boss.hp = 0
    // distribuir recompensas
    const entries    = Object.values(boss.participants)
    const totalDmg   = entries.reduce((a, p) => a + p.damage, 0)
    const rewardPool = Math.floor(boss.maxHp * 1.5)

    say(`👾 ¡¡BOSS DERROTADO!! Repartiendo ${rewardPool} puntos entre ${entries.length} héroes…`)
    overlay({ type: "alert", text: `👾 ¡BOSS DERROTADO! ¡Victoria!`, duration: 8000 })

    for (const p of entries) {
      const reward = Math.floor((p.damage / totalDmg) * rewardPool)
      addPoints(p.username, reward, "boss-recompensa", { platform: p.platformName, platformUserId: p.platformUserId })
    }

    activeEvents.bossActive = null
    return { ok: true, defeated: true, reward: rewardPool }
  }

  const hpBar = Math.round((boss.hp / boss.maxHp) * 20)
  const bar   = "█".repeat(hpBar) + "░".repeat(20 - hpBar)
  const participantCount = Object.keys(boss.participants).length
  say(`👾 @${display} atacó por ${amount} pts! Boss HP: [${bar}] ${boss.hp}/${boss.maxHp}`)
  overlay({ type: "game_event", event: "boss_attack", bossHp: boss.hp, maxHp: boss.maxHp, participants: participantCount })
  return { ok: true, bossHp: boss.hp, maxHp: boss.maxHp, participants: participantCount }
}

// ── LOTERÍA ───────────────────────────────────────────────────────────────────

function startLottery(pricePerTicket = 100) {
  if (activeEvents.lotteryActive) { say("⚠ Ya hay una lotería activa. Usa !boleto para participar!"); return }
  activeEvents.lotteryActive = { tickets: {}, pricePerTicket }
  say(`🎟 ¡LOTERÍA INICIADA! Boleto: ${pricePerTicket} pts — Usa !boleto para participar. El broadcaster elige el ganador.`)
  overlay({ type: "alert", text: `🎟 ¡Lotería iniciada! Boleto: ${pricePerTicket} pts`, duration: 6000 })
}

function buyLotteryTicket(username, display, platformName = "twitch", platformUserId = "") {
  const lottery = activeEvents.lotteryActive
  if (!lottery) return { error: "No hay lotería activa." }
  const key = participantKey(username, platformName, platformUserId)
  if (lottery.tickets[key]) return { error: `@${display} ya tienes un boleto.` }
  const viewer = getViewer(username, platformName)
  if (!viewer || viewer.points < lottery.pricePerTicket) return { error: `No tienes suficientes puntos. Necesitas ${lottery.pricePerTicket}.` }
  addPoints(username, -lottery.pricePerTicket, "boleto-lotería", { platform: platformName, platformUserId })
  lottery.tickets[key] = { display, username, platformName, platformUserId }
  const total = Object.keys(lottery.tickets).length
  say(`🎟 @${display} compró un boleto! Total: ${total} participantes. Pozo: ${total * lottery.pricePerTicket} pts`)
  return { ok: true, total }
}

function drawLottery() {
  const lottery = activeEvents.lotteryActive
  if (!lottery) return { error: "No hay lotería activa." }
  const participants = Object.entries(lottery.tickets)
  if (!participants.length) return { error: "No hay participantes en la lotería." }

  const [, info] = participants[Math.floor(Math.random() * participants.length)]
  const prize = participants.length * lottery.pricePerTicket

  addPoints(info.username, prize, "lotería-ganador", { platform: info.platformName, platformUserId: info.platformUserId })
  say(`🎟 ¡¡GANADOR DE LA LOTERÍA!! 🎉 @${info.display} ganó ${prize} pts con ${participants.length} boletos en juego!`)
  overlay({ type: "alert", text: `🎟 ¡${info.display} ganó la lotería! +${prize} pts 🎉`, duration: 8000 })
  overlay({ type: "game_event", event: "lottery_win", winner: info.username, prize })

  activeEvents.lotteryActive = null
  return { ok: true, winner: info.username, prize }
}


// ── IMPUESTOS ─────────────────────────────────────────────────────────────────
function collectTax(percent = 10) {
  const viewers = getRanking(9999)
  if (!viewers.length) return { error: "No hay viewers registrados." }

  let totalCollected = 0
  let affected = 0

  for (const v of viewers) {
    if (v.points <= 0) continue
    const tax = Math.floor(v.points * (percent / 100))
    if (tax <= 0) continue
    addPoints(v.username, -tax, `impuesto-${percent}%`, { platform: v.platform, platformUserId: v.platform_user_id })
    totalCollected += tax
    affected++
  }

  say(`🏛 ¡IMPUESTO DEL ${percent}%! Se cobraron ${totalCollected} pts de ${affected} viewers para el fisco.`)
  overlay({ type: "alert", text: `🏛 Impuesto del ${percent}% cobrado a todos los viewers`, duration: 6000 })
  overlay({ type: "game_event", event: "tax", percent, totalCollected, affected })
  return { ok: true, totalCollected, affected, percent }
}

// ── SORPRESA ──────────────────────────────────────────────────────────────────

const RANDOM_EVENTS = [
  () => collectTax(5),
  () => rainPoints(50),
  () => rainPoints(200),
  () => setMultiplier(2, 3),
  () => setMultiplier(3, 2),
  () => gift500(),
  () => equalizer(5),
  () => activateShield(3),
  () => spawnBoss(2000),
]

async function randomEvent() {
  const fn = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)]
  say("🌟 ¡EVENTO ALEATORIO!")
  overlay({ type: "alert", text: "🌟 ¡Evento aleatorio activado!", duration: 4000 })
  await fn()
}

async function chaosMode() {
  say("🎭 ¡¡MODO CAOS ACTIVADO!! 3 eventos simultáneos…")
  overlay({ type: "alert", text: "🎭 ¡MODO CAOS!", duration: 5000 })
  const fns = [...RANDOM_EVENTS].sort(() => Math.random() - 0.5).slice(0, 3)
  for (const fn of fns) { await fn(); await new Promise(r => setTimeout(r, 500)) }
}

// ── JUEGOS ESPECIALES ─────────────────────────────────────────────────────────

// 🎰 Happy Hour — todos los juegos pagan x2
function happyHour(minutes = 10) {
  activeEvents.happyHour = true
  say(`🎰 ¡HAPPY HOUR! Todos los juegos pagan el doble por ${minutes} minutos!`)
  overlay({ type: "alert", text: `🎰 ¡Happy Hour! x2 en todos los juegos por ${minutes} min!`, duration: 7000 })
  overlay({ type: "game_event", event: "happy_hour", minutes })
  setTimeout(() => {
    activeEvents.happyHour = false
    say("⏰ Happy Hour terminado. Los juegos vuelven a pagar normal.")
    overlay({ type: "alert", text: "⏰ Happy Hour terminado", duration: 4000 })
  }, minutes * 60 * 1000)
}

function isHappyHour() { return activeEvents.happyHour }

// ⚡ Muerte Súbita — duelos pagan x5
function muerteSubita(minutes = 5) {
  activeEvents.muerteSubita = true
  say(`⚡ ¡MUERTE SÚBITA! Los duelos pagan x5 por ${minutes} minutos! Usa !duelo para apostar todo.`)
  overlay({ type: "alert", text: `⚡ ¡Muerte Súbita! Duelos x5 por ${minutes} min!`, duration: 7000 })
  setTimeout(() => {
    activeEvents.muerteSubita = false
    say("⏰ Muerte Súbita terminada. Los duelos vuelven a pagar normal.")
    overlay({ type: "alert", text: "⏰ Muerte Súbita terminada", duration: 4000 })
  }, minutes * 60 * 1000)
}

function isMuerteSubita() { return activeEvents.muerteSubita }

// 💸 Impuestos — todos pierden X% de sus puntos
async function taxEveryone(percent = 10) {
  const viewers = getRanking(9999)
  let totalTaxed = 0
  let count = 0
  for (const v of viewers) {
    if (v.points <= 0) continue
    const tax = Math.floor(v.points * (percent / 100))
    if (tax <= 0) continue
    addPoints(v.username, -tax, "impuestos", { platform: v.platform, platformUserId: v.platform_user_id })
    totalTaxed += tax
    count++
  }
  say(`💸 ¡IMPUESTOS! El ${percent}% fue cobrado a ${count} viewers. Total: ${totalTaxed.toLocaleString()} pts recaudados.`)
  overlay({ type: "alert", text: `💸 ¡Impuestos! -${percent}% para todos`, duration: 6000 })
  overlay({ type: "game_event", event: "tax", percent, totalTaxed, count })
  return { count, totalTaxed }
}

// 🪙 Cara o Cruz — toggle del comando !coin
function setCoinActive(active, maxBet = 200) {
  activeEvents.coinActive  = active
  activeEvents.coinMaxBet  = maxBet
  if (active) {
    say(`🪙 ¡Cara o Cruz activado! Usa !coin [cantidad] para apostar (máx ${maxBet} pts)`)
    overlay({ type: "alert", text: `🪙 ¡!coin activado! Máx ${maxBet} pts`, duration: 5000 })
  } else {
    say("⏹ Cara o Cruz desactivado.")
  }
}

function isCoinActive() { return activeEvents.coinActive }
function getCoinMaxBet() { return activeEvents.coinMaxBet }

// Tirada de moneda para un viewer
function flipCoin(username, display, amount, platformName = "twitch", platformUserId = "") {
  if (!activeEvents.coinActive) return { error: "!coin no está activo ahora." }
  if (amount > activeEvents.coinMaxBet) return { error: `Máximo permitido: ${activeEvents.coinMaxBet} pts.` }
  const viewer = getViewer(username, platformName)
  if (!viewer || viewer.points < amount) return { error: `No tenés suficientes puntos.` }
  const cara = Math.random() < 0.5
  if (cara) {
    addPoints(username, amount, "coin-cara", { platform: platformName, platformUserId })
    overlay({ type: "coin_flip", result: "cara", username, display, amount, win: true })
    return { ok: true, result: "cara", won: true, amount }
  } else {
    addPoints(username, -amount, "coin-cruz", { platform: platformName, platformUserId })
    overlay({ type: "coin_flip", result: "cruz", username, display, amount, win: false })
    return { ok: true, result: "cruz", won: false, amount }
  }
}

// ── ESTADO ────────────────────────────────────────────────────────────────────

function getStatus() {
  return {
    multiplier:    activeEvents.multiplier?.value || 1,
    economyFrozen: activeEvents.economyFrozen,
    betsFrozen:    activeEvents.betsFrozen,
    shieldActive:  activeEvents.shieldActive,
    happyHour:     activeEvents.happyHour,
    muerteSubita:  activeEvents.muerteSubita,
    coinActive:    activeEvents.coinActive,
    bossActive:    activeEvents.bossActive ? { hp: activeEvents.bossActive.hp, maxHp: activeEvents.bossActive.maxHp, participants: Object.keys(activeEvents.bossActive.participants).length } : null,
    lotteryActive: activeEvents.lotteryActive ? { tickets: Object.keys(activeEvents.lotteryActive.tickets).length, price: activeEvents.lotteryActive.pricePerTicket } : null,
  }
}

module.exports = {
  init, getStatus,
  rainPoints, gift500, setMultiplier, getMultiplier, equalizer,
  freezeEconomy, isEconomyFrozen,
  freezeBets, areBetsFrozen,
  activateShield, isShieldActive,
  spawnBoss, attackBoss,
  startLottery, buyLotteryTicket, drawLottery,
  randomEvent, chaosMode,
  happyHour, isHappyHour,
  muerteSubita, isMuerteSubita,
  taxEveryone,
  collectTax: taxEveryone,
  setCoinActive, isCoinActive, getCoinMaxBet, flipCoin,
}
