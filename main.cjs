const { app, BrowserWindow, ipcMain } = require("electron")
const appConfig = require("./src/services/app-config.js")

let win

function db()      { return require("./src/services/db.js") }
function economy() { return require("./src/services/economy.js") }
function twitch()  { return require("./src/services/twitch.js") }
function mods()    { return require("./src/services/mods.js") }
function overlay() { return require("./src/services/overlay-server.js") }
function ch()      { return require("./src/services/currentChannel.js") }
function games()   { return require("./src/services/games.js") }
function widgets() { return require("./src/services/widgets.js") }

ipcMain.handle("app:minimize", () => win?.minimize())
ipcMain.handle("app:maximize", () => win?.isMaximized() ? win.unmaximize() : win?.maximize())
ipcMain.handle("app:quit",     () => app.quit())
ipcMain.handle("overlay:send", (_, payload) => overlay().broadcast(payload))
ipcMain.handle("assets:save", async (_, asset) => {
  const bytes = Buffer.from(asset?.bytes || [])
  return require("./src/services/local-assets.js").getLocalAssetStore().save({
    kind: asset?.kind, name: asset?.name, mimeType: asset?.mimeType, bytes,
  })
})
ipcMain.handle("config:get", () => appConfig.getPublicAppConfig())
ipcMain.handle("config:getPublic", () => appConfig.getPublicAppConfig())
ipcMain.handle("config:save", (_, updates) => {
  appConfig.saveAppConfig(updates)
  return appConfig.getPublicAppConfig()
})

ipcMain.handle("twitch:connect", (_, { channel, token }) => {
  ch().set(channel)
  twitch().setWindow(win)
  twitch().setBroadcast(payload => overlay().broadcast(payload))
  // inicializar panel de eventos
  const evtSay = (msg) => { try { require("./src/services/twitch.js").say(msg) } catch {} }
  require("./src/services/events.js").init(channel, evtSay, payload => overlay().broadcast(payload))
  require("./src/services/shopRealtime.js").init(channel, payload => overlay().broadcast(payload))
  require("./src/services/mimics.js").init(channel, payload => overlay().broadcast(payload))
  require("./src/services/levels.js").init(channel, payload => overlay().broadcast(payload))
  require("./src/services/emoteSounds.js").init(payload => overlay().broadcast(payload))
  require("./src/services/afk.js").init(channel, payload => overlay().broadcast(payload), evtSay)
  require("./src/services/vts.js").init(payload => overlay().broadcast(payload))
  require("./src/services/widgets.js").init(channel, payload => overlay().broadcast(payload))
  // precargar diccionario de Arena en segundo plano (descarga la 1ª vez)
  try { require("./src/services/dictionary.js").ensureLoaded() } catch (e) {}
  twitch().connect(channel, token)
  mods().registerChannel(channel, channel)
  overlay().broadcast({ type: "set_channel", channel: channel.toLowerCase() })

  mods().subscribeToOverlay(channel, (cmd) => {
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

  mods().subscribeToWidgets(channel, (w, eventType) => {
    if (!w.visible) {
      overlay().broadcast({ type: "widget_remove", widget_id: w.id })
    } else if (eventType === "INSERT") {
      overlay().broadcast({
        type: "widget_add", widget_id: w.id,
        mod_username: w.mod_username, mod_display: w.mod_display,
        content_type: w.type, content: w.content,
        x: w.x, y: w.y, w: w.w, h: w.h,
      })
    } else {
      overlay().broadcast({ type: "widget_move",   widget_id: w.id, x: w.x, y: w.y })
      overlay().broadcast({ type: "widget_resize", widget_id: w.id, w: w.w, h: w.h })
    }
  })

  mods().loadWidgets(channel).then(widgets => {
    widgets.forEach(w => overlay().broadcast({
      type: "widget_add", widget_id: w.id,
      mod_username: w.mod_username, mod_display: w.mod_display,
      content_type: w.type, content: w.content,
      x: w.x, y: w.y, w: w.w, h: w.h,
    }))
  })
})

ipcMain.handle("twitch:disconnect", () => twitch().disconnect())

ipcMain.handle("legacy:import", async () => {
  if (!appConfig.isLegacySupabaseConfigured()) {
    throw new Error("Configura y habilita primero el puente heredado de Supabase")
  }
  return require("./src/services/legacy-importer.js").importFromConfiguredSupabase()
})



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
ipcMain.handle("emotes:add",        (_, data)       => emoteSounds.addMapping(data))
ipcMain.handle("emotes:update",     (_, { id, u })  => emoteSounds.updateMapping(id, u))
ipcMain.handle("emotes:remove",     (_, id)         => emoteSounds.removeMapping(id))
ipcMain.handle("emotes:test",       (_, id)         => {
  emoteSounds.setBroadcast(payload => overlay().broadcast(payload))
  return emoteSounds.testSound(id)
})

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
ipcMain.handle("economy:addPoints", (_, { username, delta, reason }) => economy().addPoints(username, delta, reason))

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
  db().getDb()
  overlay().start()

  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    frame: false, backgroundColor: "#0a0a0f",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })

  win.loadFile("src/index.html")
})

app.on("window-all-closed", () => app.quit())
