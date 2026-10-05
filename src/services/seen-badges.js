// services/seen-badges.js — ultimas insignias de Twitch vistas en el chat de
// cada viewer (VIP, moderador, suscriptor). La pagina de canje no recibe
// insignias: con esto puede aplicar los mismos permisos que los comandos del
// chat (por ejemplo, quien puede usar "Robar" igual que !robarpj).
// Vive en memoria y caduca a las MAX_AGE_MS sin volver a escribir.
const MAX_AGE_MS = 12 * 60 * 60 * 1000
const MAX_VIEWERS = 5000

function createSeenBadges({ now = Date.now } = {}) {
  const seen = new Map() // platformUserId de Twitch -> { isModerator, isVip, isSubscriber, at }

  function remember(event) {
    if (!event || event.platform !== "twitch" || !event.actor || !event.actor.platformUserId) return
    const key = String(event.actor.platformUserId)
    seen.delete(key)
    seen.set(key, { isModerator: event.actor.isModerator === true, isVip: event.actor.isVip === true, isSubscriber: event.actor.isSubscriber === true, at: now() })
    if (seen.size > MAX_VIEWERS) seen.delete(seen.keys().next().value)
  }

  function get(platformUserId) {
    const entry = seen.get(String(platformUserId))
    if (!entry || now() - entry.at > MAX_AGE_MS) return { isModerator: false, isVip: false, isSubscriber: false }
    return entry
  }

  return { remember, get }
}

let defaultBadges = null
function getDefaultSeenBadges() {
  if (!defaultBadges) defaultBadges = createSeenBadges()
  return defaultBadges
}

module.exports = { createSeenBadges, getDefaultSeenBadges, MAX_AGE_MS }
