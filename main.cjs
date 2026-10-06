const path = require("node:path")
const { app, BrowserWindow, ipcMain, dialog } = require("electron")
const appConfig = require("./src/services/app-config.js")
const validate = require("./src/core/ipc-validation.js")

let win
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on("second-instance", () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

function db()      { return require("./src/services/db.js") }
function economy() { return require("./src/services/economy.js") }
function twitch()  { return require("./src/services/twitch.js") }
function mods()    { return require("./src/services/mods.js") }
function overlay() { return require("./src/services/overlay-server.js") }
function ch()      { return require("./src/services/currentChannel.js") }
function games()   { return require("./src/services/games.js") }
function widgets() { return require("./src/services/widgets.js") }
function tiktokAdapter() { return require("./src/integrations/tiktok/tiktok-adapter.js").getDefaultTikTokAdapter() }
function ranks() { return require("./src/services/ranks.js").getDefaultRankService() }
function roulette() { return require("./src/services/roulette.js").getDefaultRouletteService() }
function boxes() { return require("./src/services/boxes.js").getDefaultBoxService() }
function gifts() { return require("./src/services/gifts.js").getDefaultGiftService() }
function secrets() { return require("./src/services/secret-store.js").getDefaultSecretStore() }
function backups() { return require("./src/services/backups.js").getDefaultBackupService() }
function diagnostics() { return require("./src/services/diagnostics.js").getDefaultDiagnosticsService() }

function activeWorkspaceId() {
  return appConfig.ensureWorkspace().id
}

// Reconecta TikTok al arrancar solo si el streamer lo dejó conectado la última vez.
function autoStartTikTok() {
  const tiktok = appConfig.getAppConfig().integrations.tiktok
  if (!tiktok.enabled || !tiktok.username) return
  tiktokAdapter().connect(tiktok.username, { autoReconnect: tiktok.autoReconnect, sendReplies: tiktok.sendReplies }).catch(() => {})
}

function initializeLocalRuntime(channelId) {
  const evtSay = msg => { try { require("./src/services/twitch.js").say(msg) } catch {} }
  const broadcast = payload => overlay().broadcast(payload)
  require("./src/services/events.js").init(channelId, evtSay, broadcast)
  require("./src/services/shopRealtime.js").init(channelId, broadcast)
  require("./src/services/mimics.js").init(channelId, broadcast)
  require("./src/services/levels.js").init(channelId, broadcast)
  require("./src/services/afk.js").init(channelId, broadcast, evtSay)
  require("./src/services/vts.js").init(broadcast)
  require("./src/services/widgets.js").init(channelId, broadcast)
  try { require("./src/services/dictionary.js").ensureLoaded() } catch {}
  autoStartTikTok()
  mods().registerChannel(channelId, appConfig.getAppConfig().workspace.name || channelId)

  mods().subscribeToOverlay(channelId, cmd => {
    if (cmd.type === "widget_remove") {
      overlay().broadcast({ type: "widget_remove", widget_id: cmd.payload.widget_id || cmd.widget_id })
    } else if (cmd.type === "alert") {
      overlay().broadcast({ type: "alert", text: cmd.payload.content, duration: cmd.payload.duration || 4000 })
    } else if (cmd.type === "widget_move") {
      overlay().broadcast({ type: "widget_move", widget_id: cmd.widget_id, x: cmd.payload.x, y: cmd.payload.y })
    } else if (cmd.type === "widget_resize") {
      overlay().broadcast({ type: "widget_resize", widget_id: cmd.widget_id, w: cmd.payload.w, h: cmd.payload.h })
    } else {
      overlay().broadcast({
        type: "widget_add", widget_id: cmd.widget_id,
        mod_username: cmd.mod_username, mod_display: cmd.mod_display,
        content_type: cmd.type, content: cmd.payload.content,
        x: cmd.payload.x || 50, y: cmd.payload.y || 50,
        w: cmd.payload.w || 480, h: cmd.payload.h || 300,
      })
    }
    if (win && !win.isDestroyed()) win.webContents.send("mods:command", cmd)
  })

  mods().subscribeToWidgets(channelId, (widget, eventType) => {
    if (!widget.visible) {
      overlay().broadcast({ type: "widget_remove", widget_id: widget.id })
    } else if (eventType === "INSERT") {
      overlay().broadcast({
        type: "widget_add", widget_id: widget.id,
        mod_username: widget.mod_username, mod_display: widget.mod_display,
        content_type: widget.type, content: widget.content,
        x: widget.x, y: widget.y, w: widget.w, h: widget.h,
      })
    } else {
      overlay().broadcast({ type: "widget_move", widget_id: widget.id, x: widget.x, y: widget.y })
      overlay().broadcast({ type: "widget_resize", widget_id: widget.id, w: widget.w, h: widget.h })
    }
  })

  mods().loadWidgets(channelId).then(savedWidgets => {
    savedWidgets.forEach(widget => overlay().broadcast({
      type: "widget_add", widget_id: widget.id,
      mod_username: widget.mod_username, mod_display: widget.mod_display,
      content_type: widget.type, content: widget.content,
      x: widget.x, y: widget.y, w: widget.w, h: widget.h,
    }))
  })
}

ipcMain.handle("app:minimize", () => win?.minimize())
ipcMain.handle("app:maximize", () => win?.isMaximized() ? win.unmaximize() : win?.maximize())
ipcMain.handle("app:quit",     () => app.quit())
ipcMain.handle("app:getVersion", () => app.getVersion())
ipcMain.handle("overlay:send", (_, payload) => overlay().broadcast(payload))
ipcMain.handle("overlay:getStatus", () => ({ ...overlay().getStatus(), baseUrl: overlay().getBaseUrl() }))

// Estado, configuración y URLs utilizables del overlay (panel de diagnóstico de Ajustes).
function overlayDiagnostics() {
  const network = require("./src/services/overlay-network.js")
  const config = appConfig.getAppConfig().overlay
  return {
    status: overlay().getStatus(),
    config,
    urls: network.buildOverlayUrls(config, network.listLanAddresses()),
  }
}
ipcMain.handle("overlay:getDiagnostics", () => overlayDiagnostics())
// Reinicia el servidor con el puerto/interfaz nuevos y solo persiste si arrancó;
// si no, la configuración anterior sigue activa y se devuelve el motivo.
ipcMain.handle("overlay:saveConfig", async (_, input) => {
  const config = validate.overlayConfig(input)
  const result = await overlay().reconfigure(config)
  if (!result.ok) return { ok: false, error: result.error, ...overlayDiagnostics() }
  appConfig.saveAppConfig({ overlay: config })
  return { ok: true, ...overlayDiagnostics() }
})
ipcMain.handle("overlay:probeUrls", () => {
  const network = require("./src/services/overlay-network.js")
  return network.probeUrls(overlayDiagnostics().urls)
})
ipcMain.handle("activity:getActiveViewers", () => require("./src/core/interactions/activity-consumer.js").getDefaultActivityTracker().getActiveViewerIdentities())
ipcMain.handle("assets:save", async (_, asset) => {
  const bytes = Buffer.from(asset?.bytes || [])
  return require("./src/services/local-assets.js").getLocalAssetStore().save({
    kind: asset?.kind, name: asset?.name, mimeType: asset?.mimeType, bytes,
  })
})
ipcMain.handle("config:get", () => appConfig.getPublicAppConfig())
ipcMain.handle("config:getPublic", () => appConfig.getPublicAppConfig())
ipcMain.handle("config:save", (_, updates) => {
  appConfig.saveAppConfig(validate.configUpdates(updates))
  return appConfig.getPublicAppConfig()
})
ipcMain.handle("secrets:twitchStatus", () => secrets().getTwitchStatus())
ipcMain.handle("secrets:setTwitchToken", (_, token) => secrets().setTwitchToken(validate.text(token, { max: 4096 })))

ipcMain.handle("twitch:connect", (_, input = {}) => {
  const channel = validate.twitchChannel(input.channel)
  const suppliedToken = validate.text(input.token, { max: 4096 })
  if (suppliedToken) secrets().setTwitchToken(suppliedToken)
  twitch().setWindow(win)
  twitch().setBroadcast(payload => overlay().broadcast(payload))
  twitch().connect(channel, suppliedToken || secrets().getTwitchToken())
  overlay().broadcast({ type: "set_channel", channel: activeWorkspaceId() })
})

ipcMain.handle("twitch:disconnect", () => twitch().disconnect())
ipcMain.handle("twitch:redemptionsStatus", () => twitch().getRedemptionsStatus())

ipcMain.handle("legacy:import", async () => {
  if (!appConfig.isLegacySupabaseConfigured()) {
    throw new Error("Configura y habilita primero el puente heredado de Supabase")
  }
  return require("./src/services/legacy-importer.js").importFromConfiguredSupabase()
})

// ── IPC: Social Stream Ninja (fuente opcional, solo lectura) ────────────────
function ssnTransport() { return require("./src/integrations/social-stream-ninja/social-stream-ninja-transport.js").getDefaultSocialStreamNinjaTransport() }
function discoverSsnConfig() { return require("./src/integrations/social-stream-ninja/social-stream-ninja-discovery.js").discoverSocialStreamNinjaConfig() }

ipcMain.handle("ssn:getStatus", () => {
  const localApi = require("./src/services/local-api.js")
  const state = require("./src/integrations/social-stream-ninja/social-stream-ninja-state.js").getDefaultSocialStreamNinjaState()
  const token = appConfig.getSocialStreamNinjaToken()
  return {
    ...state.getStatus(),
    postUrl: `${overlay().getBaseUrl()}${localApi.SSN_PATH_PREFIX}${token}`,
  }
})

ipcMain.handle("ssn:detect", async () => {
  const state = require("./src/integrations/social-stream-ninja/social-stream-ninja-state.js").getDefaultSocialStreamNinjaState()
  state.setDiscoveryState("detecting")
  const config = discoverSsnConfig()
  ssnTransport().setPorts([config.port, 3003, 3000])
  const result = await ssnTransport().detect()
  state.setDiscoveryState(result.detected ? "detected" : "not_detected", {
    port: result.port,
    chatRelayEnabled: config.chatRelayEnabled,
    configured: config.found,
    error: result.detected ? null : "El servicio no respondió como el relay local de Social Stream Ninja.",
  })
  return { ...result, configured: config.found, chatRelayEnabled: config.chatRelayEnabled }
})

// Modo recomendado: WebSocket local a la app de escritorio de Social Stream
// Ninja — sin postserver, sin Dock, sin construir URLs. Ver
// docs/social-stream-ninja-integration.md.
ipcMain.handle("ssn:connect", () => {
  const discovered = discoverSsnConfig()
  ssnTransport().setPorts([discovered.port, 3003, 3000])
  const saved = appConfig.getAppConfig().integrations.socialStreamNinja.sessionId
  const roomId = discovered.roomId || saved
  if (!roomId) throw new Error("No se pudo descubrir la sala activa de Social Stream Ninja.")
  appConfig.saveAppConfig({ integrations: { socialStreamNinja: { enabled: true, sessionId: roomId } } })
  return ssnTransport().connect(roomId)
})

ipcMain.handle("ssn:disconnect", () => {
  appConfig.saveAppConfig({ integrations: { socialStreamNinja: { enabled: false } } })
  return ssnTransport().disconnect()
})



// ── IPC: TikTok LIVE (fuente no oficial, ver tiktok-adapter.js) ──────────────
ipcMain.handle("tiktok:getStatus", () => tiktokAdapter().getStatus())
ipcMain.handle("tiktok:connect", (_, input = {}) => {
  const username = validate.text(input.username, { name: "usuario", max: 40, required: true })
  const autoReconnect = input.autoReconnect !== false
  const sendReplies = input.sendReplies === true
  appConfig.saveAppConfig({ integrations: { tiktok: { enabled: true, username, autoReconnect, sendReplies } } })
  const saved = appConfig.getAppConfig().integrations.tiktok
  tiktokAdapter().connect(saved.username, { autoReconnect: saved.autoReconnect, sendReplies: saved.sendReplies }).catch(() => {})
  return tiktokAdapter().getStatus()
})

// Credenciales para responder en el chat de TikTok. Nunca se devuelven al
// renderer: solo el estado (configurado / protegido / que falta).
ipcMain.handle("tiktok:secretsStatus", () => secrets().getTikTokStatus())
ipcMain.handle("tiktok:setSecrets", (_, input = {}) => {
  const status = secrets().setTikTokCredentials({
    signApiKey: validate.text(input.signApiKey, { max: 4096 }),
    sessionId: validate.text(input.sessionId, { max: 4096 }),
    ttTargetIdc: validate.text(input.ttTargetIdc, { max: 200 }),
  })
  // Las credenciales se leen al conectar: si ya hay conexion activa con las
  // respuestas habilitadas, se reconecta para que surtan efecto (el boton
  // Conectar esta oculto mientras se esta conectado).
  const saved = appConfig.getAppConfig().integrations.tiktok
  const active = ["connecting", "connected", "reconnecting"].includes(tiktokAdapter().getStatus().state)
  if (status.configured && saved.enabled && saved.username && saved.sendReplies && active) {
    tiktokAdapter().connect(saved.username, { autoReconnect: saved.autoReconnect, sendReplies: true }).catch(() => {})
  }
  return status
})
ipcMain.handle("tiktok:clearSecrets", () => secrets().clearTikTokCredentials())
ipcMain.handle("tiktok:disconnect", () => {
  appConfig.saveAppConfig({ integrations: { tiktok: { enabled: false } } })
  tiktokAdapter().disconnect()
  return tiktokAdapter().getStatus()
})

// ── IPC: conversión y reglas de regalos ─────────────────────────────────────
ipcMain.handle("gifts:listRates", () => gifts().listRates())
ipcMain.handle("gifts:setRate", (_, input = {}) => gifts().setRate({
  platform: validate.text(input.platform, { max: 30 }),
  giftId: validate.text(input.giftId, { max: 100 }) || "*",
  pointsPerCoin: Number(input.pointsPerCoin),
}))
ipcMain.handle("gifts:removeRate", (_, input = {}) => gifts().removeRate({
  platform: validate.text(input.platform, { max: 30 }),
  giftId: validate.text(input.giftId, { max: 100 }),
}))
ipcMain.handle("gifts:listRules", () => gifts().listRules())
ipcMain.handle("gifts:addRule", (_, input = {}) => gifts().addRule({
  platform: validate.text(input.platform, { max: 30 }) || "tiktok",
  giftId: validate.text(input.giftId, { max: 100 }) || "*",
  minCount: Number(input.minCount) || 1,
  mimicId: validate.text(input.mimicId, { name: "Mimic", max: 100, required: true }),
}))
ipcMain.handle("gifts:setRuleEnabled", (_, input = {}) => gifts().setRuleEnabled(validate.text(input.id, { max: 100 }), input.enabled === true))
ipcMain.handle("gifts:removeRule", (_, id) => gifts().removeRule(validate.text(id, { max: 100 })))

// ── IPC: rangos (superfan) y overrides manuales ──────────────────────────────
ipcMain.handle("ranks:getConfig", () => ranks().getConfig())
ipcMain.handle("ranks:setThreshold", (_, input = {}) => ranks().setSuperfanThreshold(
  validate.text(input.platform, { max: 30 }),
  validate.integer(input.coins, { name: "umbral", min: 0, max: 1000000000 }),
))
ipcMain.handle("ranks:listOverrides", () => ranks().listOverrides())
ipcMain.handle("ranks:addOverride", (_, input = {}) => ranks().addOverride({
  platform: validate.text(input.platform, { max: 30 }),
  username: validate.text(input.username, { name: "usuario", max: 80, required: true }),
  rank: validate.text(input.rank, { max: 20 }) || "superfan",
  effect: validate.text(input.effect, { max: 10 }) || "grant",
  expiresAt: validate.text(input.expiresAt, { max: 40 }),
  reason: validate.text(input.reason, { max: 500 }),
  grantedBy: appConfig.getAppConfig().streamer.displayName || "streamer",
}))
ipcMain.handle("ranks:removeOverride", (_, id) => ranks().removeOverride(validate.text(id, { max: 100 })))

// ── IPC: ruleta de cofres ───────────────────────────────────────────────────
ipcMain.handle("roulette:getConfig", () => roulette().getConfig())
ipcMain.handle("roulette:setConfig", (_, input = {}) => roulette().setConfig(validate.plainObject(input, "configuración de ruleta")))
// Vista previa: dibuja la ruleta en el overlay sin dar cofres ni gastar cooldown.
ipcMain.handle("roulette:preview", () => {
  const payload = roulette().preview()
  overlay().broadcast(payload)
  return payload
})

// ── IPC: tarjeta de fidelidad (!claim) ───────────────────────────────────────
function loyalty() { return require("./src/services/loyalty.js").getDefaultLoyaltyService() }
ipcMain.handle("loyalty:getConfig", () => loyalty().getConfig())
ipcMain.handle("loyalty:setConfig", (_, input = {}) => loyalty().setConfig(validate.plainObject(input, "configuración de la tarjeta")))
ipcMain.handle("loyalty:status", () => loyalty().status())
ipcMain.handle("loyalty:newStream", () => { loyalty().startNewStream(); return loyalty().status() })
ipcMain.handle("loyalty:setDelivered", (_, id, delivered) => loyalty().setDelivered(validate.text(id, { max: 100, required: true }), delivered === true))
// Vista previa: muestra una tarjeta de ejemplo sin sellar nada.
ipcMain.handle("loyalty:preview", (_, completed) => {
  const payload = loyalty().preview({ completed: completed === true })
  overlay().broadcast(payload)
  return payload
})

// ── IPC: avatares flotantes (!estado, Overlay 2) ─────────────────────────────
// Prueba: tres avatares de ejemplo rebotando, sin pasar por el chat.
ipcMain.handle("floatAvatars:test", () => {
  const demo = [["demo:1", "LunaGamer", "comiendo", "#ff4df0"], ["demo:2", "SolecitoXD", "haciendo la tarea", "#22d3ee"], ["demo:3", "KaiserDelChat", "viendo el stream desde el bus", "#a3e635"]]
  for (const [key, name, status, color] of demo) overlay().broadcast({ type: "float_avatar", key, name, status, color, avatar: null })
  return { ok: true }
})

// ── IPC: carcel (!carcel, Overlay 2) ─────────────────────────────────────────
// Prueba: encierra a un preso de ejemplo sin pasar por el chat ni gastar celdas reales.
ipcMain.handle("jail:test", () => {
  const config = widgets().getJailConfig()
  overlay().broadcast({
    type: "jail_add", key: `jail:demo:${Date.now()}`, target: "ViewerDemo", avatar: null, jailer: "SubDemo",
    durationMs: 15000, serverNow: Date.now(), until: Date.now() + 15000,
    durationText: require("./src/services/jail.js").formatDuration(config.duration_s),
  })
  return { ok: true }
})
ipcMain.handle("jail:releaseAll", () => { require("./src/services/jail.js").getDefaultJail().releaseAll(); return { ok: true } })

// ── IPC: gachapon (!gachapon, Overlay 3) ─────────────────────────────────────
const gachapon = () => require("./src/services/gachapon.js").getDefaultGachapon()
ipcMain.handle("gachapon:test", () => gachapon().demo())
ipcMain.handle("gachapon:getConfig", () => gachapon().getConfig())
ipcMain.handle("gachapon:setConfig", (_, input) => gachapon().setConfig(input))
// Comision del mercado del gachapon (pagina de canje)
const gachaMarket = () => require("./src/services/gacha-market.js").createGachaMarket({
  platform: require("./src/services/local-runtime.js").getLocalPlatform(),
  getChannel: () => require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel,
})
ipcMain.handle("gachaMarket:getConfig", () => gachaMarket().getConfig())
ipcMain.handle("gachaMarket:setConfig", (_, input) => gachaMarket().setConfig(input))
// Precio del Plinko (minijuego de la pagina de canje)
const plinko = () => require("./src/services/plinko.js").createPlinko({
  platform: require("./src/services/local-runtime.js").getLocalPlatform(),
  getChannel: () => require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel,
})
ipcMain.handle("plinko:getConfig", () => plinko().getConfig())
ipcMain.handle("plinko:setConfig", (_, input) => plinko().setConfig(input))
// Precios de los demas minijuegos de la pagina de canje
const minigamesConfig = () => require("./src/services/minigames.js").createMinigames({
  platform: require("./src/services/local-runtime.js").getLocalPlatform(),
  getChannel: () => require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel,
})
ipcMain.handle("minigames:getConfig", () => minigamesConfig().getConfig())
ipcMain.handle("minigames:setConfig", (_, input) => minigamesConfig().setConfig(input))
// Trabajos de la pagina de canje (lavaplatos: pago, castigo y probabilidad de romper)
const jobsConfig = () => require("./src/services/jobs.js").createJobs({
  platform: require("./src/services/local-runtime.js").getLocalPlatform(),
  getChannel: () => require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel,
})
ipcMain.handle("jobs:getConfig", () => jobsConfig().getConfig())
ipcMain.handle("jobs:setConfig", (_, input) => jobsConfig().setConfig(input))
// Tienda de efectos de la pagina de canje (precio y duracion de cada efecto)
const effectsShop = () => require("./src/services/effects-shop.js").createEffectsShop({
  platform: require("./src/services/local-runtime.js").getLocalPlatform(),
  getChannel: () => require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel,
})
ipcMain.handle("effectsShop:getConfig", () => effectsShop().getConfig())
ipcMain.handle("effectsShop:setConfig", (_, input) => effectsShop().setConfig(input))
// Copias necesarias para subir de rango una carta (pagina de canje)
const cardRanks = () => require("./src/services/card-ranks.js").createCardRanks({
  platform: require("./src/services/local-runtime.js").getLocalPlatform(),
  getChannel: () => require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel,
})
ipcMain.handle("cardRanks:getConfig", () => cardRanks().getConfig())
ipcMain.handle("cardRanks:setConfig", (_, input) => cardRanks().setConfig(input))
// Pase de batalla (pestana Pase de la pagina de canje)
const battlePass = () => require("./src/services/battle-pass.js").getDefaultBattlePass()
ipcMain.handle("battlePass:summary", () => battlePass().summary())
ipcMain.handle("battlePass:setConfig", (_, input) => battlePass().setConfig(input))
ipcMain.handle("battlePass:startSeason", (_, input) => battlePass().startSeason(input))
ipcMain.handle("battlePass:endSeason", () => battlePass().endSeason())
ipcMain.handle("battlePass:markDelivered", (_, input) => battlePass().markDelivered(input))
// Pase Sub: que cofre regala
const subPass = () => require("./src/services/sub-pass.js").createSubPass({
  platform: require("./src/services/local-runtime.js").getLocalPlatform(),
  getChannel: () => require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel,
})
ipcMain.handle("subPass:getConfig", () => {
  const platform = require("./src/services/local-runtime.js").getLocalPlatform()
  const channel = require("./src/services/currentChannel.js").get() || require("./src/services/app-config.js").getAppConfig().streamer.twitchChannel
  return { ...subPass().getConfig(), boxes: platform.mimics.listBoxes(String(channel || "").toLowerCase()).map(box => ({ id: box.id, name: box.name })) }
})
ipcMain.handle("subPass:setConfig", (_, input) => subPass().setConfig(input))

// Apoyo al proyecto: enlace de propinas y aportes apuntados a mano (pestana Top)
const support = () => require("./src/services/support.js").getDefaultSupport()
ipcMain.handle("support:getConfig", () => support().getConfig())
ipcMain.handle("support:setConfig", (_, input = {}) => support().setConfig(input))
ipcMain.handle("support:listDonations", () => support().listDonations())
ipcMain.handle("support:register", (_, input = {}) => support().registerDonation({
  username: validate.text(input.username, { name: "Usuario", max: 80, required: true }),
  platform: validate.text(input.platform, { name: "Plataforma", max: 20 }) || "twitch",
  amount: Number(input.amount),
  note: validate.text(input.note, { name: "Nota", max: 120 }),
}))
ipcMain.handle("support:undo", (_, id) => support().undoDonation(validate.text(id, { name: "Aporte", max: 80, required: true })))

// StreamElements: las propinas se apuntan solas (token JWT cifrado en el almacen de secretos)
const streamElements = () => require("./src/services/streamelements.js").getDefaultStreamElements()
ipcMain.handle("se:status", () => streamElements().status())
ipcMain.handle("se:setToken", (_, token) => streamElements().setToken(validate.text(token, { name: "Token", max: 4096 })))
ipcMain.handle("se:pending", () => streamElements().listPending())
ipcMain.handle("se:assign", (_, input = {}) => streamElements().assign(validate.text(input.id, { name: "Propina", max: 80, required: true }), {
  username: validate.text(input.username, { name: "Usuario", max: 80, required: true }),
  platform: validate.text(input.platform, { name: "Plataforma", max: 20 }) || "twitch",
  amountUsd: input.amountUsd === undefined || input.amountUsd === null || input.amountUsd === "" ? null : Number(input.amountUsd),
}))
ipcMain.handle("se:dismiss", (_, id) => streamElements().dismiss(validate.text(id, { name: "Propina", max: 80, required: true })))

// ── IPC: página de canje para viewers (servidor propio + ngrok) ──────────────
const canje = () => require("./src/services/canje.js").getDefaultCanje()
ipcMain.handle("canje:getSettings", () => canje().getSettings())
ipcMain.handle("canje:saveSettings", (_, input = {}) => canje().saveSettings({
  enabled: input.enabled === true,
  port: validate.integer(input.port, { name: "Puerto de la página de canje", min: 1024, max: 65535 }),
  clientId: validate.text(input.clientId || "", { max: 64 }),
  publicUrl: validate.text(input.publicUrl || "", { max: 300 }),
}))
// Abre la página en el navegador del streamer; la URL la arma main, no el renderer.
ipcMain.handle("canje:openLocal", () => require("electron").shell.openExternal(`http://127.0.0.1:${canje().getSettings().port}/`))

// ── IPC: Top 3 del chat ──────────────────────────────────────────────────────
function chatTop() { return require("./src/services/chat-top.js").getDefaultChatTopService() }
const CHAT_TOP_PREVIEW_STEP_MS = 2500
ipcMain.handle("chatTop:snapshot", () => chatTop().snapshot())
// Vista previa: tres cambios de orden seguidos y vuelta al top real del directo.
ipcMain.handle("chatTop:preview", () => {
  const frames = [0, 1, 2]
  frames.forEach((step, index) => setTimeout(() => overlay().broadcast({ type: "chat_top", ...chatTop().preview(step) }), index * CHAT_TOP_PREVIEW_STEP_MS))
  setTimeout(() => overlay().broadcast({ type: "chat_top", ...chatTop().snapshot() }), frames.length * CHAT_TOP_PREVIEW_STEP_MS + 1500)
  return { ok: true }
})

// ── IPC: Subathon (contador extensible + metas de subs y bits) ───────────────
function subathon() { return require("./src/services/subathon.js").getDefaultSubathon() }
const SUBATHON_MAX_MS = 30 * 24 * 3600 * 1000
function subathonState() {
  const s = subathon()
  return { timer: s.timer.snapshot(), goals: Object.fromEntries(s.goals.types.map(type => [type, s.goals.snapshot(type)])) }
}
function goalType(value) {
  const type = validate.text(value, { max: 10, required: true })
  if (!subathon().goals.types.includes(type)) throw new Error("Meta desconocida")
  return type
}
ipcMain.handle("subathon:state", () => subathonState())
ipcMain.handle("subathon:timerConfig", (_, input = {}) => { subathon().timer.setConfig(validate.plainObject(input, "configuración del contador")); return subathonState() })
ipcMain.handle("subathon:setRemaining", (_, ms) => { subathon().timer.setRemaining(validate.integer(ms, { name: "tiempo", min: 0, max: SUBATHON_MAX_MS })); return subathonState() })
ipcMain.handle("subathon:start", () => { subathon().timer.start(); return subathonState() })
ipcMain.handle("subathon:pause", () => { subathon().timer.pause(); return subathonState() })
ipcMain.handle("subathon:reset", () => { subathon().timer.reset(); return subathonState() })
// Tiempo manual (donaciones de StreamElements, Yape...). ms negativo = quitar tiempo.
ipcMain.handle("subathon:addTime", (_, ms, label) => {
  subathon().timer.add(validate.integer(ms, { name: "tiempo", min: -SUBATHON_MAX_MS, max: SUBATHON_MAX_MS }), {
    source: "manual", label: validate.text(label, { max: 80 }),
  })
  return subathonState()
})
ipcMain.handle("subathon:goalConfig", (_, type, input = {}) => { subathon().goals.setConfig(goalType(type), validate.plainObject(input, "configuración de la meta")); return subathonState() })
ipcMain.handle("subathon:goalAdd", (_, type, delta) => { subathon().goals.add(goalType(type), validate.integer(delta, { name: "cantidad", min: -1e8, max: 1e8 })); return subathonState() })
ipcMain.handle("subathon:goalSet", (_, type, value) => { subathon().goals.setCount(goalType(type), validate.integer(value, { name: "cantidad", min: 0, max: 1e8 })); return subathonState() })
// Vistas previas: animaciones en el overlay sin tocar el estado real.
ipcMain.handle("subathon:previewTime", () => {
  const snap = subathon().timer.snapshot()
  const base = snap.status === "idle" ? { ...snap, status: "paused", remainingMs: snap.remainingMs || 3 * 3600 * 1000 } : snap
  overlay().broadcast({ type: "subathon_timer", ...base, preview: true, added: { ms: 10 * 60 * 1000, source: "sub", user: "ViewerDemo", label: "sub" } })
  setTimeout(() => overlay().broadcast({ type: "subathon_timer", ...subathon().timer.snapshot() }), 6000)
  return { ok: true }
})
ipcMain.handle("subathon:previewGoal", (_, type, reached) => {
  const snap = subathon().goals.snapshot(goalType(type))
  const fake = reached
    ? { ...snap, count: snap.target, delta: 1, reached: [{ target: snap.target, reward: snap.reward }] }
    : { ...snap, count: Math.max(1, Math.round(snap.target * 0.6)), delta: 1, reached: [] }
  overlay().broadcast({ type: "subathon_goal", ...fake, preview: true })
  setTimeout(() => overlay().broadcast({ type: "subathon_goal", ...subathon().goals.snapshot(type) }), reached ? 7000 : 5000)
  return { ok: true }
})

// ── IPC: cofres sin abrir de los viewers ─────────────────────────────────────
ipcMain.handle("boxes:listAll", () => boxes().listAll())

// ── IPC: Mimics ───────────────────────────────────────────────────────────────
const mimicsService = require("./src/services/mimics.js")
ipcMain.handle("mimics:list",        (_, ch)          => mimicsService.listMimics(ch))
ipcMain.handle("mimics:create",      (_, { ch, m })   => mimicsService.createMimic(ch, m))
ipcMain.handle("mimics:update",      (_, { id, u })   => mimicsService.updateMimic(id, u))
ipcMain.handle("mimics:delete",      (_, id)          => mimicsService.deleteMimic(id))
ipcMain.handle("mimics:listBoxes",   (_, ch)          => mimicsService.listBoxes(ch))
ipcMain.handle("mimics:createBox",   (_, { ch, b })   => mimicsService.createBox(ch, b))
ipcMain.handle("mimics:deleteBox",   (_, id)          => mimicsService.deleteBox(id))
ipcMain.handle("mimics:testBlock",   (_, block)       => {
  // asegurar que el broadcast esté disponible aunque no haya conexión Twitch activa
  mimicsService.setBroadcast(payload => overlay().broadcast(payload))
  return mimicsService.testBlock(block)
})

// ── IPC: Niveles ──────────────────────────────────────────────────────────────
const levelsService = require("./src/services/levels.js")
ipcMain.handle("levels:getConfig",   (_, ch)          => levelsService.getLevelConfig(ch))
ipcMain.handle("levels:setConfig",   (_, { ch, u })   => levelsService.setLevelConfig(ch, u))
ipcMain.handle("levels:getTitles",   (_, ch)          => levelsService.getTitles(ch))
ipcMain.handle("levels:getLeaderboard",(_, ch)        => levelsService.getLeaderboard(ch))
ipcMain.handle("levels:saveTitles",  (_, { ch, t })   => levelsService.saveTitles(ch, t))

// ── IPC: Emote Sounds ─────────────────────────────────────────────────────────
const emoteSounds = require("./src/services/emoteSounds.js")
ipcMain.handle("emotes:list",       ()              => emoteSounds.list())
ipcMain.handle("emotes:setEnabled", (_, val)        => emoteSounds.setEnabled(val))
ipcMain.handle("emotes:setMasterVolume", (_, val)   => emoteSounds.setMasterVolume(val))
ipcMain.handle("emotes:add",        (_, data)       => emoteSounds.addMapping(data))
ipcMain.handle("emotes:update",     (_, { id, u })  => emoteSounds.updateMapping(id, u))
ipcMain.handle("emotes:remove",     (_, id)         => emoteSounds.removeMapping(id))
ipcMain.handle("emotes:test",       (_, id)         => emoteSounds.testSound(id))

// ── IPC: VIPs ────────────────────────────────────────────────────────────────
const vipService = require("./src/services/vips.js")
ipcMain.handle("vips:list",         ()              => vipService.list())
ipcMain.handle("vips:setEnabled",  (_, val)        => vipService.setEnabled(val))
ipcMain.handle("vips:setPoints",    (_, val)        => vipService.setPointsPerMessage(val))
ipcMain.handle("vips:addUser",      (_, user)       => vipService.addUser(user))
ipcMain.handle("vips:removeUser",   (_, { username, platform }) => vipService.removeUser(username, platform))
ipcMain.handle("vips:addSound",     (_, data)       => vipService.addSound(data))
ipcMain.handle("vips:updateSound",  (_, { id, u })  => vipService.updateSound(id, u))
ipcMain.handle("vips:removeSound",  (_, id)         => vipService.removeSound(id))
ipcMain.handle("vips:testSound",    (_, id)         => vipService.testSound(id))

// ── IPC: Regalos ──────────────────────────────────────────────────────────────
ipcMain.handle("mimics:streamerGift", (_, { ch, gift }) => {
  mimicsService.setBroadcast(payload => overlay().broadcast(payload))
  return mimicsService.streamerGift(ch, gift)
})

// ── IPC: Panel de Eventos ─────────────────────────────────────────────────────
const eventsService = require("./src/services/events.js")
function events() { return eventsService }

ipcMain.handle("events:getStatus",    ()                   => events().getStatus())
ipcMain.handle("events:rainPoints",   async (_, amount)    => {
  const result = await events().rainPoints(amount)
  overlay().broadcast({ type: "alert", text: "🎉 ¡Lluvia de " + amount + " puntos!", duration: 6000 })
  return result
})
ipcMain.handle("events:gift500",      ()                   => events().gift500())
ipcMain.handle("events:multiplier",   (_, { value, mins }) => {
  events().setMultiplier(value, mins)
  overlay().broadcast({ type: "alert", text: "🔥 x" + value + " de recompensas por " + mins + " min!", duration: 6000 })
  overlay().broadcast({ type: "game_event", event: "multiplier", value, minutes: mins })
  return events().getStatus()
})
ipcMain.handle("events:equalizer",    (_, mins)            => events().equalizer(mins))
ipcMain.handle("events:freezeEco",    (_, mins)            => { events().freezeEconomy(mins); return events().getStatus() })
ipcMain.handle("events:freezeBets",   (_, mins)            => { events().freezeBets(mins); return events().getStatus() })
ipcMain.handle("events:shield",       (_, mins)            => { events().activateShield(mins); return events().getStatus() })
ipcMain.handle("events:spawnBoss",    (_, hp)              => {
  events().spawnBoss(hp)
  overlay().broadcast({ type: "game_event", event: "boss_spawn", hp, maxHp: hp })
  return events().getStatus()
})
ipcMain.handle("events:startLottery", (_, price)           => { events().startLottery(price); return events().getStatus() })
ipcMain.handle("events:drawLottery",  ()                   => events().drawLottery())
ipcMain.handle("events:random",       ()                   => events().randomEvent())

ipcMain.handle("events:tax",        async (_, percent)   => {
  try {
    const result = events().collectTax(percent)
    console.log("[events:tax] result:", result)
    return result
  } catch(e) {
    console.error("[events:tax] error:", e.message)
    return { error: e.message }
  }
})
ipcMain.handle("events:chaos",        ()                   => events().chaosMode())
// nuevos eventos
ipcMain.handle("events:happyHour",    (_, mins)            => { events().happyHour(mins); return events().getStatus() })
ipcMain.handle("events:muerteSubita", (_, mins)            => { events().muerteSubita(mins); return events().getStatus() })
ipcMain.handle("events:taxEveryone",  (_, pct)             => events().taxEveryone(pct))
ipcMain.handle("events:setCoin",      (_, { active, max }) => { events().setCoinActive(active, max); return events().getStatus() })

ipcMain.handle("games:bj:open",   () => { games().bjOpen();  return { open: true } })
ipcMain.handle("games:bj:close",  () => { games().bjClose(); return { open: false } })
ipcMain.handle("games:bj:status", () => ({ open: games().bjIsOpen() }))

ipcMain.handle("economy:ranking",   (_, limit = 10)                  => economy().getRanking(limit))
ipcMain.handle("economy:log",       (_, limit = 50)                  => economy().getLog(limit))
ipcMain.handle("economy:stats",     ()                                => economy().getStats())
ipcMain.handle("economy:addPoints", (_, input = {}) => {
  const identity = require("./src/core/identity/viewer-identity.js").normalizeViewerIdentity(input.identity || {})
  const delta = validate.integer(input.delta, { name: "cantidad", min: -1000000000, max: 1000000000 })
  return economy().addPointsFor(identity, delta, validate.text(input.reason, { max: 120 }) || "manual")
})
ipcMain.handle("commands:list", () => require("./src/services/command-config.js").list())
ipcMain.handle("commands:update", (_, input = {}) => {
  const body = validate.plainObject(input, "comando")
  return require("./src/services/command-config.js").update(
    validate.text(body.name, { max: 40, required: true }),
    validate.plainObject(body.updates || {}, "configuración de comando"),
  )
})

ipcMain.handle("backups:list", () => backups().listBackups())
ipcMain.handle("backups:create", () => backups().createBackup("manual"))
ipcMain.handle("backups:restore", (_, name) => backups().queueRestore(validate.text(name, { max: 200, required: true })))
ipcMain.handle("database:check", () => db().quickCheck())
ipcMain.handle("diagnostics:run", () => diagnostics().run())
ipcMain.handle("diagnostics:simulateEvent", (_, input = {}) => {
  const body = validate.plainObject(input, "evento de prueba")
  return require("./src/services/event-simulator.js").getDefaultEventSimulator().simulate({
    platform: validate.text(body.platform, { max: 20, required: true }),
    text: validate.text(body.text, { max: 300, required: true }),
  })
})
ipcMain.handle("diagnostics:export", async () => {
  const result = await dialog.showSaveDialog(win, {
    title: "Exportar diagnóstico de Mimiku",
    defaultPath: `mimiku-diagnostico-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  diagnostics().exportReport(result.filePath)
  return { canceled: false }
})

ipcMain.handle("mods:getActive",    () => { const c = ch().get(); return c ? mods().getActiveMods(c) : [] })
ipcMain.handle("mods:clearWidgets", () => overlay().broadcast({ type: "widget_clear" }))

// ── IPC: AFK (modo idle con contador comunitario) ─────────────────────────────
const afkService = require("./src/services/afk.js")
ipcMain.handle("afk:activate", (_, config) => {
  afkService.setBroadcast(payload => overlay().broadcast(payload))
  afkService.setSay(msg => { try { require("./src/services/twitch.js").say(msg) } catch {} })
  const c = ch().get()
  if (c) afkService.init(c, payload => overlay().broadcast(payload), msg => { try { require("./src/services/twitch.js").say(msg) } catch {} })
  return afkService.activate(config)
})
ipcMain.handle("afk:deactivate", () => afkService.deactivate())
ipcMain.handle("afk:getStatus",  () => afkService.getStatus())

// ── IPC: Arena (motor de juegos en tiempo real) ───────────────────────────────
const arenaService = require("./src/services/arena.js")
ipcMain.handle("arena:createRoom", (_, { game, config }) => {
  const c = ch().get()
  arenaService.init(c, payload => overlay().broadcast(payload))
  return arenaService.createRoom(game, config)
})
ipcMain.handle("arena:start",    () => arenaService.startGame())
ipcMain.handle("arena:finish",   () => arenaService.finishGame())
ipcMain.handle("arena:getRoom",  () => arenaService.getRoom())
ipcMain.handle("arena:refresh",  () => arenaService.refreshPlayers())

// ── IPC: VTube Studio ─────────────────────────────────────────────────────────
const vtsService = require("./src/services/vts.js")
ipcMain.handle("vts:connect",        () => vtsService.connect())
ipcMain.handle("vts:isConnected",    () => vtsService.isConnected())
ipcMain.handle("vts:getConfig",      () => vtsService.getConfig())
ipcMain.handle("vts:saveConfig",     (_, cfg) => vtsService.saveConfig(cfg))
ipcMain.handle("vts:discoverModels", () => vtsService.discoverModels())
ipcMain.handle("vts:discoverItems",  () => vtsService.discoverItems())
ipcMain.handle("vts:testItem",       () => vtsService.spinItem())
ipcMain.handle("vts:testAvatar",     () => vtsService.spinAvatar())

// Reacciones VTuber (flujos de nodos: evento del directo -> objetos, voz, VTS)
function vtuberReactions() { return require("./src/services/vtuber-reactions.js").getDefaultVtuberReactions() }
ipcMain.handle("reactions:get",     () => vtuberReactions().getConfig())
ipcMain.handle("reactions:save",    (_, cfg) => vtuberReactions().saveConfig(validate.plainObject(cfg, "reacciones")))
ipcMain.handle("reactions:test",    (_, flowId, nodeId) => vtuberReactions().test(
  validate.text(flowId, { name: "flujo", max: 40, required: true }),
  nodeId ? validate.text(nodeId, { name: "nodo", max: 40 }) : undefined,
))
ipcMain.handle("reactions:hotkeys", () => vtsService.listHotkeys())
ipcMain.handle("reactions:expressions", () => vtsService.listExpressions())
ipcMain.handle("reactions:hits",        () => vtuberReactions().hits())
ipcMain.handle("reactions:resetHits",   () => vtuberReactions().resetHits())
ipcMain.handle("reactions:clearItems",  () => vtuberReactions().clearItems())
ipcMain.on("reactions:speech",      (_, state) => vtuberReactions().speechState(state?.speaking === true, state?.lipSync === true))


// ── IPC: Widgets (avatares de chat, etc.) ────────────────────────────────────
ipcMain.handle("widgets:getConfig", () => widgets().getConfig())
ipcMain.handle("widgets:setConfig", (_, updates) => widgets().setConfig(updates))
ipcMain.handle("widgets:test", () => {
  widgets().setBroadcast(payload => overlay().broadcast(payload))
  return widgets().testAvatar()
})

// ── IPC: perfiles y cartas ────────────────────────────────────────────────────
function profiles() { return require("./src/services/profiles.js") }

ipcMain.handle("profiles:getCards",      (_, ch)                    => profiles().getCards(ch))
ipcMain.handle("profiles:createCard",    (_, { ch, name, desc, img, rarity, exclusive }) => profiles().createCard(ch, name, desc, img, rarity, exclusive))
ipcMain.handle("profiles:setCardExclusive", (_, { id, exclusive }) => require("./src/services/local-runtime.js").getLocalPlatform().profiles.setCardExclusive(id, exclusive))
ipcMain.handle("profiles:deleteCard",    (_, id)                    => profiles().deleteCard(id))
ipcMain.handle("profiles:updateCard", (_, input = {}) => {
  const id = validate.text(input.id, { name: "Personaje", max: 100, required: true })
  const optional = (value, max) => (value === undefined ? undefined : validate.text(value, { max }))
  const updated = require("./src/services/local-runtime.js").getLocalPlatform().profiles.updateCard(id, {
    name: optional(input.name, 120), description: optional(input.description, 1000), imagePath: optional(input.img, 1000),
    rarity: input.rarity === undefined ? undefined : validate.text(input.rarity, { max: 20 }),
    exclusive: input.exclusive === undefined ? undefined : input.exclusive === "sub" ? "sub" : "",
  })
  if (!updated) throw new Error("Ese personaje ya no existe")
  return updated
})

// Buscar GIFs de personajes (GIPHY, con la clave del streamer cifrada en el almacen de secretos)
const gifSearch = () => require("./src/services/gif-search.js").getDefaultGifSearch()
ipcMain.handle("gif:status", () => gifSearch().status())
ipcMain.handle("gif:setKey", (_, key) => gifSearch().setKey(validate.text(key, { name: "Clave", max: 200 })))
ipcMain.handle("gif:search", (_, input = {}) => gifSearch().search(validate.text(input.query, { name: "Búsqueda", max: 120, required: true }), Number(input.limit) || 8))
ipcMain.handle("profiles:getPacks",      (_, ch)                    => profiles().getPacks(ch))
ipcMain.handle("profiles:createPack",    (_, { ch, name, desc, price, tier }) => profiles().createPack(ch, name, desc, price, tier))
ipcMain.handle("profiles:getCosmetics",  (_, ch)                    => profiles().getCosmetics(ch))
ipcMain.handle("profiles:createCosmetic",(_, { ch, name, type, img, color, price }) => profiles().createCosmetic(ch, name, type, img, color, price))

app.whenReady().then(() => {
  // Un archivo mimiku-data.db corrupto/bloqueado no debe crashear la app
  // con una excepción críptica (Fase 1.6, §16) — se avisa con un mensaje
  // claro y se cierra, en vez de intentar "recuperar" el archivo solo
  // (mover/borrar datos del streamer automáticamente es más riesgoso que útil).
  try {
    db().getDb()
  } catch (error) {
    dialog.showErrorBox(
      "Mimiku no pudo abrir su base de datos local",
      `No se pudo abrir mimiku-data.db: ${error.message}\n\nSi el archivo está dañado, hacé una copia de seguridad de la carpeta de datos de Mimiku y probá renombrar mimiku-data.db antes de reabrir la app.`
    )
    app.quit()
    return
  }
  const workspace = appConfig.ensureWorkspace()
  ch().set(workspace.id)
  overlay().start()
  initializeLocalRuntime(workspace.id)
  // Página de canje: solo arranca si está activada (servidor aparte, puerto 7780).
  canje().start().catch(error => console.error("[canje] arranque:", error.message))
  // StreamElements: si hay token guardado, conecta y apunta las propinas solas.
  try { streamElements().start() } catch (error) { console.error("[streamelements] arranque:", error.message) }

  // Los sonidos son multiplataforma y deben cargar aunque el streamer use
  // únicamente Social Stream Ninja, sin configurar ni conectar Twitch.
  emoteSounds.init(payload => overlay().broadcast(payload))
  vipService.init(payload => overlay().broadcast(payload))

  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    frame: false, backgroundColor: "#0a0a0f",
    webPreferences: {
      preload: path.join(__dirname, "src", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })

  // Antes solo se llamaba dentro de "twitch:connect" — una instalación que
  // solo usa Social Stream Ninja (sin tocar nunca Twitch) nunca habría
  // tenido una ventana para mandarle el feed de chat agnóstico (Fase 1.6).
  twitch().setWindow(win)

  // Si el streamer ya conectó SSN antes, reconectar solo al arrancar —
  // nunca imprime el sessionId completo (ssnTransport ya lo enmascara).
  const ssnConfig = appConfig.getAppConfig().integrations.socialStreamNinja
  if (ssnConfig.enabled) {
    const discovered = discoverSsnConfig()
    ssnTransport().setPorts([discovered.port, 3003, 3000])
    const roomId = discovered.roomId || ssnConfig.sessionId
    if (roomId) ssnTransport().connect(roomId)
  }

  win.loadFile("src/index.html")
})

app.on("window-all-closed", () => app.quit())

app.on("before-quit", () => {
  try { ssnTransport().disconnect() } catch {}
  try { twitch().disconnect() } catch {}
  try { overlay().stop() } catch {}
  try { canje().stop() } catch {}
  try { db().closeDb() } catch {}
})
