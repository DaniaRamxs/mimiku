// services/vtuber-reactions.js — Reacciones VTuber: une los eventos del
// directo con reacciones en pantalla y en el modelo de VTube Studio.
//
// Los flujos (grafos de nodos) se guardan en userData. El recorrido lo hace
// core/vtuber/reaction-runner.js; aqui se conectan sus acciones:
//   - overlay "/vtuber" (OBS): objetos con fisica, bonk, escudo, gravedad,
//     estrellas, contador de golpes y modo jefe
//   - overlay principal: textos (alert)
//   - VTube Studio: atajos, expresiones, tinte, movimiento, fisica, boca,
//     accesorios y avatares pegados (services/vtuber/*)
//   - ventana de Mimiku: el texto a voz (speechSynthesis de Windows)
//   - economia de Mimiku: el filtro "Cobrar puntos"
const { sanitizeConfig, nodeDefinition, NODES } = require("../core/vtuber/reaction-catalog.js")
const { createReactionRunner } = require("../core/vtuber/reaction-runner.js")
const { createVtsEffects } = require("./vtuber/vts-effects.js")
const { createCommunity } = require("./vtuber/community.js")

const CONFIG_FILE = "vtuber-reactions.json"
const HITS_FILE = "vtuber-hits.json"
// Lo que tarda el martillo del overlay en llegar a la cabeza.
const BONK_IMPACT_MS = 650
// Lo que tarda un avatar lanzado en llegar al modelo antes de pegarse.
const AVATAR_FLIGHT_MS = 850
const ANVIL_IMPACT_MS = 700

// Tipos del Event Engine que escucha algun disparador (los golpes y el modo
// jefe los genera Mimiku, no llegan por el Event Engine).
const INTERNAL_EVENTS = new Set(["object_hit", "boss_win", "boss_fail"])
const ENGINE_EVENT_TYPES = [...new Set(NODES.filter(def => def.kind === "trigger").flatMap(def => def.events))]
  .filter(type => !INTERNAL_EVENTS.has(type))

function createVtuberReactionsService({
  store, hitStore = { load: () => null, save() {} }, broadcast, vts, speakInWindow,
  accessories = null, avatars = { avatarUrl: async () => null }, points = { charge: async () => false },
  now = Date.now, sleep, timers = { setTimeout, clearTimeout, setInterval, clearInterval },
  random = Math.random, log = console,
}) {
  let config = sanitizeConfig(store.load() || {})
  const wait = sleep || (ms => new Promise(resolve => timers.setTimeout(resolve, ms)))
  const effects = createVtsEffects({ vts, wait, timers, random, log })

  function requireAccessories() {
    if (!accessories) throw new Error("los accesorios de VTube Studio no están disponibles")
    return accessories
  }

  async function throwObjects(params) {
    const { viewer, ...rest } = params
    let { object, image } = rest
    if (object === "avatar") {
      const url = await avatars.avatarUrl(viewer)
      if (url) image = url
      else object = "ball"
    }
    broadcast({ type: "vtuber_throw", ...rest, object, image })
  }

  async function bonk({ size, squash, by, silent }) {
    broadcast({ type: "vtuber_bonk", size, by, silent })
    if (!squash) return
    await wait(BONK_IMPACT_MS)
    await effects.move({ move: "squash", strength: 80 })
  }

  // El yunque cae en el overlay y, al tocar la cabeza, el modelo se aplasta
  // en VTS y se queda asi `seconds`.
  async function anvil({ size, flatten, seconds, strength, daze, by, silent }) {
    broadcast({ type: "vtuber_anvil", size, seconds: flatten ? seconds : 0, by, silent })
    if (!flatten) return
    await wait(ANVIL_IMPACT_MS)
    await effects.flatten({ strength, seconds, daze })
  }

  // El avatar llega volando por el overlay y luego se pega al modelo. Sin
  // VTube Studio conectado se queda pegado en el overlay.
  async function attachAvatar(params) {
    const connected = vts.isConnected()
    if (params.flyIn || !connected) {
      const url = await avatars.avatarUrl(params.viewer)
      if (url) {
        broadcast({
          type: "vtuber_throw", object: "avatar", image: url, count: 1, size: 96, from: "sides", aim: true,
          sticky: !connected, stickSeconds: Math.min(params.seconds, 60), by: params.viewer.name, label: "",
          vanish: connected,
        })
      }
      if (!connected) return
      await wait(AVATAR_FLIGHT_MS)
    }
    await requireAccessories().attachAvatar(params)
  }

  const actions = {
    throwObjects,
    bonk,
    anvil,
    attachAvatar,
    vtsAccessory: params => requireAccessories().accessory(params),
    bumpGrow: params => requireAccessories().bumpGrow(params),
    showText: ({ text, seconds }) => broadcast({ type: "alert", text, duration: seconds * 1000 }),
    playSound: ({ sound, volume }) => { if (sound) broadcast({ type: "vtuber_sound", url: sound, volume }) },
    speak: params => { if (params.text.trim()) speakInWindow(params) },
    gravity: ({ mode, seconds }) => broadcast({ type: "vtuber_gravity", mode, seconds }),
    shield: ({ seconds, by }) => broadcast({ type: "vtuber_shield", seconds, by }),
    dizzyStars: ({ seconds }) => broadcast({ type: "vtuber_dizzy", seconds }),
    bossMode: params => community.startBoss(params),
    vtsHotkey: ({ hotkeyId }) => (hotkeyId ? vts.triggerHotkey(hotkeyId) : null),
    vtsExpression: effects.expression,
    vtsTint: effects.tint,
    vtsMove: effects.move,
    vtsPhysics: effects.physics,
  }

  const runner = createReactionRunner({
    getFlows: () => config.flows,
    actions, now, random, sleep: wait,
    chargePoints: (ctx, amount) => points.charge(ctx, amount),
    onError: (error, { flow, node }) => {
      log.warn(`[reacciones] "${flow.name}" / ${nodeDefinition(node.type)?.label || node.type}: ${error.message}`)
    },
  })

  const community = createCommunity({ broadcast, handleEvent: event => runner.handle(event), hitStore, now, timers, log })

  function stageMessage() {
    return { type: "vtuber_stage", ...config.stage }
  }

  // Todo lo que un overlay /vtuber necesita al conectarse.
  function overlayState() {
    return [stageMessage(), ...community.stateMessages()]
  }

  function sendStage() {
    broadcast(stageMessage())
  }

  function getConfig() { return config }

  function saveConfig(raw) {
    config = sanitizeConfig(raw)
    store.save(config)
    sendStage()
    return config
  }

  function handleEvent(event) {
    return runner.handle(event)
  }

  function register(eventEngine) {
    return ENGINE_EVENT_TYPES.map(type => eventEngine.subscribe(type, handleEvent))
  }

  return {
    getConfig, saveConfig, sendStage, overlayState, handleEvent, register,
    handleHit: message => community.handleHit(message),
    speechState: effects.speechState,
    hits: () => community.hits(),
    resetHits: () => community.resetToday(),
    clearItems: () => requireAccessories().clearAll(),
    headPatterns: () => config.stage.headMeshes,
    test: (flowId, nodeId) => runner.test(flowId, nodeId),
  }
}

// ── Instancia de la app (solo dentro de Electron) ──────────────────────────
let defaultService = null

function fileStore(name) {
  const fs = require("node:fs")
  const path = require("node:path")
  const file = path.join(require("electron").app.getPath("userData"), name)
  return {
    load() {
      try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch (error) {
        if (error.code !== "ENOENT") console.warn(`[reacciones] ${name} ilegible, se empieza vacío:`, error.message)
        return null
      }
    },
    save(data) {
      const temporary = `${file}.tmp`
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2))
      fs.renameSync(temporary, file)
    },
  }
}

function builtinImage(item) {
  const fs = require("node:fs")
  const path = require("node:path")
  if (!/^[a-z]+$/.test(item)) throw new Error("accesorio desconocido")
  return fs.readFileSync(path.join(__dirname, "vtuber-items", `${item}.png`)).toString("base64")
}

// "Cobrar puntos": del monedero del viewer en el canal actual.
const economyPoints = {
  async charge(ctx, amount) {
    if (!ctx.username || !["twitch", "tiktok", "youtube"].includes(ctx.platform)) return false
    const economy = require("./economy.js")
    const identity = { username: ctx.username, displayName: ctx.user, platformUserId: ctx.event.actor?.platformUserId || "", platform: ctx.platform }
    const viewer = economy.getViewerFor(identity)
    if (!viewer || viewer.points < amount) {
      ctx.event.reply?.(`@${ctx.user} necesitas ${amount} puntos (tienes ${viewer?.points || 0}).`)
      return false
    }
    economy.addPointsFor(identity, -amount, "reaccion-vtuber")
    return true
  },
}

function getDefaultVtuberReactions() {
  if (!defaultService) {
    const vts = require("./vts.js")
    const avatars = require("./vtuber/avatar-images.js")
    const accessories = require("./vtuber/accessories.js").createAccessories({
      vts, builtinImage, avatarImage: avatars.avatarImage,
      getHeadPatterns: () => defaultService?.headPatterns() || "",
    })
    defaultService = createVtuberReactionsService({
      store: fileStore(CONFIG_FILE),
      hitStore: fileStore(HITS_FILE),
      broadcast: payload => require("./overlay-server.js").broadcast(payload),
      vts, accessories, avatars, points: economyPoints,
      speakInWindow: payload => require("../integrations/twitch/twitch-adapter.js").sendToRenderer("reactions:speak", payload),
    })
  }
  return defaultService
}

module.exports = { createVtuberReactionsService, getDefaultVtuberReactions, ENGINE_EVENT_TYPES }
