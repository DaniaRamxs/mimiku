// Estado en memoria de la integración con Social Stream Ninja.
// No usa Supabase ni ningún backend remoto, no persiste en SQLite, y se
// reinicia con la app — es deliberadamente efímero. Mimiku no depende de
// esto para arrancar: si nunca llega nada, el estado se queda en
// "not_detected" para siempre y el resto de la app funciona igual.
const IDLE_AFTER_MS = 60 * 1000

function createSocialStreamNinjaState() {
  let lastEventAt = null
  let lastPlatform = null
  const platformsSeen = new Map() // platform -> timestamp de la última vez visto
  let received = 0
  let rejected = 0
  let lastRejectedReason = null
  // Estado del TRANSPORTE (¿hay un socket abierto a SSApp?), separado de los
  // contadores de payload arriba (¿llegaron mensajes de chat reales?). Un
  // streamer puede estar "connected" sin haber recibido chat todavía, o
  // seguir "receiving" viejo mientras el transporte ya se reconectó.
  let connection = { state: "not_connected", error: null, updatedAt: null, port: null }
  let discovery = { state: "not_detected", error: null, updatedAt: null, port: null, chatRelayEnabled: null, configured: null }

  function recordReceived(platform) {
    received++
    lastEventAt = Date.now()
    lastPlatform = platform
    platformsSeen.set(platform, lastEventAt)
  }

  function recordRejected(reason) {
    rejected++
    lastRejectedReason = reason
  }

  // state: "not_connected" | "connecting" | "connected" | "reconnecting" | "error"
  // port: puerto realmente conectado (3003 o el heredado 3000), solo para
  // poder mostrarlo en la UI — no participa en ninguna decisión.
  function setConnectionState(state, error = null, port = null) {
    connection = { state, error, updatedAt: Date.now(), port }
  }

  function setDiscoveryState(state, details = {}) {
    discovery = {
      state,
      error: details.error || null,
      updatedAt: Date.now(),
      port: details.port || null,
      chatRelayEnabled: details.chatRelayEnabled ?? null,
      configured: details.configured ?? null,
    }
  }

  function getStatus() {
    const now = Date.now()
    let status = "not_detected"
    if (lastEventAt) status = (now - lastEventAt) <= IDLE_AFTER_MS ? "receiving" : "idle"
    else if (rejected > 0) status = "error"
    return {
      status, // not_detected | receiving | idle | error (basado en payloads recibidos)
      lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
      lastPlatform,
      platforms: [...platformsSeen.keys()],
      counters: { received, rejected },
      lastRejectedReason,
      connection, // { state, error, updatedAt, port } — estado real del transporte
      discovery,
    }
  }

  return { recordReceived, recordRejected, setConnectionState, setDiscoveryState, getStatus }
}

let defaultState = null
function getDefaultSocialStreamNinjaState() {
  if (!defaultState) defaultState = createSocialStreamNinjaState()
  return defaultState
}

module.exports = { createSocialStreamNinjaState, getDefaultSocialStreamNinjaState }
