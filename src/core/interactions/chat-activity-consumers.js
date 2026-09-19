// Consumidores agnósticos de plataforma para las consecuencias generales de
// un "chat_message": XP por mensaje, niveles, widget de avatar, contador
// AFK y mini-reto. Extraídos de src/integrations/twitch/twitch-adapter.js
// (Fase 1.5) — ninguno de estos módulos importa tmi.js, Twitch ni Social
// Stream Ninja; solo leen event.platform y event.actor.
//
// Todos comparten la misma regla de activación que ya usaba twitch-adapter.js:
// los mensajes que empiezan con "!" son comandos y NO disparan estos
// consumidores (los procesa Command Engine, no esto) — se preserva la
// exclusión mutua que ya existía.
function isCommandText(event) {
  const text = event.message && event.message.text
  return !text || text.trim().startsWith("!")
}

// Política conservadora para plataformas no reconocidas (Fase 1.5 §15): si
// el adaptador de origen no pudo resolver una plataforma real (quedó en
// "unknown"), no se otorga economía/XP — no hay una identidad "segura" en
// qué apoyarse, solo una etiqueta de reserva. Activity y Widgets sí pueden
// seguir procesando el evento (no mueven dinero, solo reflejan presencia).
function hasEconomicIdentity(event) {
  return event.platform && event.platform !== "unknown"
}

// ── XP de economía por mensaje ──────────────────────────────────────────────
function createXpConsumer(overrides = {}) {
  const economy = overrides.economy || require("../../services/economy.js")
  const events = overrides.events || require("../../services/events.js")
  const pointsPerMessage = overrides.pointsPerMessage ?? 2
  const getPointsPerMessage = typeof overrides.getPointsPerMessage === "function"
    ? overrides.getPointsPerMessage
    : () => pointsPerMessage

  function handle(event) {
    if (isCommandText(event)) return
    if (!hasEconomicIdentity(event)) return
    if (events.isEconomyFrozen()) return
    const mult = events.getMultiplier()
    try {
      const configuredPoints = Number(getPointsPerMessage(event))
      const messagePoints = Number.isFinite(configuredPoints) ? configuredPoints : pointsPerMessage
      economy.onMessage(event.actor.username, event.actor.displayName, messagePoints * mult, event.actor.platformUserId, event.platform)
    } catch (e) {}
  }

  return { handle }
}

// ── Niveles ───────────────────────────────────────────────────────────────
function createLevelsConsumer(overrides = {}) {
  const levels = overrides.levels || require("../../services/levels.js")

  function handle(event) {
    if (isCommandText(event)) return
    if (!hasEconomicIdentity(event)) return
    try { levels.onMessage(event.actor.username, event.actor.platformUserId, event.platform) } catch (e) {}
  }

  return { handle }
}

// ── Widget de avatar en el overlay ──────────────────────────────────────────
function createWidgetsConsumer(overrides = {}) {
  const widgets = overrides.widgets || require("../../services/widgets.js")

  function handle(event) {
    if (isCommandText(event)) return
    try {
      const color = (event.metadata && event.metadata.color) || "#7c6ef5"
      widgets.onChatMessage(event.actor.username, event.actor.displayName, color, event.platform, event.actor.platformUserId).catch(() => {})
    } catch (e) {}
  }

  return { handle }
}

// ── Feed de chat agnóstico para la UI (Fase 1.6) ────────────────────────────
// Reemplaza el IPC "twitch:message" (Twitch-only) como fuente del panel de
// chat del Dashboard. `notify` es el mismo puente hacia el renderer que ya
// usan notify/overlay en Command Engine — este consumidor no sabe qué
// ventana es ni que existe Electron.
function createChatFeedConsumer(overrides = {}) {
  const notify = overrides.notify || (() => {})
  const channel = overrides.channel || "chat:message"

  function handle(event) {
    if (isCommandText(event)) return
    notify(channel, {
      platform: event.platform,
      username: event.actor.username,
      displayName: event.actor.displayName || event.actor.username,
      text: event.message.text,
      timestamp: event.receivedAt || new Date().toISOString(),
    })
  }

  return { handle }
}

// ── AFK: contador comunitario ────────────────────────────────────────────────
// afk.js es intencionalmente un juego GLOBAL (todo el chat cuenta junto), no
// per-plataforma — ver comentario en services/afk.js. Solo pasamos la
// identidad para que la penalización/premio en puntos vaya a la wallet real.
function createAfkConsumer(overrides = {}) {
  const afk = overrides.afk || require("../../services/afk.js")

  function handle(event) {
    if (isCommandText(event)) return
    try {
      afk.onMessage(event.actor.username, event.actor.displayName, event.message.text, event.platform, event.actor.platformUserId)
    } catch (e) {}
  }

  return { handle }
}

// ── Mini-reto ─────────────────────────────────────────────────────────────
// Reemplaza el estado que vivía dentro de twitch-adapter.js. `announce` es
// el canal de anuncio del resultado (por defecto no-op; en producción se
// conecta a twitch-adapter.js#say, igual que notify/overlay en Command
// Engine) — el propio consumidor sigue sin saber que existe Twitch.
function createChallengeConsumer(overrides = {}) {
  const economy = overrides.economy || require("../../services/economy.js")
  const announce = overrides.announce || (() => {})

  let challenge = null
  let endTimer = null

  function start(word, seconds = 30, reward = 100) {
    clearTimeout(endTimer)
    challenge = {
      word: (word || "🔥").toLowerCase(),
      reward: reward || 100,
      winners: new Set(), // claves de identidad (platform:platformUserId|legacy:username), no username a secas
      endsAt: Date.now() + (seconds || 30) * 1000,
    }
    endTimer = setTimeout(() => {
      if (challenge) {
        const n = challenge.winners.size
        announce(`⚡ ¡Reto terminado! ${n} viewer${n !== 1 ? "s" : ""} ganaron ${challenge.reward} puntos.`)
        challenge = null
      }
    }, (seconds || 30) * 1000)
  }

  function handle(event) {
    if (!challenge) return
    if (isCommandText(event)) return
    if (!hasEconomicIdentity(event)) return // el reto otorga puntos: misma política conservadora que XP/Niveles
    if (Date.now() > challenge.endsAt) return
    const key = `${event.platform}:${event.actor.platformUserId || "legacy:" + event.actor.username}`
    if (challenge.winners.has(key)) return
    if (event.message.text.toLowerCase().includes(challenge.word)) {
      challenge.winners.add(key)
      try {
        economy.addPoints(event.actor.username, challenge.reward, "mini-reto", {
          platform: event.platform, platformUserId: event.actor.platformUserId,
        })
      } catch (e) {}
    }
  }

  function getActiveChallenge() { return challenge }

  return { start, handle, getActiveChallenge }
}

let defaultChallengeConsumer = null
// Singleton: la misma instancia que se suscribe al Event Engine al arrancar
// (ver registerChatActivityConsumers) es la que services/twitch.js#startMiniChallenge
// usa para arrancar un reto — así un reto iniciado desde Mimics realmente
// queda escuchando los chat_message que emite el Event Engine.
function getDefaultChallengeConsumer(overrides) {
  if (!defaultChallengeConsumer) defaultChallengeConsumer = createChallengeConsumer(overrides)
  return defaultChallengeConsumer
}

// ── Registro central ─────────────────────────────────────────────────────
// Punto único de arranque para todos los consumidores de actividad general
// de chat, análogo a registerCommandEngine/registerSoundTriggerEngine de la
// Fase 0/1. Debe llamarse siempre al iniciar Mimiku (ver overlay-server.js),
// nunca solo al cargar twitch.js — así una instalación que use únicamente
// Social Stream Ninja también tiene XP, niveles, widgets, AFK y mini-reto.
function registerChatActivityConsumers(eventEngine, overrides = {}) {
  const xp = createXpConsumer(overrides.xp)
  const levels = createLevelsConsumer(overrides.levels)
  const widgets = createWidgetsConsumer(overrides.widgets)
  const afk = createAfkConsumer(overrides.afk)
  const challenge = getDefaultChallengeConsumer(overrides.challenge)
  const chatFeed = createChatFeedConsumer(overrides.chatFeed)

  eventEngine.subscribe("chat_message", xp.handle)
  eventEngine.subscribe("chat_message", levels.handle)
  eventEngine.subscribe("chat_message", widgets.handle)
  eventEngine.subscribe("chat_message", afk.handle)
  eventEngine.subscribe("chat_message", challenge.handle)
  eventEngine.subscribe("chat_message", chatFeed.handle)

  return { xp, levels, widgets, afk, challenge, chatFeed }
}

module.exports = {
  createXpConsumer, createLevelsConsumer, createWidgetsConsumer, createAfkConsumer, createChallengeConsumer,
  createChatFeedConsumer, getDefaultChallengeConsumer, registerChatActivityConsumers,
}
