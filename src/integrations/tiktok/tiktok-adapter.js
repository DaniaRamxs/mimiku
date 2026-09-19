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

function normalizeActor(user) {
  const username = truncate(user?.uniqueId, LIMITS.name).toLowerCase()
  return {
    platformUserId: truncate(String(user?.userId ?? ""), LIMITS.id),
    username: username || "anon",
    displayName: truncate(user?.nickname, LIMITS.name) || username || "anon",
    avatarUrl: avatarOf(user),
    // TikTok no expone el equivalente a "moderador" en estos mensajes.
    isModerator: false,
  }
}

const noReply = () => {}

function baseEvent(type, data, extra) {
  return {
    id: extra.id || null,
    source: SOURCE,
    platform: PLATFORM,
    type,
    actor: normalizeActor(data?.user),
    metadata: { capabilities: { reply: false } },
    reply: noReply,
    ...extra.fields,
  }
}

function msgId(data) {
  const id = data?.common?.msgId
  return id ? truncate(String(id), LIMITS.id) : null
}

function normalizeChat(data) {
  const text = truncate(data?.comment, LIMITS.text)
  if (!text) return null
  return baseEvent("chat_message", data, {
    id: msgId(data),
    fields: { message: { text, emotes: [] } },
  })
}

function normalizeFollow(data) {
  return baseEvent("follow", data, { id: msgId(data), fields: { payload: {} } })
}

function normalizeLike(data) {
  return baseEvent("like", data, {
    id: msgId(data),
    fields: { payload: { count: toInt(data?.likeCount), total: toInt(data?.totalLikeCount) } },
  })
}

// Un regalo se identifica dentro de su combo por (usuario, groupId). Sin
// groupId se degrada a (usuario, giftId), que basta para un combo a la vez.
function comboKey(data) {
  const user = String(data?.user?.userId ?? data?.user?.uniqueId ?? "")
  return `${user}:${data?.groupId || `gift-${data?.giftId ?? ""}`}`
}

function giftSnapshot(data) {
  const count = Math.max(1, toInt(data?.repeatCount, 1))
  const unitCoins = toInt(data?.giftDetails?.diamondCount)
  return {
    data,
    giftId: String(data?.giftId ?? ""),
    giftName: truncate(data?.giftDetails?.giftName, LIMITS.name),
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
    const streakable = data?.giftDetails?.giftType === STREAKABLE_GIFT_TYPE

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

async function defaultConnectionFactory(username) {
  const library = await loadTikTokLibrary()
  const connection = new library.TikTokLiveConnection(username)
  return {
    on: (name, handler) => connection.on(name, handler),
    connect: () => connection.connect(),
    disconnect: () => connection.disconnect(),
  }
}

function friendlyError(error) {
  const name = error?.name || ""
  if (name === "UserOfflineError") return "El canal de TikTok no está en directo."
  if (error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "MODULE_NOT_FOUND") {
    return "La librería de TikTok no está instalada en esta copia de Mimiku."
  }
  return "No se pudo conectar con TikTok. Se reintentará automáticamente."
}

function createTikTokAdapter(overrides = {}) {
  const eventEngine = overrides.eventEngine || require("../../core/events/event-engine.js").getDefaultEventEngine()
  const connectionFactory = overrides.connectionFactory || defaultConnectionFactory
  const setTimer = overrides.setTimer || setTimeout
  const clearTimer = overrides.clearTimer || clearTimeout
  const log = overrides.log || console

  let connection = null
  let username = ""
  let autoReconnect = true
  let attempts = 0
  let reconnectTimer = null
  let generation = 0 // invalida callbacks de conexiones antiguas
  let status = { state: "disconnected", username: "", error: null, attempts: 0 }

  const combos = createGiftComboTracker({ emit: event => eventEngine.emit(event), setTimer, clearTimer })

  function setStatus(state, error = null) {
    status = { state, username, error, attempts }
  }

  function safeEmit(event) {
    if (!event) return
    try { eventEngine.emit(event) } catch (error) { log.error("[tiktok] evento inválido:", error.message) }
  }

  function bind(conn, myGeneration) {
    const guard = handler => data => {
      if (myGeneration !== generation) return
      try { handler(data) } catch (error) { log.error("[tiktok] error procesando evento:", error.message) }
    }
    conn.on("chat", guard(data => safeEmit(normalizeChat(data))))
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
      const conn = await connectionFactory(username)
      if (myGeneration !== generation) return
      connection = conn
      bind(conn, myGeneration)
      await conn.connect()
      if (myGeneration !== generation) return
      attempts = 0
      setStatus("connected")
    } catch (error) {
      if (myGeneration !== generation) return
      log.warn("[tiktok] conexión fallida:", error?.message || error)
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
    if (previous) {
      try { Promise.resolve(previous.disconnect()).catch(() => {}) } catch { /* ya cerrada */ }
    }
    attempts = 0
    setStatus("disconnected")
  }

  return { connect, disconnect, getStatus: () => ({ ...status }) }
}

let defaultAdapter = null
function getDefaultTikTokAdapter() {
  if (!defaultAdapter) defaultAdapter = createTikTokAdapter()
  return defaultAdapter
}

module.exports = {
  createTikTokAdapter,
  getDefaultTikTokAdapter,
  createGiftComboTracker,
  normalizeChat,
  normalizeFollow,
  normalizeLike,
  COMBO_IDLE_FLUSH_MS,
}
