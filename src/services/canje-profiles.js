// services/canje-profiles.js — Perfil y Comunidad en la pagina de canje.
//
// Traduce la sesion de Twitch del viewer a su identidad en Mimiku, limita
// las acciones por minuto y recuerda el resultado de cada compra (un
// reintento con la misma clave no cobra otra vez). Las reglas estan en
// viewer-profiles.js. Al pedir el perfil propio se completa la foto de
// Twitch si aun no la tenemos.
const { createViewerProfiles } = require("./viewer-profiles.js")
const { subStatus } = require("./twitch-subs.js")

const MAX_ACTIONS_PER_MINUTE = 20
const RESULTS_KEPT = 500
const KEY_PATTERN = /^[a-z0-9-]{8,64}$/i

const PROFILE_ROUTES = {
  "/api/profile/me": "GET",
  "/api/profile/equip": "POST",
  "/api/profile/buy": "POST",
  "/api/profile/showcase": "POST",
  "/api/community": "GET",
  "/api/community/home": "GET",
  "/api/community/profile": "GET",
}

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Vas muy rápido, espera un minuto.",
  insufficient: "No te alcanzan los puntos.",
  "not-for-sale": "Eso no está a la venta.",
  owned: "Ya lo tienes.",
  "not-owned": "Primero tienes que comprarlo.",
  "not-owned-card": "Solo puedes poner en la vitrina cartas que tengas.",
  unknown: "Eso no existe.",
  "bad-request": "Petición no válida. Recarga la página.",
  "bad-key": "Petición no válida. Recarga la página.",
  "no-profile": "Ese perfil no existe o todavía no usa la página.",
}

// `community`: community.js (portada y logros); opcional.
function createCanjeProfiles({ platform, getChannel, now = Date.now, fetchAvatar = null, community = null }) {
  const db = platform.db
  const channelOf = () => {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }
  const profiles = createViewerProfiles({
    platform, getChannel, now,
    isSub: viewerId => subStatus(platform, channelOf(), viewerId, now()).sub,
  })
  const recent = new Map()
  const results = new Map()

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function underLimit(twitchId) {
    const since = now() - 60_000
    const list = (recent.get(twitchId) || []).filter(time => time > since)
    if (list.length >= MAX_ACTIONS_PER_MINUTE) { recent.set(twitchId, list); return false }
    recent.set(twitchId, [...list, now()])
    return true
  }

  // Sin foto guardada: se pide a Twitch en segundo plano para la proxima vez.
  function fillAvatar(viewer) {
    if (!fetchAvatar || viewer.avatar_url) return
    fetchAvatar(viewer.username).catch(() => {})
  }

  function withViewer(twitchId, action) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    return action(viewer)
  }

  function act(twitchId, action) {
    if (!underLimit(String(twitchId))) return { ok: false, reason: "rate-limit" }
    return withViewer(twitchId, action)
  }

  return {
    me: twitchId => withViewer(twitchId, viewer => {
      fillAvatar(viewer)
      const profile = profiles.me(viewer.id)
      if (community) profile.achievements = community.achievementsOf(viewer.id, { own: true })
      return { ok: true, profile }
    }),
    equip: (twitchId, slot, id) => act(twitchId, viewer => profiles.equip(viewer.id, slot, id)),
    showcase: (twitchId, cards) => act(twitchId, viewer => profiles.setShowcase(viewer.id, cards)),
    buy(twitchId, cosmeticId, requestKey) {
      if (!KEY_PATTERN.test(String(requestKey || ""))) return { ok: false, reason: "bad-key" }
      const cacheKey = `${twitchId}:${requestKey}`
      if (results.has(cacheKey)) return results.get(cacheKey)
      const result = act(twitchId, viewer => profiles.buy(viewer.id, String(cosmeticId || "").slice(0, 60), `perfil:${twitchId}:${requestKey}`))
      if (results.size >= RESULTS_KEPT) results.delete(results.keys().next().value)
      results.set(cacheKey, result)
      return result
    },
    search: (query, page, options) => ({ ok: true, ...profiles.search(query, page, options) }),
    home: () => (community ? community.home() : { ok: true, online: { total: 0, list: [] }, highlights: [], newcomers: profiles.newcomers() }),
    profile(login) {
      const profile = profiles.publicProfile(login)
      if (profile && community) profile.achievements = community.achievementsOfLogin(login)
      return profile ? { ok: true, profile } : { ok: false, reason: "no-profile" }
    },
  }
}

// Atiende una ruta de PROFILE_ROUTES ya autenticada. Devuelve [status, json].
async function handleProfilesApi({ pathname, url, readJson, user, profiles }) {
  const reply = result => {
    if (result.ok) return [200, result]
    const status = result.reason === "rate-limit" ? 429 : result.reason === "no-profile" ? 404 : result.reason === "bad-request" || result.reason === "bad-key" ? 400 : 409
    return [status, { error: MESSAGES[result.reason] || "No se pudo completar." }]
  }
  if (pathname === "/api/profile/me") return reply(profiles.me(user.twitchId))
  if (pathname === "/api/community") {
    const sort = url.searchParams.get("sort") || "recent"
    return reply(profiles.search(url.searchParams.get("q") || "", url.searchParams.get("page") || 0, { sort, subs: url.searchParams.get("subs") === "1" }))
  }
  if (pathname === "/api/community/home") return reply(profiles.home())
  if (pathname === "/api/community/profile") {
    // `isMe`: la pagina no ensena "Robar" ni "Regalar" en tu propio perfil.
    const result = profiles.profile(url.searchParams.get("login") || "")
    if (result.ok) result.isMe = String(result.login || "").toLowerCase() === String(user.login || "").toLowerCase()
    return reply(result)
  }
  const body = await readJson()
  if (pathname === "/api/profile/equip") return reply(profiles.equip(user.twitchId, body.slot, body.id))
  if (pathname === "/api/profile/buy") return reply(profiles.buy(user.twitchId, body.id, typeof body.key === "string" ? body.key : ""))
  if (pathname === "/api/profile/showcase") return reply(profiles.showcase(user.twitchId, body.cards))
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjeProfiles, handleProfilesApi, PROFILE_ROUTES, MAX_ACTIONS_PER_MINUTE }
