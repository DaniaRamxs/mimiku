// services/dictionary.js — diccionario español para validar palabras (Palabra Bomba)
// Descarga el lemario de dominio público (olea/lemarios) la primera vez y lo cachea local.
const fs   = require("fs")
const path = require("path")
const https = require("https")
const { app } = require("electron")

const DICT_URL = "https://raw.githubusercontent.com/olea/lemarios/master/lemario-general-del-espanol.txt"
const CACHE_DIR  = path.join(app.getPath("userData"), "arena-dict")
const DICT_FILE  = path.join(CACHE_DIR, "dict-es.txt")
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })

let wordSet = null          // Set de palabras normalizadas (sin acentos, ñ→n)
let ready = false
let loading = null

// quitar acentos y normalizar ñ→n para comparación flexible
function normalize(word) {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ñ/g, "n").toLowerCase()
}

// sílabas jugables por dificultad (generadas del análisis del lemario)
let syllables = null

function loadSyllables() {
  if (syllables) return syllables
  // intentar leer del archivo empaquetado junto al servicio
  try {
    const p = path.join(__dirname, "syllables-es.json")
    if (fs.existsSync(p)) { syllables = JSON.parse(fs.readFileSync(p, "utf8")); return syllables }
  } catch (e) {}
  // fallback mínimo si no está el archivo
  syllables = {
    facil:   ["ada","ana","ari","car","cha","ado","ida","oso","ora","est"],
    medio:   ["aba","aca","ace","ado","ela","ora","ista","ble","tra","pre"],
    dificil: ["abr","acr","act","adr","afe","ludo","xio","nvo","bru","gni"],
  }
  return syllables
}

// ── Carga del diccionario ─────────────────────────────────────────────────────
async function ensureLoaded() {
  if (ready) return true
  if (loading) return loading
  loading = doLoad()
  return loading
}

async function doLoad() {
  try {
    // si ya está cacheado, cargarlo
    if (fs.existsSync(DICT_FILE)) {
      loadFromFile()
      return true
    }
    // descargar y cachear
    await download()
    loadFromFile()
    return true
  } catch (e) {
    console.error("[dict] error:", e.message)
    return false
  }
}

function loadFromFile() {
  const raw = fs.readFileSync(DICT_FILE, "utf8")
  wordSet = new Set()
  for (const line of raw.split("\n")) {
    const w = line.trim()
    if (w) wordSet.add(w)
  }
  ready = true
  console.log("[dict] cargado:", wordSet.size, "palabras")
}

function download() {
  return new Promise((resolve, reject) => {
    console.log("[dict] descargando lemario...")
    https.get(DICT_URL, res => {
      if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return }
      let data = ""
      res.setEncoding("utf8")
      res.on("data", chunk => data += chunk)
      res.on("end", () => {
        // normalizar y filtrar
        const out = new Set()
        for (const line of data.split("\n")) {
          const w = line.trim().toLowerCase()
          if (!w || w.includes("-") || w.length < 3) continue
          const wn = normalize(w)
          if (!/^[a-z]+$/.test(wn)) continue
          out.add(wn)
        }
        fs.writeFileSync(DICT_FILE, [...out].sort().join("\n"), "utf8")
        console.log("[dict] descargado y cacheado:", out.size, "palabras")
        resolve()
      })
    }).on("error", reject)
  })
}

// ── API pública ───────────────────────────────────────────────────────────────
function isValidWord(word) {
  if (!ready || !wordSet) return null  // null = diccionario no listo (validación laxa)
  return wordSet.has(normalize(word))
}

function isReady() { return ready }

// elige una sílaba al azar según dificultad
function randomSyllable(difficulty = "medio") {
  const syl = loadSyllables()
  const pool = syl[difficulty] || syl.medio || []
  if (!pool.length) return "ar"
  return pool[Math.floor(Math.random() * pool.length)].toUpperCase()
}

module.exports = { ensureLoaded, isValidWord, isReady, randomSyllable, normalize }
