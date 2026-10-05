const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")

const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/gif", ".gif"], ["image/webp", ".webp"],
  ["audio/mpeg", ".mp3"], ["audio/wav", ".wav"], ["audio/ogg", ".ogg"], ["audio/mp4", ".m4a"],
  ["video/mp4", ".mp4"], ["video/webm", ".webm"],
])

function createLocalAssetStore(rootDirectory) {
  const root = path.resolve(rootDirectory)
  fs.mkdirSync(root, { recursive: true })

  async function save({ kind = "asset", name = "", mimeType = "", bytes }) {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || [])
    const normalizedMime = String(mimeType).toLowerCase().split(";")[0]
    const extension = MIME_EXTENSIONS.get(normalizedMime)
    if (!extension) throw new Error("Tipo de archivo no permitido")
    // Personajes: hasta 10 MB (los GIF animados pesan bastante).
    const maxBytes = kind === "card" ? 10 * 1024 * 1024 : 50 * 1024 * 1024
    if (!data.length || data.length > maxBytes) throw new Error("Tamaño de archivo no permitido")
    const sourceExtension = path.extname(String(name)).toLowerCase()
    if (sourceExtension && sourceExtension !== extension && !(normalizedMime === "image/jpeg" && sourceExtension === ".jpeg")) {
      throw new Error("La extensión no coincide con el tipo de archivo")
    }
    const checksum = crypto.createHash("sha256").update(data).digest("hex")
    const fileName = `${checksum}${extension}`
    const localPath = path.join(root, fileName)
    if (!fs.existsSync(localPath)) {
      const temporary = path.join(root, `${checksum}.${crypto.randomBytes(4).toString("hex")}.tmp`)
      await fs.promises.writeFile(temporary, data, { flag: "wx" })
      await fs.promises.rename(temporary, localPath)
    }
    return { id: fileName, kind, checksum, mimeType: normalizedMime, localPath, url: `/assets/${fileName}` }
  }

  async function importRemote(url, kind, fetcher = global.fetch) {
    const response = await fetcher(url)
    if (!response?.ok) throw new Error(`No se pudo descargar el asset heredado (${response?.status || "sin respuesta"})`)
    const mimeType = response.headers?.get?.("content-type") || ""
    const bytes = Buffer.from(await response.arrayBuffer())
    return save({ kind, name: new URL(url).pathname.split("/").pop() || "asset", mimeType, bytes })
  }

  function resolve(assetId) {
    const safe = path.basename(String(assetId))
    if (safe !== assetId || !/^[a-f0-9]{64}\.[a-z0-9]+$/i.test(safe)) return null
    const candidate = path.join(root, safe)
    return fs.existsSync(candidate) ? candidate : null
  }

  return { root, save, importRemote, resolve }
}

let defaultStore = null
function getLocalAssetStore() {
  if (!defaultStore) {
    const { app } = require("electron")
    defaultStore = createLocalAssetStore(path.join(app.getPath("userData"), "assets"))
  }
  return defaultStore
}

module.exports = { MIME_EXTENSIONS, createLocalAssetStore, getLocalAssetStore }
