// Event Engine: recibe eventos normalizados de cualquier adaptador de
// plataforma (Twitch, y en el futuro Social Stream Ninja / YouTube / TikTok),
// deduplica, y distribuye a los consumidores suscritos por tipo de evento.
// No conoce tmi.js, Twitch, SSN ni ninguna plataforma concreta.
const { normalizeEvent } = require("./event-normalizer.js")
const { createEventDeduplicator } = require("./event-deduplicator.js")

function createEventEngine({ dedupWindowMs, maxLogSize = 200, onError } = {}) {
  const subscribers = new Map()
  const deduplicator = createEventDeduplicator({ windowMs: dedupWindowMs })
  const recentEvents = []
  const reportError = onError || ((error, event) => {
    console.error(`[event-engine] error en consumidor de "${event.type}":`, error.message)
  })

  function subscribe(type, handler) {
    if (typeof handler !== "function") throw new Error("El handler debe ser una función")
    if (!subscribers.has(type)) subscribers.set(type, new Set())
    subscribers.get(type).add(handler)
    return () => subscribers.get(type)?.delete(handler)
  }

  function emit(rawEvent) {
    const event = normalizeEvent(rawEvent)
    if (deduplicator.isDuplicate(event)) {
      return { delivered: false, duplicate: true, handled: 0, event }
    }

    recentEvents.push(event)
    if (recentEvents.length > maxLogSize) recentEvents.shift()

    const handlers = subscribers.get(event.type)
    let handled = 0
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event)
          if (result && typeof result.then === "function") {
            result.catch(error => reportError(error, event))
          }
          handled++
        } catch (error) {
          reportError(error, event)
        }
      }
    }
    return { delivered: true, duplicate: false, handled, event }
  }

  function getRecentEvents(limit = 50) {
    return recentEvents.slice(-limit)
  }

  return { subscribe, emit, getRecentEvents }
}

let defaultEngine = null
function getDefaultEventEngine() {
  if (!defaultEngine) defaultEngine = createEventEngine()
  return defaultEngine
}

module.exports = { createEventEngine, getDefaultEventEngine }
