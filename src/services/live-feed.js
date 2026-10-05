// services/live-feed.js — "En vivo" de la pagina de canje: las ultimas
// jugadas de los minijuegos y tiradas del gachapon de todo el canal, para que
// cada viewer vea quien gano o perdio y cuanto mientras juega.
//
// Vive en memoria (un reinicio de Mimiku lo vacia): es un tablon de lo que
// acaba de pasar, no un historial. Guarda el viewer de cada evento solo para
// marcar "es tuyo"; hacia fuera salen el nombre a mostrar y el resultado.
const MAX_EVENTS = 80
const MAX_LIST = 40
const GAMES = ["plinko", "scratch", "wheel", "slots", "hilo", "mines", "blackjack", "gacha", "robar", "regalo"]
const KINDS = ["play", "steal", "rob", "rob-fail", "gift"]

function createLiveFeed({ now = Date.now } = {}) {
  const channels = new Map() // canal -> { events: [], next }
  const listeners = new Map() // nombre -> funcion; reciben cada evento tal cual llega (con viewerId), p. ej. los logros

  function channelOf(channelId) {
    const key = String(channelId || "local").toLowerCase()
    if (!channels.has(key)) channels.set(key, { events: [], next: 1 })
    return channels.get(key)
  }

  // event: { game, viewerId, who, label, net (puntos +/-), outcome ("win"|"lose"|"even"), rarity?, big? }
  // Gachapon: `stealUntil` (fin de la ventana de robo) y `shielded` (inmunidad);
  // un robo es `kind: "steal"` con `ref` = id de la tirada robada y `owner`.
  function record(channelId, event) {
    if (!event || !GAMES.includes(event.game)) return null
    const channel = channelOf(channelId)
    const stored = {
      id: channel.next++, at: now(), game: event.game, viewerId: event.viewerId || null,
      who: String(event.who || "?").slice(0, 40), label: String(event.label || "").slice(0, 80),
      net: Number.isFinite(event.net) ? Math.trunc(event.net) : 0,
      outcome: ["win", "lose", "even"].includes(event.outcome) ? event.outcome : "even",
      rarity: event.rarity || null, big: !!event.big, count: event.count || 1,
      kind: KINDS.includes(event.kind) ? event.kind : "play", ref: event.ref || null, owner: event.owner ? String(event.owner).slice(0, 40) : null, ownerId: event.ownerId || null,
      stealUntil: Number.isFinite(event.stealUntil) ? event.stealUntil : 0, shielded: !!event.shielded,
      item: event.item ? String(event.item).slice(0, 60) : null,
    }
    channel.events = [...channel.events, stored].slice(-MAX_EVENTS)
    for (const listener of listeners.values()) {
      try { listener(String(channelId || "local").toLowerCase(), event) } catch (error) { console.error("[en vivo]", error.message) }
    }
    return stored
  }

  // Eventos posteriores a `since` (los mas recientes primero si no hay `since`).
  function list(channelId, { since = 0, viewerId = null } = {}) {
    const channel = channelOf(channelId)
    const fresh = channel.events.filter(event => event.id > since).slice(-MAX_LIST)
    return {
      last: channel.next - 1,
      events: fresh.map(({ viewerId: author, ownerId, ...event }) => ({
        ...event, mine: !!viewerId && author === viewerId, ownerMine: !!viewerId && !!ownerId && ownerId === viewerId,
      })),
    }
  }

  // Volver a suscribir con el mismo nombre reemplaza al anterior (no cuenta doble).
  function subscribe(name, listener) { listeners.set(String(name), listener) }

  return { record, list, subscribe }
}

let defaultFeed = null
function getDefaultLiveFeed() {
  if (!defaultFeed) defaultFeed = createLiveFeed()
  return defaultFeed
}

module.exports = { createLiveFeed, getDefaultLiveFeed, MAX_EVENTS, GAMES }
