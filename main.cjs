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
ipcMain.handle("overlay:getStatus", () => overlay().getStatus())
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
    postUrl: `http://127.0.0.1:7777${localApi.SSN_PATH_PREFIX}${token}`,
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
ipcMain.handle("tiktok:setSecrets", (_, input = {}) => secrets().setTikTokCredentials({
  signApiKey: validate.text(input.signApiKey, { max: 4096 }),
  sessionId: validate.text(input.sessionId, { max: 4096 }),
  ttTargetIdc: validate.text(input.ttTargetIdc, { max: 200 }),
}))
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
ipcMain.handle("king:toggle", (_, visible) => {
  overlay().broadcast({ type: "king_toggle", visible })
  return { ok: true }
})

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
ipcMain.handle("events:crownKing",    (_, bonus)           => events().crownKing(bonus))
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
ipcMain.handle("profiles:createCard",    (_, { ch, name, desc, img, rarity }) => profiles().createCard(ch, name, desc, img, rarity))
ipcMain.handle("profiles:deleteCard",    (_, id)                    => profiles().deleteCard(id))
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
  try { db().closeDb() } catch {}
})
