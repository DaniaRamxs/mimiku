// TikTok Adapter: conecta con el chat en vivo de TikTok, normaliza sus eventos
// al contrato interno de Mimiku y los entrega al Event Engine. No decide qué
// pasa con ellos (puntos, Mimics, comandos): solo normaliza y emite.
//
// AVISO: la fuente es `tiktok-live-connector`, una librería NO oficial que
// hace ingeniería inversa del servicio Webcast de TikTok. Puede romperse en
// cualquier momento, delega la firma de la conexión a un servidor de terceros
// (Euler Stream) y es AGPL-3.0. Por eso:
//   - vive tras `connectionFactory`, una interfaz mínima reemplazable;
//   - es dependencia opcional: si no se puede cargar, el adaptador queda en
//     estado "unavailable" y el resto de Mimiku sigue funcionando.
//
// Envio de chat (opcional): con credenciales (clave de API de Euler Stream +
// sessionid + tt-target-idc) y la opcion activada, los eventos de chat pueden
// responderse en el chat de TikTok. Esas credenciales viajan al servicio de
// firma de terceros, asi que solo se usan si el streamer lo activa. Los
// mensajes salen por una cola con espera minima entre envios y se desactiva
// el envio tras fallos consecutivos para no martillar la cuenta.
//
// Formato de los eventos que emite (además de los campos comunes de
// event-normalizer.js):
//   chat_message: { message: { text } }
//   follow:       { payload: { } }
//   like:         { payload: { count, total } }
//   gift:         { payload: { giftId, giftName, unitCoins, count, coins, comboId } }
//                 `count` y `coins` son el TOTAL del combo, y el evento se
//                 emite UNA sola vez, al cerrarse el combo.

const PLATFORM = "tiktok"
const SOURCE = "tiktok-native"

// Un combo de regalos sin `repeatEnd` durante este tiempo se da por cerrado
// (TikTok a veces no manda el cierre si el streamer o el viewer se desconecta).
const COMBO_IDLE_FLUSH_MS = 8000
// Tras cerrar un combo se recuerda su id para ignorar un `repeatEnd` tardío.
const CLOSED_COMBO_MEMORY_MS = 60000
const STREAKABLE_GIFT_TYPE = 1

const RECONNECT_BASE_MS = 5000
const RECONNECT_MAX_MS = 60000

const LIMITS = { text: 500, name: 100, url: 1000, id: 200 }

// Limites del envio de chat: TikTok corta mensajes largos y castiga el spam.
const CHAT_MAX_LENGTH = 150
const SEND_MIN_INTERVAL_MS = 2000
const SEND_QUEUE_MAX = 20
const SEND_MAX_CONSECUTIVE_FAILURES = 3

function truncate(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function toInt(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback
}

// El avatar viene como Image { urlList: [...] } en el protobuf.
function avatarOf(user) {
  const url = user?.avatarThumb?.urlList?.[0] || user?.avatarMedium?.urlList?.[0] || ""
  return truncate(url, LIMITS.url)
}

// tiktok-live-connector 2.x entrega el protobuf v3 tal cual: el texto del chat
// es `content`, el @usuario es `user.displayId` y el id numerico `user.idStr`.
// La API legacy (WebcastPushConnection) los aplana como `comment`, `uniqueId` y
// `userId`. Se aceptan ambas formas; las de v3 tienen prioridad.
function firstText(...values) {
  return values.find(value => typeof value === "string" && value.trim() !== "") ?? ""
}

function userHandle(user) {
  return firstText(user?.displayId, user?.uniqueId)
}

function userIdOf(user) {
  return firstText(user?.idStr, user?.userId, user?.id === undefined ? "" : String(user.id))
}

function normalizeActor(user, identity) {
  const username = truncate(userHandle(user), LIMITS.name).toLowerCase()
  return {
    platformUserId: truncate(userIdOf(user), LIMITS.id),
    username: username || "anon",
    displayName: truncate(user?.nickname, LIMITS.name) || username || "anon",
    avatarUrl: avatarOf(user),
    // `userIdentity` solo viene en chat y regalos; en el resto queda false.
    isModerator: identity?.isModeratorOfAnchor === true,
  }
}

const noReply = () => {}
// Contexto de respuesta por defecto: sin envio, la respuesta va al panel local.
const NO_REPLY_CONTEXT = Object.freeze({ canReply: false, reply: noReply })

function baseEvent(type, data, extra, context = NO_REPLY_CONTEXT) {
  return {
    id: extra.id || null,
    source: SOURCE,
    platform: PLATFORM,
    type,
    actor: normalizeActor(data?.user, data?.userIdentity),
    metadata: { capabilities: { reply: context.canReply } },
    reply: context.reply,
    ...extra.fields,
  }
}

function msgId(data) {
  const id = data?.common?.msgId
  return id ? truncate(String(id), LIMITS.id) : null
}

function normalizeChat(data, context) {
  const text = truncate(firstText(data?.content, data?.comment), LIMITS.text)
  if (!text) return null
  return baseEvent("chat_message", data, {
    id: msgId(data),
    fields: { message: { text, emotes: [] } },
  }, context)
}

function normalizeFollow(data) {
  return baseEvent("follow", data, { id: msgId(data), fields: { payload: {} } })
}

function normalizeLike(data) {
  return baseEvent("like", data, {
    id: msgId(data),
    fields: { payload: { count: toInt(data?.count ?? data?.likeCount), total: toInt(data?.total ?? data?.totalLikeCount) } },
  })
}

// Un regalo se identifica dentro de su combo por (usuario, groupId). Sin
// groupId se degrada a (usuario, giftId), que basta para un combo a la vez.
function comboKey(data) {
  const user = userIdOf(data?.user) || userHandle(data?.user)
  return `${user}:${data?.groupId || `gift-${giftInfo(data).id ?? ""}`}`
}

// v3: `gift { id, name, type, diamondCount }`; legacy: `giftDetails { giftName, giftType, diamondCount }`.
function giftInfo(data) {
  const gift = data?.gift || data?.giftDetails || {}
  return {
    id: gift.id ?? data?.giftId,
    name: gift.name ?? gift.giftName,
    type: gift.type ?? gift.giftType,
    diamondCount: gift.diamondCount,
  }
}

function giftSnapshot(data) {
  const count = Math.max(1, toInt(data?.repeatCount, 1))
  const info = giftInfo(data)
  const unitCoins = toInt(info.diamondCount)
  return {
    data,
    giftId: String(data?.giftId || info.id || ""),
    giftName: truncate(info.name, LIMITS.name),
    unitCoins,
    count,
  }
}

function buildGiftEvent(key, snapshot) {
  return baseEvent("gift", snapshot.data, {
    // El id incluye el total: si un flush por inactividad y un cierre tardío
    // llegaran ambos, la clave de comboKey ya los separa; esto solo es trazabilidad.
    id: `tiktok-gift:${key}`,
    fields: {
      payload: {
        giftId: snapshot.giftId,
        giftName: snapshot.giftName,
        unitCoins: snapshot.unitCoins,
        count: snapshot.count,
        coins: snapshot.unitCoins * snapshot.count,
        comboId: key,
      },
    },
  })
}

// Acumula los ticks de un combo y emite el regalo una sola vez al cerrarse.
function createGiftComboTracker({ emit, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  const open = new Map() // key -> { snapshot, timer }
  const closedAt = new Map() // key -> timestamp de cierre

  function forgetOldClosed() {
    const limit = now() - CLOSED_COMBO_MEMORY_MS
    for (const [key, at] of closedAt) {
      if (at < limit) closedAt.delete(key)
      else break
    }
  }

  function close(key) {
    const entry = open.get(key)
    if (!entry) return
    clearTimer(entry.timer)
    open.delete(key)
    closedAt.set(key, now())
    emit(buildGiftEvent(key, entry.snapshot))
  }

  function handle(data) {
    forgetOldClosed()
    const key = comboKey(data)
    const snapshot = giftSnapshot(data)
    const streakable = giftInfo(data).type === STREAKABLE_GIFT_TYPE

    if (!streakable) {
      // Regalo sin combo: se procesa de inmediato, con un id único por evento.
      emit(buildGiftEvent(`${key}:${msgId(data) || now()}`, snapshot))
      return
    }

    const isEnd = Boolean(data?.repeatEnd)
    // Ya cerrado por inactividad: ignorar el cierre tardío. Solo es fiable con
    // groupId; sin él la clave se reutiliza y bloquearía combos nuevos.
    if (data?.groupId && closedAt.has(key)) return

    const previous = open.get(key)
    if (previous) clearTimer(previous.timer)
    // El conteo de TikTok es acumulado: siempre nos quedamos con el mayor.
    const merged = previous && previous.snapshot.count > snapshot.count
      ? { ...snapshot, count: previous.snapshot.count }
      : snapshot
    const timer = setTimer(() => close(key), COMBO_IDLE_FLUSH_MS)
    if (timer && typeof timer.unref === "function") timer.unref()
    open.set(key, { snapshot: merged, timer })
    if (isEnd) close(key)
  }

  function flushAll() {
    for (const key of [...open.keys()]) close(key)
  }

  return { handle, flushAll, pendingCount: () => open.size }
}

// Carga perezosa: el paquete es ESM y opcional, así que se importa dinámicamente.
async function loadTikTokLibrary() {
  return import("tiktok-live-connector")
}

async function defaultConnectionFactory(username, { credentials } = {}) {
  const library = await loadTikTokLibrary()
  const options = credentials
    ? {
        signApiKey: credentials.signApiKey,
        authenticateWs: true,
        session: { cookie: { type: "cookie", value: { sessionId: credentials.sessionId, ttTargetIdc: credentials.ttTargetIdc } } },
      }
    : {}
  const connection = new library.TikTokLiveConnection(username, options)
  return {
    on: (name, handler) => connection.on(name, handler),
    connect: () => connection.connect(),
    disconnect: () => connection.disconnect(),
    // Solo tiene sentido con credenciales; sin ellas la libreria lo rechazaria.
    ...(credentials ? { sendMessage: text => connection.sendMessage(text) } : {}),
  }
}

function hasCompleteCredentials(credentials) {
  return Boolean(credentials && credentials.signApiKey && credentials.sessionId && credentials.ttTargetIdc)
}

// Texto seguro para el chat: una linea, longitud maxima y sin empezar por "!"
// (una respuesta que empiece con "!" podria leerse como comando).
function prepareOutgoing(message) {
  let text = String(message ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  if (text.startsWith("!")) text = "Mimiku: " + text
  return text.length > CHAT_MAX_LENGTH ? text.slice(0, CHAT_MAX_LENGTH - 3) + "..." : text
}

// tiktok-live-connector envuelve el fallo real en un Error genérico
// ("Error while connecting") y deja el original en `exception` (o `cause`).
// Sin desenvolverlo, "no estás en directo" se mostraba como fallo genérico.
function unwrapError(error) {
  return error?.exception || error?.cause || error
}

// Enviar chat pasa por el servicio de Euler Stream, que lo reserva a claves con
// plan de pago: responde 401/403 y la libreria lanza "[Premium Feature] ...".
// Reintentar no lo arregla, asi que se distingue de un fallo transitorio.
function isPremiumRequiredError(error) {
  const text = `${unwrapError(error)?.message || ""} ${error?.message || ""}`
  return /premium feature|paid plan/i.test(text)
}

const PREMIUM_SEND_NOTE = "Euler Stream rechazó el envío: enviar mensajes al chat exige una clave de API con plan de pago (o la clave/sesión no es válida)."

function friendlyError(error) {
  const root = unwrapError(error)
  const name = root?.name || ""
  if (name === "UserOfflineError") return "El canal de TikTok no está en directo."
  if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND") {
    return "La librería de TikTok no está instalada en esta copia de Mimiku."
  }
  const detail = root?.message ? ` Motivo: ${String(root.message).slice(0, 160)}` : ""
  return `No se pudo conectar con TikTok. Se reintentará automáticamente.${detail}`
}

// Diagnostico temporal: con MIMIKU_TIKTOK_RAW=1 se registra cada evento tal y
// como sale de la libreria, ANTES de normalizarlo. Solo contiene datos de los
// espectadores; las credenciales del streamer nunca pasan por aqui.
const RAW_EVENTS = ["chat", "follow", "like", "gift", "member", "roomUser", "share", "streamEnd"]
const RAW_PREVIEW_CHARS = 1200

function rawPreview(data) {
  try {
    const json = JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
    return typeof json === "string" ? json.slice(0, RAW_PREVIEW_CHARS) : String(json)
  } catch {
    return "[no serializable]"
  }
}

function createTikTokAdapter(overrides = {}) {
  const eventEngine = overrides.eventEngine || require("../../core/events/event-engine.js").getDefaultEventEngine()
  const connectionFactory = overrides.connectionFactory || defaultConnectionFactory
  const setTimer = overrides.setTimer || setTimeout
  const clearTimer = overrides.clearTimer || clearTimeout
  const log = overrides.log || console
  const getCredentials = overrides.getCredentials || (() => null)
  const rawLogging = overrides.rawLogging ?? process.env.MIMIKU_TIKTOK_RAW === "1"
  let warnedDroppedChat = false

  let connection = null
  let username = ""
  let autoReconnect = true
  let attempts = 0
  let reconnectTimer = null
  let generation = 0 // invalida callbacks de conexiones antiguas
  let sendReplies = false
  let sender = null // { conn, generation, queue, busy, failures, disabled }
  let sendNote = "" // por que no se envia, para la UI
  let status = { state: "disconnected", username: "", error: null, attempts: 0 }

  const combos = createGiftComboTracker({ emit: event => eventEngine.emit(event), setTimer, clearTimer })

  function setStatus(state, error = null) {
    status = { state, username, error, attempts }
  }

  function canSend() {
    return Boolean(sender && !sender.disabled && sender.generation === generation && status.state === "connected")
  }

  // ── Cola de envio ──────────────────────────────────────────────────────
  function pump(activeSender) {
    if (activeSender.busy || activeSender.disabled) return
    const text = activeSender.queue.shift()
    if (text === undefined) return
    activeSender.busy = true
    Promise.resolve()
      .then(() => activeSender.conn.sendMessage(text))
      .then(() => { activeSender.failures = 0 })
      .catch(error => {
        activeSender.failures++
        log.warn("[tiktok] no se pudo enviar el mensaje:", unwrapError(error)?.message || error?.message || error)
        if (isPremiumRequiredError(error)) {
          activeSender.disabled = true
          activeSender.queue.length = 0
          sendNote = PREMIUM_SEND_NOTE
        } else if (activeSender.failures >= SEND_MAX_CONSECUTIVE_FAILURES) {
          activeSender.disabled = true
          activeSender.queue.length = 0
          sendNote = "Se desactivó el envío tras varios fallos (sesión caducada o clave de API inválida)."
        }
      })
      .finally(() => {
        // Espera minima entre envios, aunque el anterior haya fallado.
        const timer = setTimer(() => { activeSender.busy = false; pump(activeSender) }, SEND_MIN_INTERVAL_MS)
        if (timer && typeof timer.unref === "function") timer.unref()
      })
  }

  function say(message) {
    if (!canSend()) return false
    const text = prepareOutgoing(message)
    if (!text) return false
    if (sender.queue.length >= SEND_QUEUE_MAX) return false // mejor perder una respuesta que inundar el chat
    sender.queue.push(text)
    pump(sender)
    return true
  }

  // Contexto que llevan los eventos de chat: responden por el chat de TikTok
  // solo mientras el envio este realmente disponible.
  function replyContext() {
    return canSend() ? { canReply: true, reply: say } : NO_REPLY_CONTEXT
  }

  function safeEmit(event) {
    if (!event) return
    try { eventEngine.emit(event) } catch (error) { log.error("[tiktok] evento inválido:", error.message) }
  }

  // Un chat que no se puede normalizar casi siempre es un cambio de formato de
  // la libreria: se avisa una vez con las claves recibidas para no fallar mudo.
  function emitChat(data) {
    const event = normalizeChat(data, replyContext())
    if (!event && !warnedDroppedChat) {
      warnedDroppedChat = true
      log.warn("[tiktok] chat descartado sin texto. Claves recibidas:", Object.keys(data || {}).join(","))
    }
    safeEmit(event)
  }

  function bind(conn, myGeneration) {
    const guard = handler => data => {
      if (myGeneration !== generation) return
      try { handler(data) } catch (error) { log.error("[tiktok] error procesando evento:", error.message) }
    }
    if (rawLogging) {
      for (const name of RAW_EVENTS) {
        conn.on(name, guard(data => log.warn(`[TIKTOK RAW] event: ${name} payload: ${rawPreview(data)}`)))
      }
    }
    conn.on("chat", guard(emitChat))
    conn.on("follow", guard(data => safeEmit(normalizeFollow(data))))
    conn.on("like", guard(data => safeEmit(normalizeLike(data))))
    conn.on("gift", guard(data => combos.handle(data)))
    conn.on("streamEnd", guard(() => combos.flushAll()))
    conn.on("disconnected", guard(() => {
      combos.flushAll()
      setStatus("disconnected")
      scheduleReconnect(myGeneration)
    }))
    conn.on("error", guard(error => log.warn("[tiktok] error de la librería:", error?.message || error)))
  }

  function scheduleReconnect(myGeneration) {
    if (!autoReconnect || myGeneration !== generation || !username) return
    attempts++
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempts - 1, 4))
    setStatus("reconnecting", status.error)
    clearTimer(reconnectTimer)
    reconnectTimer = setTimer(() => { attemptConnect(myGeneration).catch(() => {}) }, delay)
    if (reconnectTimer && typeof reconnectTimer.unref === "function") reconnectTimer.unref()
  }

  async function attemptConnect(myGeneration) {
    if (myGeneration !== generation) return
    setStatus(attempts ? "reconnecting" : "connecting")
    try {
      const credentials = sendReplies ? getCredentials() : null
      if (sendReplies && !hasCompleteCredentials(credentials)) {
        sendNote = "Faltan credenciales para responder en el chat de TikTok."
      }
      const usable = hasCompleteCredentials(credentials) ? credentials : null
      const conn = await connectionFactory(username, { credentials: usable })
      if (myGeneration !== generation) return
      connection = conn
      sender = usable && typeof conn.sendMessage === "function"
        ? { conn, generation: myGeneration, queue: [], busy: false, failures: 0, disabled: false }
        : null
      if (sender) sendNote = ""
      bind(conn, myGeneration)
      await conn.connect()
      if (myGeneration !== generation) return
      attempts = 0
      setStatus("connected")
    } catch (error) {
      if (myGeneration !== generation) return
      log.warn("[tiktok] conexión fallida:", unwrapError(error)?.message || error?.message || error)
      const unavailable = error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND"
      if (unavailable) {
        setStatus("unavailable", friendlyError(error))
        return
      }
      setStatus("error", friendlyError(error))
      scheduleReconnect(myGeneration)
    }
  }

  function cleanUsername(value) {
    return truncate(value, 40).replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_.]/g, "")
  }

  function connect(rawUsername, options = {}) {
    const cleaned = cleanUsername(rawUsername)
    if (!cleaned) throw new Error("Escribe el usuario de TikTok")
    disconnect()
    username = cleaned
    autoReconnect = options.autoReconnect !== false
    sendReplies = options.sendReplies === true
    sendNote = ""
    attempts = 0
    generation++
    return attemptConnect(generation)
  }

  function disconnect() {
    generation++
    clearTimer(reconnectTimer)
    reconnectTimer = null
    combos.flushAll()
    const previous = connection
    connection = null
    sender = null
    if (previous) {
      try { Promise.resolve(previous.disconnect()).catch(() => {}) } catch { /* ya cerrada */ }
    }
    attempts = 0
    setStatus("disconnected")
  }

  return {
    connect, disconnect, say,
    getStatus: () => ({ ...status, sendReplies, canSend: canSend(), sendNote: sendReplies && !canSend() ? sendNote : "" }),
  }
}

let defaultAdapter = null
function getDefaultTikTokAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = createTikTokAdapter({
      getCredentials: () => require("../../services/secret-store.js").getDefaultSecretStore().getTikTokCredentials(),
    })
  }
  return defaultAdapter
}

module.exports = {
  createTikTokAdapter,
  getDefaultTikTokAdapter,
  createGiftComboTracker,
  friendlyError,
  normalizeChat,
  normalizeFollow,
  normalizeLike,
  COMBO_IDLE_FLUSH_MS,
  prepareOutgoing,
  CHAT_MAX_LENGTH,
  SEND_MIN_INTERVAL_MS,
  SEND_MAX_CONSECUTIVE_FAILURES,
}
