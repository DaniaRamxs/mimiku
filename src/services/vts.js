// services/vts.js — integración de VTube Studio (ruletas de ítem y avatar)
const path = require("path")
const fs = require("fs")
const { app } = require("electron")
const VTSClient = require("./vts/vtsClient.cjs")

// el config vive en userData para que sea editable y persista el token
const USER_CONFIG = path.join(app.getPath("userData"), "vts-roulette-config.json")
const BASE_CONFIG = path.join(__dirname, "vts", "vts-roulette-config.json")

// copiar el config base a userData la primera vez
if (!fs.existsSync(USER_CONFIG)) {
  try {
    const base = JSON.parse(fs.readFileSync(BASE_CONFIG, "utf8"))
    base.connection.tokenPath = path.join(app.getPath("userData"), "vts-token.json")
    fs.writeFileSync(USER_CONFIG, JSON.stringify(base, null, 2))
  } catch (e) { console.error("[VTS] no se pudo crear config:", e.message) }
}

let vts = null
let _broadcast = null
let connecting = false

function init(broadcastFn) {
  _broadcast = broadcastFn
}

function getClient() {
  if (!vts) {
    vts = new VTSClient(USER_CONFIG)
    // reenviar eventos al overlay
    vts.on("itemSpinResult",   r => _broadcast && _broadcast({ type: "vts_item_spin", ...r }))
    vts.on("avatarSpinResult", r => _broadcast && _broadcast({ type: "vts_avatar_spin", ...r }))
    vts.on("itemReverted",     r => _broadcast && _broadcast({ type: "vts_item_reverted", ...r }))
    vts.on("error",  e => console.error("[VTS]", e.message))
  }
  return vts
}

async function connect() {
  if (connecting) return { ok: false, error: "ya conectando" }
  connecting = true
  try {
    const c = getClient()
    if (c.authenticated) { connecting = false; return { ok: true, already: true } }
    await c.connect()
    connecting = false
    console.log("[VTS] conectado y autenticado")
    return { ok: true }
  } catch (err) {
    connecting = false
    console.error("[VTS] no se pudo conectar:", err.message)
    return { ok: false, error: err.message }
  }
}

function isConnected() {
  return !!(vts && vts.authenticated)
}

async function ensureConnected() {
  if (isConnected()) return true
  const r = await connect()
  return r.ok
}

// ── Acciones (llamadas desde los bloques de Mimics) ─────────────────────────
async function spinItem() {
  if (!await ensureConnected()) throw new Error("VTube Studio no está conectado")
  return getClient().spinItemRoulette()
}

async function spinAvatar() {
  if (!await ensureConnected()) throw new Error("VTube Studio no está conectado")
  return getClient().spinAvatarRoulette()
}

// ── Config / discovery (para la página de ajustes) ──────────────────────────
function getConfig() {
  try { return JSON.parse(fs.readFileSync(USER_CONFIG, "utf8")) } catch (e) { return null }
}

function saveConfig(cfg) {
  fs.writeFileSync(USER_CONFIG, JSON.stringify(cfg, null, 2))
  if (vts) vts.reloadConfig()
  return true
}

async function discoverModels() {
  if (!await ensureConnected()) throw new Error("VTS no conectado")
  return getClient().refreshModelsFromVTS()
}

async function discoverItems() {
  if (!await ensureConnected()) throw new Error("VTS no conectado")
  return getClient().refreshItemsFromVTS()
}

module.exports = {
  init, connect, isConnected,
  spinItem, spinAvatar,
  getConfig, saveConfig, discoverModels, discoverItems,
}
