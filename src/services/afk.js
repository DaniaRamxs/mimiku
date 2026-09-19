// services/afk.js — Modo AFK con contador comunitario y eventos idle
const { addPoints } = require("./economy.js")

let _broadcast = null
let _channel   = null
let _say       = null

// estado del modo AFK
let afk = {
  active: false,
  message: "",          // "vuelvo en 40 minutos"
  startedAt: null,      // timestamp de activación
  // contador
  goal: 100,
  current: 0,
  lastCounter: null,    // username del último que contó (no puede repetir)
  penalty: 0,           // puntos que pierde quien rompe (0 = sin penalización)
  // automatizaciones al llegar a la meta
  rewards: {
    points: 0,          // puntos a todos los activos (0 = off)
    soundUrl: "",       // archivo subido para el contador
    videoUrl: "",
    message: "",        // mensaje de celebración
  },
}

function init(channel, broadcastFn, sayFn) {
  _channel   = channel
  _broadcast = broadcastFn
  _say       = sayFn
}

function setBroadcast(fn) { _broadcast = fn }
function setSay(fn) { _say = fn }

// ── Activar / desactivar ────────────────────────────────────────────────────
function activate(config) {
  afk.active    = true
  afk.message   = config.message || "Volvemos pronto"
  afk.startedAt = Date.now()
  afk.goal      = parseInt(config.goal) || 100
  afk.current   = 0
  afk.lastCounter = null
  afk.penalty   = parseInt(config.penalty) || 0
  afk.rewards   = {
    points:   parseInt(config.rewards?.points) || 0,
    soundUrl: config.rewards?.soundUrl || "",
    videoUrl: config.rewards?.videoUrl || "",
    message:  config.rewards?.message || "¡Meta alcanzada! 🎉",
  }
  broadcastAfkState()
  if (_say) _say(`😴 Modo AFK activado. ${afk.message}. ¡Cuenten juntos hasta ${afk.goal}! Empiecen con el 1.`)
  return getStatus()
}

function deactivate() {
  afk.active = false
  if (_broadcast) _broadcast({ type: "afk_end" })
  if (_say) _say("✦ ¡De vuelta! Modo AFK desactivado.")
  return getStatus()
}

function getStatus() {
  return {
    active: afk.active,
    message: afk.message,
    startedAt: afk.startedAt,
    goal: afk.goal,
    current: afk.current,
    penalty: afk.penalty,
    rewards: afk.rewards,
    elapsedMs: afk.startedAt ? Date.now() - afk.startedAt : 0,
  }
}

// ── Contador comunitario ────────────────────────────────────────────────────
// Llamado por cada mensaje del chat mientras AFK está activo.
// Detecta si el mensaje es un número y aplica las reglas.
// Es un juego deliberadamente GLOBAL/comunitario (todo el chat cuenta junto,
// sin importar la plataforma) — "la misma persona" se sigue identificando
// por username, a propósito. Lo que SÍ debe respetar identidad por
// plataforma es cualquier movimiento de puntos real (penalización/premio),
// por eso platformName/platformUserId se propagan hacia addPoints.
function onMessage(username, display, message, platformName = "twitch", platformUserId = "") {
  if (!afk.active) return

  const trimmed = message.trim()
  // ¿es solo un número?
  if (!/^\d+$/.test(trimmed)) return
  const num = parseInt(trimmed)

  const expected = afk.current + 1

  // regla 1: misma persona no puede contar dos veces seguidas
  if (afk.lastCounter && afk.lastCounter === username) {
    breakCount(username, display, num, "no puedes contar dos veces seguidas", platformName, platformUserId)
    return
  }

  // regla 2: número correcto
  if (num !== expected) {
    breakCount(username, display, num, `el número era ${expected}`, platformName, platformUserId)
    return
  }

  // número correcto
  afk.current = num
  afk.lastCounter = username

  // ¿meta alcanzada?
  if (afk.current >= afk.goal) {
    reachGoal()
    return
  }

  broadcastCounter()
}

function breakCount(username, display, num, reason, platformName = "twitch", platformUserId = "") {
  const brokenAt = afk.current
  afk.current = 0
  afk.lastCounter = null

  // penalización opcional
  if (afk.penalty > 0) {
    try { addPoints(username, -afk.penalty, "rompe-contador", { platform: platformName, platformUserId }) } catch (e) {}
  }

  if (_say) _say(`💥 @${display} rompió la cuenta en ${brokenAt} (${reason}). ¡Volvemos a empezar desde 1!`)
  if (_broadcast) _broadcast({
    type: "afk_count_break",
    breaker: display,
    brokenAt,
    penalty: afk.penalty,
  })
  broadcastCounter()
}

async function reachGoal() {
  const goal = afk.goal
  afk.current = goal

  // disparar automatizaciones
  const r = afk.rewards

  // puntos a todos los activos, multiplataforma: cada viewer activo recibe
  // el premio en SU wallet real (platform + platformUserId), no siempre en
  // "twitch" como antes.
  if (r.points > 0) {
    try {
      const { getDefaultActivityTracker } = require("../core/interactions/activity-consumer.js")
      const active = getDefaultActivityTracker().getActiveViewerIdentities()
      for (const viewer of active) {
        addPoints(viewer.username, r.points, "meta-contador", { platform: viewer.platform, platformUserId: viewer.platformUserId })
      }
    } catch (e) {}
  }

  // video / sonido en overlay
  if (_broadcast) {
    _broadcast({
      type: "afk_goal_reached",
      goal,
      message: r.message,
      soundUrl: r.soundUrl,
      videoUrl: r.videoUrl,
      points: r.points,
    })
  }

  if (_say) _say(`🎉 ¡META ALCANZADA! Contaron juntos hasta ${goal}. ${r.points > 0 ? `+${r.points} puntos para todos los activos!` : ""}`)

  // reiniciar el contador para que puedan seguir jugando
  setTimeout(() => {
    afk.current = 0
    afk.lastCounter = null
    broadcastCounter()
  }, 8000)
}

function broadcastCounter() {
  if (_broadcast) _broadcast({
    type: "afk_count",
    current: afk.current,
    goal: afk.goal,
  })
}

function broadcastAfkState() {
  if (_broadcast) _broadcast({
    type: "afk_start",
    message: afk.message,
    goal: afk.goal,
    current: afk.current,
    startedAt: afk.startedAt,
  })
}

// ── Comandos solo-idle ──────────────────────────────────────────────────────
// Fase 1.6: sin operación de identidad/economía — es solo un texto de
// estado — así que se movió a Command Engine (agnóstico de plataforma) en
// vez de seguir gateado dentro de twitch-adapter.js. `getIdleCommandReply`
// es la versión pura (sin efectos secundarios) que usa Command Engine;
// `handleCommand` se conserva como wrapper por compatibilidad de API.
function getIdleCommandReply(command) {
  if (!afk.active) return null
  const cmd = command.toLowerCase().split(" ")[0]

  if (cmd === "!afk" || cmd === "!brb" || cmd === "!volver") {
    return `😴 ${afk.message} · Lleva ${formatElapsed(Date.now() - afk.startedAt)} ausente.`
  }

  if (cmd === "!contador" || cmd === "!cuenta") {
    return `🔢 Vamos en ${afk.current}/${afk.goal}. El siguiente número es ${afk.current + 1}.`
  }

  return null
}

// devuelve true si manejó el comando
function handleCommand(username, display, command) {
  const reply = getIdleCommandReply(command)
  if (reply === null) return false
  if (_say) _say(reply)
  return true
}

function formatElapsed(ms) {
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0) return `${h}h ${m}min`
  return `${m} minuto${m !== 1 ? "s" : ""}`
}

module.exports = {
  init, setBroadcast, setSay,
  activate, deactivate, getStatus,
  onMessage, handleCommand, getIdleCommandReply,
}
