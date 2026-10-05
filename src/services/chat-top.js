// services/chat-top.js — Top 3 de mensajes del chat en el directo actual.
//
// Cuenta los mensajes de cada viewer (los comandos "!" no cuentan) en el
// directo en curso segun stream-sessions.js, asi que al empezar un directo
// nuevo el ranking arranca vacio. Los contadores viven en SQLite: si Mimiku se
// reinicia a mitad de directo, el top sigue donde estaba.
//
// Solo avisa al overlay cuando el top cambia (nombres, orden, numeros o
// fotos), y agrupa rafagas de mensajes para no mandar un aviso por cada uno.
//
// Fotos: TikTok las trae en el evento; Twitch no, asi que se piden con
// `getAvatar` solo para quien esta en el top 3 (no para todo el chat) y se
// guardan en la fila en cuanto llegan.
const TOP_SIZE = 3
const DEFAULT_DEBOUNCE_MS = 250

function viewerKey(event) {
  const actor = event.actor || {}
  return `${event.platform}:${actor.platformUserId || "legacy:" + String(actor.username || "").toLowerCase()}`
}

// `getAvatar(platform, username)` -> Promise<url|null> (opcional).
function createChatTopService({ db, sessions, now = () => new Date(), onChange = () => {}, debounceMs = DEFAULT_DEBOUNCE_MS, getAvatar = null }) {
  let timer = null
  let lastSignature = null
  const lookedUp = new Set()   // viewer_key ya consultados en este proceso

  sessions.onNewStream(() => {
    clearTimeout(timer)
    timer = null
    emit()
  })

  function recordMessage(event) {
    const text = event && event.message && event.message.text
    if (!text || !event.actor || !event.actor.username) return
    if (text.trim().startsWith("!")) return
    const stream = sessions.resolve()
    const actor = event.actor
    db.prepare(`INSERT INTO chat_top_counts(stream_id, viewer_key, platform, username, display, avatar_url, messages, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(stream_id, viewer_key) DO UPDATE SET
        messages = messages + 1, updated_at = excluded.updated_at,
        display = excluded.display,
        avatar_url = CASE WHEN excluded.avatar_url <> '' THEN excluded.avatar_url ELSE avatar_url END`)
      .run(stream.id, viewerKey(event), String(event.platform || ""), String(actor.username),
        String(actor.displayName || actor.username), String(actor.avatarUrl || ""), now().toISOString())
    schedule()
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(() => { timer = null; emit() }, debounceMs)
    if (timer.unref) timer.unref()
  }

  // A igual numero de mensajes va primero quien llego antes a esa cifra.
  function snapshot() {
    const stream = sessions.current()
    if (!stream) return { streamId: null, entries: [] }
    const rows = db.prepare(`SELECT viewer_key, platform, username, display, avatar_url, messages
      FROM chat_top_counts WHERE stream_id=? ORDER BY messages DESC, updated_at ASC, rowid ASC LIMIT ?`).all(stream.id, TOP_SIZE)
    return {
      streamId: stream.id,
      entries: rows.map(row => ({
        key: row.viewer_key, platform: row.platform, username: row.username,
        name: row.display || row.username, avatar: row.avatar_url || null, messages: row.messages,
      })),
    }
  }

  function fetchMissingAvatars(current) {
    if (!getAvatar || !current.streamId) return
    for (const entry of current.entries) {
      if (entry.avatar || lookedUp.has(entry.key)) continue
      lookedUp.add(entry.key)
      Promise.resolve(getAvatar(entry.platform, entry.username)).then(url => {
        if (!url || !/^https:\/\//.test(url)) return
        db.prepare("UPDATE chat_top_counts SET avatar_url=? WHERE viewer_key=? AND avatar_url=''").run(url, entry.key)
        schedule()
      }).catch(() => {})
    }
  }

  function emit() {
    const current = snapshot()
    fetchMissingAvatars(current)
    const signature = JSON.stringify([current.streamId, current.entries.map(entry => [entry.key, entry.messages, entry.name, entry.avatar])])
    if (signature === lastSignature) return
    lastSignature = signature
    onChange(current)
  }

  // Datos de ejemplo para probar el overlay sin tocar la base.
  function preview(step = 0) {
    const base = [
      { key: "demo:1", platform: "twitch", username: "lunagamer", name: "LunaGamer", avatar: null, messages: 42 },
      { key: "demo:2", platform: "twitch", username: "solecitoxd", name: "SolecitoXD", avatar: null, messages: 38 },
      { key: "demo:3", platform: "tiktok", username: "mimi", name: "Mimi_Chan", avatar: null, messages: 25 },
      { key: "demo:4", platform: "twitch", username: "kaiser", name: "KaiserDelChat", avatar: null, messages: 24 },
    ]
    const frames = [
      [base[0], base[1], base[2]],
      [{ ...base[1], messages: 43 }, base[0], base[2]],
      [{ ...base[1], messages: 44 }, base[0], { ...base[3], messages: 26 }],
    ]
    return { streamId: "preview", entries: frames[Math.abs(step) % frames.length] }
  }

  return { recordMessage, snapshot, preview }
}

let defaultService = null
function getDefaultChatTopService(onChange) {
  if (!defaultService) {
    defaultService = createChatTopService({
      db: require("./local-runtime.js").getLocalPlatform().db,
      sessions: require("./stream-sessions.js").getDefaultStreamSessions(),
      onChange: onChange || (() => {}),
      // Foto de Twitch via Helix; primero la guardada en la identidad local.
      getAvatar: (platform, username) => {
        if (platform !== "twitch") return null
        const local = require("./local-runtime.js").getLocalPlatform().identities.byUsername(username, "twitch")
        if (local && /^https:\/\//.test(local.avatar_url || "")) return local.avatar_url
        return require("./twitch-avatars.js").getDefaultTwitchAvatars().getAvatar(username)
      },
    })
  }
  return defaultService
}

module.exports = { createChatTopService, getDefaultChatTopService, TOP_SIZE }
