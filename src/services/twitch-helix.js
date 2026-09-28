// services/twitch-helix.js — llamadas de solo lectura a la API Helix de Twitch
// con el token OAuth del chat.
//
// /oauth2/validate devuelve el client_id del token; con eso Helix responde a
// consultas publicas (streams, usuarios) sin scopes extra ni Client Secret.
const REQUEST_TIMEOUT_MS = 10_000

function cleanToken(token) {
  return String(token || "").trim().replace(/^oauth:/i, "")
}

function createTwitchHelix({ getToken, fetchImpl = globalThis.fetch }) {
  let clientId = null
  let clientIdFor = null

  async function request(url, headers) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal })
      if (!response.ok) throw new Error(`Twitch respondio ${response.status}`)
      return await response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  function hasToken() {
    return Boolean(cleanToken(getToken())) && typeof fetchImpl === "function"
  }

  // `pathAndQuery`: por ejemplo "streams?user_login=canal". Lanza si falla.
  async function get(pathAndQuery) {
    const token = cleanToken(getToken())
    if (!token || typeof fetchImpl !== "function") throw new Error("Sin token de Twitch")
    try {
      if (clientIdFor !== token) {
        const info = await request("https://id.twitch.tv/oauth2/validate", { Authorization: `OAuth ${token}` })
        clientId = info.client_id
        clientIdFor = token
      }
      return await request(`https://api.twitch.tv/helix/${pathAndQuery}`, { Authorization: `Bearer ${token}`, "Client-Id": clientId })
    } catch (error) {
      // Un token caducado o cambiado obliga a validar de nuevo.
      clientIdFor = null
      throw error
    }
  }

  return { get, hasToken }
}

let defaultHelix = null
function getDefaultTwitchHelix() {
  if (!defaultHelix) {
    defaultHelix = createTwitchHelix({
      getToken: () => require("./secret-store.js").getDefaultSecretStore().getTwitchToken(),
    })
  }
  return defaultHelix
}

module.exports = { createTwitchHelix, getDefaultTwitchHelix, cleanToken }
