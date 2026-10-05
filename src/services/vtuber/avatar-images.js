// services/vtuber/avatar-images.js — Foto de perfil del viewer para las
// Reacciones VTuber: URL para el overlay e imagen redonda (PNG en base64)
// para pegarla en VTube Studio. Solo dentro de Electron (usa nativeImage).
const crypto = require("node:crypto")
const { circleAvatar } = require("../../core/vtuber/avatar-mask.js")

const AVATAR_SIZE = 192
const MAX_BYTES = 3 * 1024 * 1024
const FETCH_TIMEOUT_MS = 6000
const CACHE_MAX = 200

const pngCache = new Map() // url -> { fileName, base64 }

function isHttps(url) {
  return /^https:\/\//i.test(String(url || ""))
}

// TikTok ya trae la foto en el evento; Twitch no, se pide a Helix.
async function avatarUrl(viewer) {
  if (isHttps(viewer?.avatarUrl)) return viewer.avatarUrl
  if (viewer?.platform === "twitch" && viewer.username) {
    return require("../twitch-avatars.js").getDefaultTwitchAvatars().getAvatar(viewer.username)
  }
  return null
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`la foto respondió ${response.status}`)
  if (!/^image\//i.test(response.headers.get("content-type") || "")) throw new Error("la foto no es una imagen")
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("la foto pesa demasiado")
  return bytes
}

function roundPng(bytes) {
  const { nativeImage } = require("electron")
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) throw new Error("no se pudo leer la foto")
  const square = image.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: "best" })
  const round = circleAvatar(square.toBitmap(), AVATAR_SIZE)
  return nativeImage.createFromBitmap(round, { width: AVATAR_SIZE, height: AVATAR_SIZE }).toPNG()
}

// { fileName, base64 } o null si el viewer no tiene foto o no se pudo bajar.
async function avatarImage(viewer) {
  const url = await avatarUrl(viewer)
  if (!url) return null
  if (pngCache.has(url)) return pngCache.get(url)
  try {
    const png = roundPng(await download(url))
    // VTS: 8-32 caracteres, letras, numeros y guiones, terminado en .png.
    const fileName = `mimiku-av-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 12)}.png`
    const image = { fileName, base64: png.toString("base64") }
    pngCache.set(url, image)
    if (pngCache.size > CACHE_MAX) pngCache.delete(pngCache.keys().next().value)
    return image
  } catch (error) {
    console.warn(`[reacciones] foto de ${viewer.name || viewer.username}:`, error.message)
    return null
  }
}

module.exports = { avatarUrl, avatarImage }
