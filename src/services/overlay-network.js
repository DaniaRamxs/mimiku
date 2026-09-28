const os = require("node:os")

const PROBE_TIMEOUT_MS = 3000
const DEFAULT_HTTP_PORT = 80

// Direcciones IPv4 utilizables desde otros equipos de la red. Se descartan
// loopback (internal) y link-local (169.254.x.x, sin DHCP): no sirven en una URL.
// Node 18.0-18.3 reportaba family como número (4), de ahí la doble comprobación.
function listLanAddresses(interfaces = os.networkInterfaces()) {
  const addresses = []
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" && entry.family !== 4) continue
      if (entry.internal || entry.address.startsWith("169.254.")) continue
      addresses.push({ name, address: entry.address })
    }
  }
  return addresses
}

// El puerto 80 se omite: el validador de TikTok LIVE Studio suele aceptar mejor
// una URL sin puerto.
function formatOverlayUrl(host, port) {
  return `http://${host}${port === DEFAULT_HTTP_PORT ? "" : `:${port}`}/overlay`
}

function buildOverlayUrls(config, lanAddresses) {
  const urls = [
    { id: "localhost", label: "localhost", url: formatOverlayUrl("localhost", config.httpPort) },
    { id: "loopback", label: "127.0.0.1", url: formatOverlayUrl("127.0.0.1", config.httpPort) },
  ]
  if (config.allowLan) {
    for (const lan of lanAddresses) {
      urls.push({ id: `lan:${lan.address}`, label: `IP de red local (${lan.name})`, url: formatOverlayUrl(lan.address, config.httpPort) })
    }
  }
  if (config.customHostname) {
    urls.push({ id: "custom", label: "Hostname personalizado", url: formatOverlayUrl(config.customHostname, config.httpPort) })
  }
  return urls
}

function describeFetchError(error) {
  if (error?.name === "AbortError") return "Tiempo de espera agotado"
  const code = error?.cause?.code || error?.code
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "El nombre no resuelve (revisa el archivo hosts)"
  if (code === "ECONNREFUSED") return "Conexión rechazada"
  return error?.cause?.message || error?.message || "Error de red"
}

async function probeUrl(url, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: "no-store" })
    try { await response.body?.cancel() } catch {}
    return {
      url, ok: response.ok, status: response.status, ms: Date.now() - started,
      error: response.ok ? null : `HTTP ${response.status}`,
    }
  } catch (error) {
    return { url, ok: false, status: null, ms: Date.now() - started, error: describeFetchError(error) }
  } finally {
    clearTimeout(timer)
  }
}

function probeUrls(urls, options) {
  return Promise.all(urls.map(entry => probeUrl(entry.url, options).then(result => ({ ...result, id: entry.id }))))
}

// Convierte un fallo de listen() en un mensaje accionable para la UI.
function describeListenError(error, { host, port }) {
  const target = `${host}:${port}`
  if (error.code === "EADDRINUSE") {
    return `El puerto ${port} ya está en uso (${target}). Cierra la otra aplicación o instancia de Mimiku, o elige otro puerto.`
  }
  if (error.code === "EACCES") {
    return `Windows no permite usar el puerto ${port} (${target}). Prueba otro puerto o ejecuta Mimiku como administrador.`
  }
  return `No se pudo iniciar el servidor local en ${target}: ${error.message}`
}

module.exports = {
  listLanAddresses, formatOverlayUrl, buildOverlayUrls, probeUrl, probeUrls, describeListenError,
}
