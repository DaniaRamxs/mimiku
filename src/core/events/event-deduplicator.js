// Deduplicación efímera de eventos normalizados.
//
// Un evento puede llegar por más de una fuente (ej.: el mismo mensaje de
// Twitch, una vez por Twitch Native y otra vez reenviado por Social Stream
// Ninja). Cada fuente puede traer su PROPIO id, en su propio namespace — el
// id de SSN para un mensaje de Twitch no es el mismo id que genera tmi.js
// para ese mismo mensaje. Por eso no basta con confiar en el id cuando existe:
// se calculan SIEMPRE dos claves por evento y se compara contra ambas.
//
//   - Clave por id (platform, id): fiable dentro de una misma fuente.
//   - Clave por huella (platform, actor, fingerprint del texto) + ventana
//     temporal: es la que atrapa el caso cruzado (misma persona, mismo
//     texto, dos fuentes distintas, ids distintos).
//
// Un evento se considera duplicado si CUALQUIERA de sus claves ya fue vista
// dentro de la ventana. Esto no genera falsos positivos entre dos mensajes
// realmente distintos del mismo usuario, porque el texto (y por lo tanto el
// fingerprint) es distinto.
const { createHash } = require("node:crypto")

function fingerprintKey(event) {
  const text = ((event.message && event.message.text) || "").trim().toLowerCase()
  const actorKey = (event.actor && (event.actor.platformUserId || event.actor.username)) || "anon"
  // Los eventos sin texto (gift, like, follow) se distinguen por su payload;
  // sin esto, dos regalos distintos del mismo usuario en 5s serían "duplicados".
  const payloadKey = event.payload ? JSON.stringify(event.payload) : ""
  const hash = createHash("sha1").update(`${event.type}:${text}:${payloadKey}`).digest("hex").slice(0, 16)
  return `fp:${event.platform}:${actorKey}:${hash}`
}

function idKey(event) {
  return event.id ? `id:${event.platform}:${event.id}` : null
}

function keysFor(event) {
  const keys = [fingerprintKey(event)]
  const byId = idKey(event)
  if (byId) keys.push(byId)
  return keys
}

// Caché acotada y efímera: cada clave expira sola tras windowMs; si se llega a
// maxEntries se descarta la entrada más antigua. Nunca se persiste en disco.
function createEventDeduplicator({ windowMs = 5000, maxEntries = 5000 } = {}) {
  const seenUntil = new Map()

  function sweep(now) {
    for (const [key, expiresAt] of seenUntil) {
      if (expiresAt <= now) seenUntil.delete(key)
      else break // Map conserva el orden de inserción y todas las entradas comparten windowMs
    }
  }

  function markSeen(key, now) {
    if (seenUntil.size >= maxEntries) {
      const oldestKey = seenUntil.keys().next().value
      seenUntil.delete(oldestKey)
    }
    seenUntil.set(key, now + windowMs)
  }

  function isDuplicate(event) {
    const now = Date.now()
    sweep(now)
    const keys = keysFor(event)
    const alreadySeen = keys.some(key => seenUntil.has(key))
    if (!alreadySeen) {
      for (const key of keys) markSeen(key, now)
    }
    return alreadySeen
  }

  return { isDuplicate, size: () => seenUntil.size }
}

module.exports = { createEventDeduplicator, fingerprintKey, idKey }
