// Twitch Adapter: normaliza los eventos de tmi.js al contrato interno de
// Mimiku y los entrega al Event Engine. Desde la Fase 1.5, este archivo NO
// decide qué pasa con un mensaje de chat general — solo normaliza y emite.
// Comandos → Command Engine. Sonidos → Sound Trigger Engine. Actividad, XP,
// niveles, widget de avatar, AFK y mini-reto → los consumidores agnósticos
// de src/core/interactions/activity-consumer.js y
// src/core/interactions/chat-activity-consumers.js, registrados siempre al
// arrancar Mimiku (ver overlay-server.js), no aquí.
//
// Lo que SIGUE siendo específico de Twitch, a propósito, y permanece en este
// archivo: la conexión de tmi.js, `say` (responder por el chat de Twitch), y
// los eventos nativos de tmi.js que todavía no se normalizan como eventos
// Mimiku (subscription/resub/cheer/raided/follow) — ver
// docs/multiplatform-architecture.md.
//
// `events.js` se importa de forma perezosa dentro del handler de mensajes
// (no al cargar este archivo) porque arrastra a src/services/db.js, que solo
// puede inicializarse dentro del proceso principal de Electron real.
const tmi = require("tmi.js")
const { addPoints } = require("../../services/economy.js")
const { getDefaultActivityTracker } = require("../../core/interactions/activity-consumer.js")
const { getDefaultChallengeConsumer } = require("../../core/interactions/chat-activity-consumers.js")

let client = null
let _win = null
let _channel = null
let _broadcast = null
let _eventEngine = null
let _status = { state: "disconnected", channel: "", error: null }

function setWindow(win) { _win = win }
function setBroadcast(fn) { _broadcast = fn }
function setEventEngine(engine) { _eventEngine = engine }

function send(event, data) {
  if (_win && !_win.isDestroyed()) _win.webContents.send(event, data)
}

function sendOverlay(payload) {
  if (_broadcast) _broadcast(payload)
}

function say(msg) {
  if (client && _channel) client.say(_channel, msg).catch(() => {})
}

function isMod(tags) {
  return tags.mod || tags.badges?.broadcaster === "1" || tags["user-type"] === "mod"
}

function isVip(tags) {
  return tags?.badges?.vip === "1" || tags?.badges?.vip === 1 || tags?.badges?.vip === true
}

// Normalización pura de un mensaje de tmi.js al contrato interno de Mimiku.
// No depende de que haya un client de tmi.js conectado: solo transforma la
// forma de `tags`. Exportada para poder probarla de forma aislada.
function normalizeTwitchChatMessage({ tags, message, channel, replyFn }) {
  const username = tags.username || "anon"
  const display = tags["display-name"] || username
  return {
    id: tags.id || null,
    platform: "twitch",
    type: "chat_message",
    actor: {
      platformUserId: tags["user-id"] || "",
      username,
      displayName: display,
      avatarUrl: "",
      isModerator: isMod(tags),
      ...(isVip(tags) ? { isVip: true } : {}),
    },
    message: { text: message, emotes: [] },
    metadata: { channel, color: tags.color || "#7c6ef5", badges: tags.badges || {}, capabilities: { reply: true } },
    reply: replyFn || say,
  }
}

function emitEvent(event) {
  if (_eventEngine) _eventEngine.emit(event)
}

// Delegado a Mimics vía services/twitch.js — la Fase 1.5 movió el estado del
// reto a un consumidor agnóstico (chat-activity-consumers.js); esto solo
// reenvía la llamada.
function startMiniChallenge(word, seconds, reward) {
  getDefaultChallengeConsumer().start(word, seconds, reward)
}

// Subathon: suma tiempo al contador y cuenta para la meta de subs.
function subathonSub(tags, display, label) {
  try {
    require("../../services/subathon.js").getDefaultSubathon().recordTwitchSub({
      id: tags.id || "", user: display, plan: tags["msg-param-sub-plan"] || "1000", label,
    })
  } catch (error) {
    console.warn("[subathon] no se pudo sumar el sub:", error.message)
  }
}

// ── Conexión ──────────────────────────────────────────────────────────────────
function connect(channel, token) {
  if (client) { client.disconnect().catch(() => {}); client = null }
  _channel = channel.toLowerCase()
  _status = { state: "connecting", channel: _channel, error: null }

  client = new tmi.Client({
    options: { debug: false },
    identity: token ? { username: channel, password: token } : undefined,
    channels: [channel],
  })

  client.on("message", (ch, tags, message, self) => {
    if (self) return
    const event = normalizeTwitchChatMessage({ tags, message, channel: _channel, replyFn: say })

    if (message.startsWith("!")) {
      // Los comandos "solo-idle" de AFK (!afk/!brb/!contador) ya se resuelven
      // dentro de Command Engine (Fase 1.6) — no hace falta interceptarlos
      // aquí antes de emitir.
      emitEvent(event) // → Command Engine
      return
    }

    // Actividad/XP/niveles/widgets/AFK/mini-reto ya no se llaman aquí
    // directamente: reaccionan a este mismo evento vía Event Engine
    // (Activity Consumer + chat-activity-consumers.js), igual que lo haría
    // un mensaje de YouTube o TikTok llegado por Social Stream Ninja.
    emitEvent(event) // → Sound Trigger Engine + consumidores de actividad

    // Compatibilidad con sesiones abiertas antes de que se registrara el
    // Event Engine: el sonido de emote debe seguir funcionando aunque una
    // instancia antigua no haya conectado ese consumidor al arrancar.
    // El servicio mantiene su propio cooldown, así que esto no duplica audio
    // cuando el consumidor moderno ya está activo.
    try { require("../../services/emoteSounds.js").onMessage(message, "twitch") } catch (error) {
      console.warn("[emote-sounds] no se pudo procesar el mensaje:", error.message)
    }

  })

  client.on("subscription", (ch, username, method, msg, tags) => {
    const display = tags["display-name"] || username
    addPoints(username, 150, "sub", { platform: "twitch", platformUserId: tags["user-id"] || "" })
    send("twitch:event", { type: "sub", text: `🎉 ${display} se suscribió`, username, display })
    sendOverlay({ type: "alert", text: `🎉 ${display} se suscribió!`, duration: 5000 })
    subathonSub(tags, display, "sub")
  })

  client.on("resub", (ch, username, months, msg, tags) => {
    const display = tags["display-name"] || username
    addPoints(username, 80, "resub", { platform: "twitch", platformUserId: tags["user-id"] || "" })
    send("twitch:event", { type: "resub", text: `🔁 ${display} resubscribió (${months} meses)`, username, display, months })
    sendOverlay({ type: "alert", text: `🔁 ${display} resubscribió (${months} meses)!`, duration: 5000 })
    subathonSub(tags, display, "resub")
  })

  // Subs regalados: Twitch manda un "subgift" por cada sub, tambien cuando
  // vienen en lote ("submysterygift"); por eso el subathon cuenta aqui y el
  // lote solo anuncia. Los regalos de un lote no se anuncian uno a uno.
  client.on("subgift", (ch, username, streakMonths, recipient, methods, tags) => {
    const display = tags["display-name"] || username
    send("twitch:event", { type: "subgift", text: `${display} regaló un sub a ${recipient}`, username, display })
    if (!tags["msg-param-community-gift-id"]) sendOverlay({ type: "alert", text: `${display} regaló un sub a ${recipient}!`, duration: 5000 })
    subathonSub(tags, display, `regalo a ${recipient}`)
  })

  client.on("anonsubgift", (ch, streakMonths, recipient, methods, tags) => {
    send("twitch:event", { type: "subgift", text: `Un anónimo regaló un sub a ${recipient}`, username: "anon", display: "Anónimo" })
    if (!tags["msg-param-community-gift-id"]) sendOverlay({ type: "alert", text: `Un anónimo regaló un sub a ${recipient}!`, duration: 5000 })
    subathonSub(tags, "Anónimo", `regalo a ${recipient}`)
  })

  client.on("submysterygift", (ch, username, count, methods, tags) => {
    const display = tags["display-name"] || username
    send("twitch:event", { type: "submysterygift", text: `${display} regaló ${count} subs`, username, display, count })
    sendOverlay({ type: "alert", text: `${display} regaló ${count} subs!`, duration: 6000 })
  })

  client.on("anonsubmysterygift", (ch, count, methods, tags) => {
    send("twitch:event", { type: "submysterygift", text: `Un anónimo regaló ${count} subs`, username: "anon", display: "Anónimo", count })
    sendOverlay({ type: "alert", text: `Un anónimo regaló ${count} subs!`, duration: 6000 })
  })

  client.on("cheer", (ch, tags, msg) => {
    const username = tags.username || "anon"
    const display = tags["display-name"] || username
    const bits = tags.bits || 0
    addPoints(username, Math.floor(bits / 10) * 3, "bits", { platform: "twitch", platformUserId: tags["user-id"] || "" })
    send("twitch:event", { type: "cheer", text: `💎 ${display} donó ${bits} bits`, username, display, bits })
    sendOverlay({ type: "alert", text: `💎 ${display} donó ${bits} bits!`, duration: 5000 })
    try {
      require("../../services/subathon.js").getDefaultSubathon().recordTwitchBits({ id: tags.id || "", user: display, bits: Number(bits) })
    } catch (error) {
      console.warn("[subathon] no se pudieron sumar los bits:", error.message)
    }
  })

  client.on("raided", (ch, username, viewers) => {
    addPoints(username, Math.min(viewers, 500), "raid", { platform: "twitch" })
    send("twitch:event", { type: "raid", text: `⚡ ${username} raid con ${viewers} viewers!`, username, viewers })
    sendOverlay({ type: "alert", text: `⚡ ${username} raid con ${viewers} viewers!`, duration: 6000 })
  })

  client.on("follow", (ch, username, methods) => {
    const display = username
    addPoints(username, 20, "follow", { platform: "twitch" })
    send("twitch:event", { type: "follow", text: `❤️ ${display} siguió el canal!`, username, display })
    sendOverlay({ type: "alert", text: `❤️ ${display} siguió el canal!`, duration: 4000 })
  })

  client.on("connected", () => {
    _status = { state: "connected", channel: _channel, error: null }
    send("twitch:status", { connected: true, channel })
    say(`mimiku activo ✦ Comandos: !puntos !daily !work !slots !ruleta !bj !duelo !info`)
  })

  client.on("disconnected", () => {
    _status = { state: "disconnected", channel: _channel, error: null }
    send("twitch:status", { connected: false })
  })
  client.connect().catch(err => {
    _status = { state: "error", channel: _channel, error: err.message }
    send("twitch:status", { connected: false, error: err.message })
  })
}

function disconnect() {
  client?.disconnect().catch(() => {})
  client = null
  _status = { state: "disconnected", channel: _channel || "", error: null }
}

function getStatus() { return { ..._status } }

function sayPublic(msg) { say(msg) }

// Wrapper legacy (Fase 1.5): forma histórica de esta función, solo
// usernames. Sourced de Activity Consumer, ya multiplataforma por dentro —
// callers que necesiten identidad completa deben usar
// activity-consumer.js#getDefaultActivityTracker().getActiveViewerIdentities()
// directamente (así lo hace mimics.js#streamerGift).
function getActiveViewers() {
  return getDefaultActivityTracker().getActiveUsernames()
}

module.exports = {
  connect, disconnect, setWindow, setBroadcast, setEventEngine,
  say: sayPublic, getActiveViewers, startMiniChallenge,
  normalizeTwitchChatMessage, isMod, isVip,
  // Puente genérico hacia la ventana del renderer (Fase 1.6): no es
  // "Twitch decidiendo algo del chat", es simplemente dónde ya vivía la
  // referencia a `win` — igual que notify/overlay ya se inyectan en
  // Command Engine desde aquí.
  sendToRenderer: send,
  getStatus,
}
