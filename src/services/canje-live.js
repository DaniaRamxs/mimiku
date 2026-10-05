// services/canje-live.js — rutas "En vivo" de la pagina de canje:
// - GET /api/live: la pagina la consulta cada pocos segundos (con `since`, el
//   ultimo evento que ya tiene) mientras se ven los minijuegos o el gachapon.
// - POST /api/live/steal: el boton "Robar" del aviso de un legendario ajeno.
//   Es el mismo robo que !robarpj (misma ventana, misma inmunidad) pero sobre
//   esa tirada concreta, y con los mismos permisos (`canSteal`).
// Los datos salen del tablon en memoria de live-feed.js.
const LIVE_ROUTES = {
  "/api/live": "GET",
  "/api/live/steal": "POST",
}

const STEAL_GAP_MS = 1500

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "no-gacha": "El robo no está disponible ahora mismo.",
  "bad-event": "Ese aviso ya no es válido.",
  "rate-limit": "Espera un momento antes de volver a intentarlo.",
  disabled: "El streamer tiene desactivados los robos.",
  rank: "Solo pueden robar los VIP, moderadores y subs del canal (como con !robarpj).",
  cooldown: "Espera unos segundos antes de volver a robar.",
  gone: "Llegaste tarde: ya no se puede robar.",
  own: "No te puedes robar a ti mismo.",
  shielded: "Tiene inmunidad a robos.",
}

// `canSteal(viewer)` -> { ok } o { ok: false, reason: "disabled"|"rank"|"cooldown" }.
function createCanjeLive({ platform, getChannel, feed, gachapon = null, canSteal = () => ({ ok: true }), now = Date.now }) {
  const lastSteal = new Map()

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function viewerOf(twitchId) {
    return platform.db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function events(twitchId, since) {
    const from = Number.isSafeInteger(since) && since > 0 ? since : 0
    const viewer = viewerOf(twitchId)
    return { ok: true, now: now(), ...feed.list(activeChannel(), { since: from, viewerId: viewer ? viewer.id : null }) }
  }

  function steal(twitchId, eventId) {
    if (!gachapon) return { ok: false, reason: "no-gacha" }
    if (!Number.isSafeInteger(eventId) || eventId < 1) return { ok: false, reason: "bad-event" }
    const viewer = viewerOf(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const last = lastSteal.get(viewer.id) || 0
    if (now() - last < STEAL_GAP_MS) return { ok: false, reason: "rate-limit" }
    lastSteal.set(viewer.id, now())
    const allowed = canSteal(viewer)
    if (!allowed.ok) return allowed
    const identity = { platform: "twitch", platformUserId: viewer.platform_user_id, username: viewer.username, displayName: viewer.display || viewer.username }
    const result = gachapon.steal(identity, { feedId: eventId })
    return result.ok ? { ok: true, prize: result.prize, owner: result.owner } : result
  }

  return { events, steal }
}

// Permiso del boton "Robar": lo que diga la configuracion de !robarpj en el
// panel (activado y rangos). Los rangos salen de las insignias vistas en el
// chat (`badges`) y del sub verificado con el Pase Sub (`isSub`).
// `evaluate(command, event)`: el de command-config.js.
function createStealPermission({ evaluate, badges, isSub = () => false, command = "!robarpj" }) {
  return function canSteal(viewer) {
    const seen = badges.get(viewer.platform_user_id)
    const event = {
      platform: "twitch", id: "web-steal",
      actor: {
        platformUserId: viewer.platform_user_id, username: viewer.username, displayName: viewer.display || viewer.username,
        isModerator: seen.isModerator, isVip: seen.isVip, isSubscriber: seen.isSubscriber || isSub(viewer.id),
      },
    }
    const verdict = evaluate(command, event)
    if (verdict.allowed) return { ok: true }
    return { ok: false, reason: verdict.disabled ? "disabled" : verdict.rankDenied ? "rank" : "cooldown" }
  }
}

// Atiende una ruta de LIVE_ROUTES ya autenticada. Devuelve [status, json].
async function handleLiveApi({ pathname, url, readJson, user, live }) {
  if (pathname === "/api/live") return [200, live.events(user.twitchId, Number(url.searchParams.get("since")))]
  if (pathname === "/api/live/steal") {
    const body = await readJson()
    const result = live.steal(user.twitchId, Number(body.eventId))
    if (result.ok) return [200, result]
    return [result.reason === "rate-limit" ? 429 : 409, { error: MESSAGES[result.reason] || "No se pudo robar.", reason: result.reason }]
  }
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjeLive, createStealPermission, handleLiveApi, LIVE_ROUTES, MESSAGES }
