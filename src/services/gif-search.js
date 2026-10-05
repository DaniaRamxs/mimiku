// services/gif-search.js — buscar GIFs animados de personajes en GIPHY para
// el gachapon (crear en masa y editar personaje).
//
// Hace falta una clave gratuita de GIPHY (developers.giphy.com > Create an
// App > API). Se guarda cifrada en el almacen de secretos. Los GIF no se
// descargan: el personaje guarda la direccion https de GIPHY (la pagina de
// canje y los overlays la cargan tal cual), como piden sus condiciones.
const KEY_SECRET = "giphy_api_key"
const API_URL = "https://api.giphy.com/v1/gifs/search"
const MAX_RESULTS = 12
const TIMEOUT_MS = 10_000

// Solo direcciones https de GIPHY.
function giphyUrl(value) {
  try {
    const url = new URL(String(value || ""))
    return url.protocol === "https:" && /(^|\.)giphy\.com$/i.test(url.hostname) ? url.toString() : null
  } catch {
    return null
  }
}

// Un resultado de la API -> { id, title, preview, url }. `url`: version de
// hasta ~5 MB (buena para la carta); `preview`: miniatura para elegir.
function normalizeGif(item) {
  const images = item?.images || {}
  const url = giphyUrl(images.downsized_medium?.url) || giphyUrl(images.original?.url) || giphyUrl(images.fixed_height?.url)
  const preview = giphyUrl(images.fixed_height_small?.url) || giphyUrl(images.fixed_height?.url) || url
  if (!url) return null
  return { id: String(item.id || ""), title: String(item.title || "").slice(0, 120), preview, url }
}

function createGifSearch({ secrets, fetchImpl = global.fetch }) {
  function key() { return secrets.getSecret(KEY_SECRET) || "" }

  function status() { return { configured: !!key() } }

  function setKey(value) {
    const clean = String(value || "").trim()
    if (clean && !/^[A-Za-z0-9]{20,64}$/.test(clean)) throw new Error("Esa clave no parece de GIPHY (son letras y números, sin espacios).")
    secrets.setSecret(KEY_SECRET, clean)
    return status()
  }

  async function search(query, limit = 8) {
    const apiKey = key()
    if (!apiKey) throw new Error("Falta la clave de GIPHY.")
    const q = String(query || "").trim().slice(0, 120)
    if (!q) return []
    const params = new URLSearchParams({ api_key: apiKey, q, limit: String(Math.max(1, Math.min(MAX_RESULTS, Math.trunc(limit) || 8))), rating: "pg-13", lang: "es" })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let response
    try {
      response = await fetchImpl(`${API_URL}?${params}`, { signal: controller.signal })
    } catch (error) {
      throw new Error(error.name === "AbortError" ? "GIPHY tardó demasiado en responder." : "No se pudo conectar con GIPHY.")
    } finally {
      clearTimeout(timer)
    }
    if (response.status === 401 || response.status === 403) throw new Error("GIPHY rechazó la clave. Revísala.")
    if (response.status === 429) throw new Error("GIPHY: demasiadas búsquedas seguidas. Espera un poco.")
    if (!response.ok) throw new Error(`GIPHY respondió con un error (${response.status}).`)
    const body = await response.json()
    return (Array.isArray(body?.data) ? body.data : []).map(normalizeGif).filter(Boolean)
  }

  return { status, setKey, search }
}

let defaultSearch = null
function getDefaultGifSearch() {
  if (!defaultSearch) defaultSearch = createGifSearch({ secrets: require("./secret-store.js").getDefaultSecretStore() })
  return defaultSearch
}

module.exports = { createGifSearch, getDefaultGifSearch, normalizeGif, giphyUrl }
