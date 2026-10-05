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

// ── Reacciones VTuber ───────────────────────────────────────────────────────
async function connectedClient() {
  if (!await ensureConnected()) throw new Error("VTube Studio no está conectado")
  return getClient()
}

async function listHotkeys() { return (await connectedClient()).getHotkeys() }
async function triggerHotkey(hotkeyID) { return (await connectedClient()).triggerHotkey(hotkeyID) }
async function tintModel(color) { return (await connectedClient()).tintModel(color) }
async function moveModel(step) { return (await connectedClient()).moveModel(step) }

// La boca se inyecta ~12 veces por segundo: sin reconectar en cada llamada.
function injectParameters(values) {
  if (!isConnected()) return Promise.resolve(null)
  return getClient().injectParameters(values)
}

async function listExpressions() { return (await connectedClient()).getExpressions() }
async function createParameter(parameter) { return (await connectedClient()).createParameter(parameter) }
async function setExpression(file, active) { return (await connectedClient()).setExpression(file, active) }
async function getArtMeshes() { return (await connectedClient()).getArtMeshes() }
async function loadCustomItem(item) { return (await connectedClient()).loadCustomItem(item) }
async function pinItem(pin) { return (await connectedClient()).pinItem(pin) }
async function setPhysics(physics) { return (await connectedClient()).setPhysics(physics) }

// Al quitar accesorios no se reconecta: si VTS se cerro, ya no estan.
function unloadItems(instanceIDs) {
  if (!isConnected()) return Promise.resolve(null)
  return getClient().unloadItems(instanceIDs)
}

module.exports = {
  init, connect, isConnected,
  spinItem, spinAvatar,
  getConfig, saveConfig, discoverModels, discoverItems,
  listHotkeys, triggerHotkey, tintModel, moveModel, injectParameters,
  listExpressions, setExpression, createParameter, getArtMeshes, loadCustomItem, pinItem, unloadItems, setPhysics,
}
