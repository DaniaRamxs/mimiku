// services/streamelements.js — propinas de StreamElements apuntadas solas en
// "Apoyo al proyecto" (top de donadores + puntos), sin tener que copiarlas a mano.
//
// Se conecta al WebSocket "Astro" de StreamElements (wss://astro.streamelements.com,
// topic channel.tips) con el token JWT del streamer, guardado cifrado. Cada
// propina se guarda en `external_tips` (su id de StreamElements es la clave: la
// misma propina nunca se apunta dos veces). Si es en USD y el nombre coincide
// con alguien que haya escrito en el chat de Twitch, se apunta sola con
// support.registerDonation; si no, queda pendiente para que el streamer la
// asigne (o la descarte) desde el panel.
//
// Al conectar repasa las ultimas propinas por la API REST (las que llegaron con
// Mimiku cerrado), pero ignora las anteriores al momento en que se guardo el
// token: activar la integracion no importa propinas antiguas.
const { randomUUID } = require("node:crypto")

const ASTRO_URL = "wss://astro.streamelements.com"
const TIPS_API = "https://api.streamelements.com/kappa/v2/tips"
const TOKEN_SECRET = "streamelements_jwt"
const SINCE_KEY = "streamelements_since"
const RECONNECT_MIN_MS = 5000
const RECONNECT_MAX_MS = 60000
const CATCH_UP_LIMIT = 25

// Lee el canal del token (JWT: tres partes, la del medio es JSON en base64url).
function channelFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"))
    return typeof payload.channel === "string" ? payload.channel : null
  } catch (error) { return null }
}

// Propina de StreamElements (WebSocket o REST) -> forma interna, o null si no sirve.
function normalizeTip(raw) {
  const donation = raw && raw.donation
  if (!raw || !raw._id || !donation) return null
  const amount = Number(donation.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return {
    id: String(raw._id).slice(0, 80),
    name: String(donation.user && (donation.user.username || donation.user.name) || "").trim().slice(0, 80),
    amountCents: Math.round(amount * 100),
    currency: String(donation.currency || "USD").toUpperCase().slice(0, 8),
    message: String(donation.message || "").trim().slice(0, 200),
    createdAt: raw.createdAt && !Number.isNaN(Date.parse(raw.createdAt)) ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
  }
}

function createStreamElementsTips({
  platform, getChannel, support, secrets, settings, onChange = () => {},
  WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch, now = Date.now, log = console,
}) {
  const db = platform.db
  let socket = null
  let stopped = true
  let reconnectMs = RECONNECT_MIN_MS
  let reconnectTimer = null
  let state = { connected: false, error: null, lastTipAt: null }

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function setState(patch) {
    state = { ...state, ...patch }
    try { onChange(status()) } catch (error) { /* el aviso al panel nunca debe romper la conexion */ }
  }

  // ── Propinas ────────────────────────────────────────────────────────────────
  // Busca al viewer de Twitch por usuario o, si no, por nombre a mostrar.
  function findViewer(name) {
    const login = String(name || "").trim().replace(/^@/, "").toLowerCase()
    if (!login) return null
    return platform.identities.byUsername(login, "twitch")
      || db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND lower(display)=? LIMIT 1").get(login) || null
  }

  function noteOf(tip) {
    return ("StreamElements" + (tip.message ? ": " + tip.message : "")).slice(0, 120)
  }

  // Devuelve "applied", "pending", "duplicate" u "old".
  function handleTip(raw) {
    const tip = normalizeTip(raw)
    if (!tip) return "invalid"
    const since = Number(settings.get(SINCE_KEY)) || 0
    if (Date.parse(tip.createdAt) < since) return "old"
    const channelId = activeChannel()
    const inserted = db.prepare(`INSERT OR IGNORE INTO external_tips(id, channel_id, source, name, amount_cents, currency, message, tipped_at, status, received_at)
      VALUES (?, ?, 'streamelements', ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(tip.id, channelId, tip.name, tip.amountCents, tip.currency, tip.message, tip.createdAt, new Date(now()).toISOString()).changes
    if (!inserted) return "duplicate"
    setState({ lastTipAt: tip.createdAt })
    const viewer = tip.currency === "USD" ? findViewer(tip.name) : null
    if (!viewer) {
      db.prepare("UPDATE external_tips SET reason=? WHERE id=?").run(tip.currency === "USD" ? "unknown-viewer" : "currency", tip.id)
      return "pending"
    }
    const result = support.registerDonation({ username: viewer.username, platform: "twitch", amount: tip.amountCents / 100, note: noteOf(tip) })
    if (!result.ok) {
      db.prepare("UPDATE external_tips SET reason=? WHERE id=?").run(result.reason, tip.id)
      return "pending"
    }
    db.prepare("UPDATE external_tips SET status='applied', donation_id=?, viewer_id=?, reason=NULL WHERE id=?").run(result.donation.id, viewer.id, tip.id)
    return "applied"
  }

  function listPending() {
    return db.prepare(`SELECT id, name, amount_cents, currency, message, tipped_at, reason FROM external_tips
      WHERE channel_id=? AND status='pending' ORDER BY tipped_at DESC LIMIT 50`).all(activeChannel())
      .map(row => ({ id: row.id, name: row.name, amount: row.amount_cents / 100, currency: row.currency, message: row.message, at: row.tipped_at, reason: row.reason }))
  }

  // Asigna una propina pendiente a un viewer. `amountUsd`: obligatorio si no era en USD.
  function assign(tipId, { username, platform: platformName = "twitch", amountUsd = null } = {}) {
    const row = db.prepare("SELECT * FROM external_tips WHERE id=? AND channel_id=? AND status='pending'").get(String(tipId || ""), activeChannel())
    if (!row) return { ok: false, reason: "gone" }
    const amount = row.currency === "USD" ? row.amount_cents / 100 : Number(amountUsd)
    if (!(amount > 0)) return { ok: false, reason: "need-usd" }
    const result = support.registerDonation({ username, platform: platformName, amount, note: noteOf({ message: row.message }) })
    if (!result.ok) return result
    db.prepare("UPDATE external_tips SET status='applied', donation_id=?, reason=NULL WHERE id=?").run(result.donation.id, row.id)
    return result
  }

  function dismiss(tipId) {
    const changed = db.prepare("UPDATE external_tips SET status='dismissed' WHERE id=? AND channel_id=? AND status='pending'").run(String(tipId || ""), activeChannel()).changes
    return changed ? { ok: true } : { ok: false, reason: "gone" }
  }

  // ── Conexion ────────────────────────────────────────────────────────────────
  function token() { return secrets.getSecret(TOKEN_SECRET) }

  async function catchUp(jwt, channel) {
    if (!fetchImpl || !channel) return
    try {
      const response = await fetchImpl(`${TIPS_API}/${encodeURIComponent(channel)}?limit=${CATCH_UP_LIMIT}`, { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" } })
      if (!response.ok) { log.error(`[streamelements] repaso de propinas: HTTP ${response.status}`); return }
      const body = await response.json()
      const list = Array.isArray(body) ? body : Array.isArray(body.docs) ? body.docs : []
      list.slice().reverse().forEach(handleTip)
    } catch (error) { log.error("[streamelements] repaso de propinas:", error.message) }
  }

  function scheduleReconnect() {
    if (stopped) return
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, reconnectMs)
    reconnectMs = Math.min(RECONNECT_MAX_MS, reconnectMs * 2)
  }

  function connect() {
    const jwt = token()
    if (stopped || !jwt) return
    const channel = channelFromToken(jwt)
    if (!channel) { setState({ connected: false, error: "El token no parece un JWT de StreamElements." }); return }
    if (!WebSocketImpl) { setState({ connected: false, error: "Este Mimiku no tiene WebSocket disponible." }); return }
    try { socket = new WebSocketImpl(ASTRO_URL) } catch (error) { setState({ connected: false, error: error.message }); scheduleReconnect(); return }
    const nonce = randomUUID()
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "subscribe", nonce, data: { topic: "channel.tips", room: channel, token: jwt, token_type: "jwt" } }))
    }
    socket.onmessage = event => {
      let message
      try { message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) } catch (error) { return }
      if (message.type === "response" && message.nonce === nonce) {
        if (message.error || (message.data && message.data.error)) {
          setState({ connected: false, error: "StreamElements rechazó el token: " + (message.error || message.data.error) })
          return
        }
        reconnectMs = RECONNECT_MIN_MS
        setState({ connected: true, error: null })
        catchUp(jwt, channel)
        return
      }
      if (message.type === "message" && message.topic === "channel.tips" && message.data) {
        const outcome = handleTip(message.data)
        if (outcome === "applied" || outcome === "pending") setState({})
      }
    }
    socket.onerror = () => { setState({ error: state.connected ? null : "No se pudo conectar con StreamElements." }) }
    socket.onclose = () => {
      socket = null
      setState({ connected: false })
      scheduleReconnect()
    }
  }

  function start() {
    stopped = false
    if (!socket && token()) connect()
  }

  function stop() {
    stopped = true
    clearTimeout(reconnectTimer)
    if (socket) { try { socket.close() } catch (error) { /* ya cerrado */ } socket = null }
    setState({ connected: false })
  }

  // Guarda (o quita) el token y reconecta. Desde ahora cuentan las propinas nuevas.
  function setToken(raw) {
    const value = String(raw || "").trim()
    stop()
    secrets.setSecret(TOKEN_SECRET, value)
    if (value) {
      if (!channelFromToken(value)) { setState({ error: "El token no parece un JWT de StreamElements." }); return status() }
      settings.set(SINCE_KEY, String(now()))
      setState({ error: null })
      start()
    } else {
      setState({ error: null })
    }
    return status()
  }

  function status() {
    return { configured: !!token(), connected: state.connected, error: state.error, lastTipAt: state.lastTipAt, pending: listPending().length }
  }

  return { start, stop, setToken, status, handleTip, listPending, assign, dismiss }
}

let defaultService = null
function getDefaultStreamElements() {
  if (!defaultService) {
    const platform = require("./local-runtime.js").getLocalPlatform()
    const db = platform.db
    defaultService = createStreamElementsTips({
      platform,
      getChannel: () => require("./currentChannel.js").get() || require("./app-config.js").getAppConfig().streamer.twitchChannel,
      support: require("./support.js").getDefaultSupport(),
      secrets: require("./secret-store.js").getDefaultSecretStore(),
      settings: {
        get: key => (db.prepare("SELECT value FROM settings WHERE key=?").get(key) || {}).value,
        set: (key, value) => db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value),
      },
    })
  }
  return defaultService
}

module.exports = { createStreamElementsTips, getDefaultStreamElements, normalizeTip, channelFromToken, ASTRO_URL }
