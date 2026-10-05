// core/card-bulk.js — reglas de "Crear muchos personajes a la vez" (pagina
// Gachapon): nombre a partir del archivo, rareza a partir de la carpeta o de
// un prefijo del nombre, y la lista pegada (una linea por personaje).
const RARITIES = ["comun", "raro", "epico", "legendario"]
const RARITY_WORDS = {
  comun: "comun", común: "comun", comunes: "comun", common: "comun",
  raro: "raro", raros: "raro", rara: "raro", raras: "raro", rare: "raro",
  epico: "epico", épico: "epico", epicos: "epico", épicos: "epico", epica: "epico", épica: "epico", epic: "epico",
  legendario: "legendario", legendarios: "legendario", legendaria: "legendario", legendary: "legendario", leg: "legendario",
}
const NAME_MAX = 120
const DESC_MAX = 1000
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i

function rarityWord(word) {
  return RARITY_WORDS[String(word || "").trim().toLowerCase()] || null
}

// "monstruos/Legendarios/dragon_rojo.png" -> "legendario" (la carpeta mas cercana manda).
// Si no hay carpeta, vale un prefijo del archivo: "epico_hada.png", "raro - gato.png".
function rarityFromPath(path) {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean)
  const file = parts.pop() || ""
  for (let i = parts.length - 1; i >= 0; i--) {
    const found = rarityWord(parts[i])
    if (found) return found
  }
  const prefix = file.match(/^([^\s_\-.]+)[\s_\-.]+/)
  return prefix ? rarityWord(prefix[1]) : null
}

// "epico_hada-del-bosque.png" -> "Hada del bosque".
function nameFromFile(path) {
  const file = String(path || "").split(/[\\/]/).pop() || ""
  let base = file.replace(/\.[a-z0-9]{2,5}$/i, "")
  const prefix = base.match(/^([^\s_\-.]+)[\s_\-.]+(.+)$/)
  if (prefix && rarityWord(prefix[1])) base = prefix[2]
  const clean = base.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim()
  if (!clean) return ""
  return (clean[0].toUpperCase() + clean.slice(1)).slice(0, NAME_MAX)
}

function isImageFile(name) { return IMAGE_EXT.test(String(name || "")) }

// Lista pegada: "Nombre", "Nombre, rareza" o "Nombre, rareza, descripcion"
// (tambien con ; | o tabuladores, para pegar desde una hoja de calculo).
// Las lineas vacias y las que empiezan por # se ignoran.
function parseList(text, fallbackRarity = "comun") {
  const rows = []
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const cells = line.split(/\s*[,;|\t]\s*/)
    const name = (cells[0] || "").trim().slice(0, NAME_MAX)
    if (!name) continue
    const rarity = rarityWord(cells[1])
    const description = (rarity ? cells.slice(2) : cells.slice(1)).join(", ").trim().slice(0, DESC_MAX)
    rows.push({ name, rarity: rarity || fallbackRarity, description })
  }
  return rows
}

// Clave para detectar repetidos (sin mayusculas, tildes ni espacios de mas).
function nameKey(name) {
  return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

// Nombres que seguramente son el mismo personaje: iguales, o todas las
// palabras de uno estan en el otro ("Luffy" y "Monkey D. Luffy"). Las de
// menos de 4 letras no cuentan solas.
function words(name) { return nameKey(name).split(/[^a-z0-9]+/).filter(Boolean) }
function similarName(a, b) {
  const ka = nameKey(a)
  const kb = nameKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const wa = words(a)
  const wb = words(b)
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (!short.length || short.join("").length < 4) return false
  const set = new Set(long)
  return short.every(word => set.has(word))
}

// Huella de una imagen para detectar el mismo GIF en dos personajes:
// GIPHY por el id del GIF (cambia la version, no el id); las subidas a
// Mimiku por su sha256 (va en el nombre del archivo); el resto, la URL.
function imageKey(url) {
  const value = String(url || "").trim()
  if (!value) return ""
  try {
    const parsed = new URL(value)
    if (/(^|\.)giphy\.com$/i.test(parsed.hostname)) {
      const media = parsed.pathname.match(/\/media\/(?:v\d+\.[^/]+\/)?([A-Za-z0-9]+)\//)
      if (media) return "giphy:" + media[1]
    }
    const asset = parsed.pathname.match(/\/assets\/([a-f0-9]{64})\./i)
    if (asset) return "sha:" + asset[1].toLowerCase()
    return parsed.origin + parsed.pathname
  } catch {
    return value
  }
}

module.exports = { RARITIES, rarityWord, rarityFromPath, nameFromFile, isImageFile, parseList, nameKey, similarName, imageKey, NAME_MAX }
