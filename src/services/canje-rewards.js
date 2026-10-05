// services/canje-rewards.js — recompensas del Perfil de la pagina de canje:
// la version web de !daily (puntos cada 24 h) y de !claim (tarjeta de
// fidelidad semanal, un sello por directo). Usan exactamente las mismas
// reglas y datos que los comandos del chat, asi que da igual por donde se
// reclame: si ya lo hiciste en el chat, la web lo sabe, y al reves.
// El sello web solo se acepta mientras hay directo (como en el chat, donde
// solo se puede escribir con el directo en marcha) y tambien sale en el
// overlay de OBS.
const REWARDS_ROUTES = {
  "/api/rewards": "GET",
  "/api/rewards/daily": "POST",
  "/api/rewards/claim": "POST",
  "/api/rewards/work": "POST",
  "/api/rewards/rob": "POST",
  "/api/rewards/gift": "POST",
}
const LOGIN_PATTERN = /^[a-z0-9_]{1,25}$/

const ACTION_GAP_MS = 1500

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "rate-limit": "Espera un momento.",
  "daily-wait": "Ya reclamaste tu recompensa diaria. Vuelve más tarde.",
  disabled: "La tarjeta de fidelidad está desactivada.",
  offline: "Solo puedes sellar la tarjeta durante el directo.",
  already: "Ya sellaste tu tarjeta en este directo. Vuelve en el próximo.",
  completed: "Ya completaste tu tarjeta de esta semana. Se renueva el lunes.",
  "work-wait": "Ya trabajaste. Descansa un poco.",
  "unknown-target": "No conozco a esa persona: tiene que haber escrito en el chat.",
  "rob-denied": "No tienes permiso para robar (como con !robar en el chat).",
  rank: "No tienes permiso para robar (como con !robar en el chat).",
  cooldown: "Espera unos minutos antes de volver a robar.",
}

// `economy`: claimDaily/dailyStatus (economy.js); `loyalty`: claim/viewerStatus (loyalty.js);
// `broadcast(payload)`: overlay de OBS; `isSub(viewer)`: sub del canal (daily grande);
// `canRob(viewer)`: permisos de !robar en el panel ({ ok } o { ok: false, reason }).
function createCanjeRewards({ platform, getChannel, economy, loyalty, broadcast = () => {}, isSub = () => false, canRob = () => ({ ok: true }), now = Date.now }) {
  const lastAction = new Map()

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function viewerOf(twitchId) {
    return platform.db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function balanceOf(viewer) { return platform.economy.getBalance(activeChannel(), viewer.id).balance }

  function snapshot(viewer) {
    return {
      ok: true,
      daily: economy.dailyStatus(viewer.username, "twitch", { sub: !!isSub(viewer) }),
      work: economy.workStatus(viewer.username, "twitch"),
      rob: economy.robStatus(viewer.username, "twitch"),
      gift: economy.giftStatus(viewer.username, "twitch"),
      loyalty: loyalty.viewerStatus(viewer.id),
      points: balanceOf(viewer),
    }
  }

  function underLimit(viewer) {
    const last = lastAction.get(viewer.id) || 0
    if (now() - last < ACTION_GAP_MS) return false
    lastAction.set(viewer.id, now())
    return true
  }

  function state(twitchId) {
    const viewer = viewerOf(twitchId)
    return viewer ? snapshot(viewer) : { ok: false, reason: "unknown-viewer" }
  }

  function daily(twitchId) {
    const viewer = viewerOf(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(viewer)) return { ok: false, reason: "rate-limit" }
    const result = economy.claimDaily(viewer.username, viewer.display || viewer.username, "twitch", viewer.platform_user_id, { sub: !!isSub(viewer) })
    if (!result.ok) return { ...snapshot(viewer), ok: false, reason: "daily-wait" }
    return { ...snapshot(viewer), reward: result.points }
  }

  function claim(twitchId) {
    const viewer = viewerOf(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(viewer)) return { ok: false, reason: "rate-limit" }
    const card = loyalty.viewerStatus(viewer.id)
    if (!card.enabled) return { ok: false, reason: "disabled" }
    if (!card.live) return { ok: false, reason: "offline" }
    const result = loyalty.claim({
      platform: "twitch", platformUserId: viewer.platform_user_id, username: viewer.username,
      displayName: viewer.display || viewer.username, avatarUrl: viewer.avatar_url || null,
    })
    if (!result.ok) return { ok: false, reason: result.reason }
    try { broadcast(result.overlay) } catch (error) { /* el overlay nunca debe romper el sello */ }
    return { ...snapshot(viewer), stamped: result.filled, completed: result.completed, rewardPoints: result.rewardPoints }
  }

  function work(twitchId) {
    const viewer = viewerOf(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    if (!underLimit(viewer)) return { ok: false, reason: "rate-limit" }
    const result = economy.claimWork(viewer.username, viewer.display || viewer.username, "twitch", viewer.platform_user_id)
    if (!result.ok) return { ok: false, reason: "work-wait" }
    return { ...snapshot(viewer), reward: result.points, job: result.job }
  }

  function targetLogin(login) {
    const name = String(login || "").trim().replace(/^@/, "").toLowerCase()
    return LOGIN_PATTERN.test(name) ? name : null
  }

  // Los fallos de economia traen su propio texto (esperas, protecciones...).
  function fromEconomy(result) {
    return { ok: false, reason: result.reason || "failed", message: result.error }
  }

  function rob(twitchId, login) {
    const viewer = viewerOf(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const target = targetLogin(login)
    if (!target) return { ok: false, reason: "unknown-target" }
    if (!underLimit(viewer)) return { ok: false, reason: "rate-limit" }
    const allowed = canRob(viewer)
    if (!allowed.ok) return { ok: false, reason: allowed.reason === "cooldown" ? "cooldown" : "rob-denied" }
    const result = economy.robar(viewer.username, viewer.display || viewer.username, target, "twitch", viewer.platform_user_id)
    if (result.error) return fromEconomy(result)
    return { ...snapshot(viewer), result: result.result, stolen: result.stolen || 0, penalty: result.penalty || 0 }
  }

  function gift(twitchId, login, amount) {
    const viewer = viewerOf(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    const target = targetLogin(login)
    if (!target) return { ok: false, reason: "unknown-target" }
    if (!underLimit(viewer)) return { ok: false, reason: "rate-limit" }
    const result = economy.regalar(viewer.username, viewer.display || viewer.username, target, amount, "twitch", viewer.platform_user_id)
    if (result.error) return fromEconomy(result)
    return { ...snapshot(viewer), sent: result.sent, received: result.received, fee: result.fee }
  }

  return { state, daily, claim, work, rob, gift }
}

// Atiende una ruta de REWARDS_ROUTES ya autenticada. Devuelve [status, json].
async function handleRewardsApi({ pathname, readJson, user, rewards }) {
  const body = pathname === "/api/rewards" ? {} : await readJson()
  const routes = {
    "/api/rewards": () => rewards.state(user.twitchId),
    "/api/rewards/daily": () => rewards.daily(user.twitchId),
    "/api/rewards/claim": () => rewards.claim(user.twitchId),
    "/api/rewards/work": () => rewards.work(user.twitchId),
    "/api/rewards/rob": () => rewards.rob(user.twitchId, body.login),
    "/api/rewards/gift": () => rewards.gift(user.twitchId, body.login, body.amount),
  }
  if (!routes[pathname]) return [404, { error: "No encontrado" }]
  const result = routes[pathname]()
  if (result.ok) return [200, result]
  return [result.reason === "rate-limit" ? 429 : 409, { error: result.message || MESSAGES[result.reason] || "No se pudo.", reason: result.reason }]
}

module.exports = { createCanjeRewards, handleRewardsApi, REWARDS_ROUTES, MESSAGES }
