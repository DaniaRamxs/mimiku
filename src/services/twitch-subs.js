// services/twitch-subs.js — saber si un viewer es sub del canal de Twitch.
//
// Al entrar en la pagina de canje, el viewer da permiso de leer sus
// suscripciones (scope user:read:subscriptions) y aqui se pregunta a Twitch
// (Helix "Check User Subscription") con SU token, que no se guarda. El
// resultado vale VALID_MS; despues la pagina pide volver a verificar.
// El streamer cuenta siempre como sub de su propio canal.
const VALID_MS = 7 * 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000
const HELIX = "https://api.twitch.tv/helix"
const TIER_LABELS = { 1000: "Tier 1", 2000: "Tier 2", 3000: "Tier 3", streamer: "Streamer" }

function channelOf(getChannel) {
  const value = getChannel()
  return value && String(value).trim() ? String(value).toLowerCase() : "local"
}

// Sub comprobado y vigente (sin llamar a Twitch). Lo usan el pase, la tienda...
function subStatus(platform, channelId, viewerId, nowMs = Date.now()) {
  const row = platform.db.prepare("SELECT tier, verified_at, valid_until FROM viewer_twitch_subs WHERE channel_id=? AND viewer_id=?")
    .get(channelId, viewerId)
  if (!row) return { sub: false, tier: null, verifiedAt: null, validUntil: null }
  const active = Date.parse(row.valid_until) > nowMs
  return { sub: active, tier: row.tier, tierLabel: TIER_LABELS[row.tier] || "Sub", verifiedAt: row.verified_at, validUntil: row.valid_until, expired: !active }
}

function createTwitchSubs({ platform, getChannel, getClientId, getBroadcasterLogin, fetchImpl = globalThis.fetch, now = Date.now, log = console }) {
  const db = platform.db
  const broadcasterIds = new Map() // login -> id

  async function helix(path, token) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetchImpl(`${HELIX}${path}`, {
        headers: { Authorization: `Bearer ${token}`, "Client-Id": String(getClientId() || "") },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async function broadcasterId(token) {
    const login = String(getBroadcasterLogin() || "").trim().toLowerCase()
    if (!login) return null
    if (broadcasterIds.has(login)) return broadcasterIds.get(login)
    const response = await helix(`/users?login=${encodeURIComponent(login)}`, token)
    if (!response.ok) return null
    const body = await response.json()
    const id = body && body.data && body.data[0] ? String(body.data[0].id) : null
    if (id) broadcasterIds.set(login, id)
    return id
  }

  function store(viewerId, tier) {
    const time = now()
    db.prepare(`INSERT INTO viewer_twitch_subs(channel_id, viewer_id, tier, verified_at, valid_until) VALUES(?,?,?,?,?)
      ON CONFLICT(channel_id, viewer_id) DO UPDATE SET tier=excluded.tier, verified_at=excluded.verified_at, valid_until=excluded.valid_until`)
      .run(channelOf(getChannel), viewerId, tier, new Date(time).toISOString(), new Date(time + VALID_MS).toISOString())
  }

  function forget(viewerId) {
    db.prepare("DELETE FROM viewer_twitch_subs WHERE channel_id=? AND viewer_id=?").run(channelOf(getChannel), viewerId)
  }

  // Comprueba con Twitch si `twitchUser` ({ twitchId }) es sub y lo guarda.
  // { checked: false } si no se pudo saber (falta el permiso, Twitch no responde...).
  async function verify(token, twitchUser) {
    const viewer = db.prepare("SELECT id FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchUser.twitchId))
    if (!viewer) return { checked: false, reason: "unknown-viewer" }
    try {
      const channelUserId = await broadcasterId(token)
      if (!channelUserId) return { checked: false, reason: "no-channel" }
      if (channelUserId === String(twitchUser.twitchId)) { store(viewer.id, "streamer"); return { checked: true, sub: true, tier: "streamer" } }
      const response = await helix(`/subscriptions/user?broadcaster_id=${channelUserId}&user_id=${encodeURIComponent(twitchUser.twitchId)}`, token)
      if (response.status === 404) { forget(viewer.id); return { checked: true, sub: false } }
      if (!response.ok) return { checked: false, reason: response.status === 401 || response.status === 403 ? "no-scope" : "twitch-error" }
      const body = await response.json()
      const tier = body && body.data && body.data[0] ? String(body.data[0].tier) : "1000"
      store(viewer.id, tier)
      return { checked: true, sub: true, tier }
    } catch (error) {
      log.error("[subs] no se pudo comprobar la suscripcion:", error.message)
      return { checked: false, reason: "twitch-error" }
    }
  }

  return { verify, status: viewerId => subStatus(platform, channelOf(getChannel), viewerId, now()) }
}

module.exports = { createTwitchSubs, subStatus, VALID_MS, TIER_LABELS }
