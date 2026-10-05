// Nodos "Hacer" (acciones) de las Reacciones VTuber. `action` es el nombre de
// la accion que ejecuta el servicio; `build(params, ctx)` arma lo que recibe,
// ya con las plantillas resueltas y los datos del viewer.
const { renderTemplate, plain } = require("./templates.js")

const MAX_THROW = 100

const BUILTIN_OBJECTS = [
  ["ball", "Pelota"], ["star", "Estrella"], ["heart", "Corazón"], ["coin", "Moneda"], ["box", "Caja"],
  ["tomato", "Tomate"], ["egg", "Huevo"], ["snowball", "Bola de nieve"], ["ring", "Aro"],
]
const THROW_OBJECTS = [...BUILTIN_OBJECTS, ["avatar", "Foto del viewer"], ["chat", "El que pida el viewer"]]
// Palabras con las que el chat puede pedir cada objeto (sin tildes).
const OBJECT_WORDS = {
  ball: ["pelota", "balon", "bola"], star: ["estrella"], heart: ["corazon"], coin: ["moneda"], box: ["caja"],
  tomato: ["tomate"], egg: ["huevo"], snowball: ["nieve", "bolanieve", "bola de nieve"], ring: ["aro", "dona", "rosquilla"],
}
const THROW_FROM = [["sides", "Ambos lados"], ["left", "Izquierda"], ["right", "Derecha"], ["top", "Lluvia desde arriba"]]
const MOVES = [
  ["shake", "Sacudida"], ["jump", "Salto"], ["spin", "Giro"], ["zoom", "Acercar"], ["tilt", "Inclinar"],
  ["recoil", "Rebote al golpe"], ["dizzy", "Mareo"], ["squash", "Aplastar y estirar"], ["fly", "Salir volando"], ["tremble", "Temblor de miedo"],
]
const GRAVITY_MODES = [["float", "Flotan hacia arriba"], ["bouncy", "Rebotan sin parar"], ["zero", "Sin gravedad"], ["heavy", "Caen como piedras"]]
const ACCESSORIES = [["hat", "Gorro de fiesta"], ["glasses", "Gafas de sol"], ["crown", "Corona"], ["bandage", "Tirita"], ["bump", "Chichón"]]
const PIN_PLACES = [["head", "Cabeza"], ["body", "Cualquier parte del cuerpo"]]

function objectFromWord(word) {
  const wanted = plain(word)
  return Object.keys(OBJECT_WORDS).find(id => OBJECT_WORDS[id].includes(wanted)) || null
}

// El viewer escribe "!lanzar tomate": se usa si esta permitido; si no, el primero permitido.
function pickChatObject(message, allowedText) {
  const allowed = String(allowedText || "").split(/[,\s]+/).map(objectFromWord).filter(Boolean)
  const pool = allowed.length ? allowed : BUILTIN_OBJECTS.map(([id]) => id)
  const words = plain(message).split(/\s+/)
  const asked = objectFromWord(words.slice(0, 3).join(" ")) || objectFromWord(words.slice(0, 2).join(" ")) || objectFromWord(words[0])
  return asked && pool.includes(asked) ? asked : pool[0]
}

// Quien provoco la accion; el servicio busca su foto si hace falta.
function viewerRef(ctx) {
  return { name: ctx.user || "", username: ctx.username || "", platform: ctx.platform || "", avatarUrl: ctx.avatarUrl || "" }
}

const ACTIONS = [
  {
    type: "throw_objects", kind: "action", label: "Lanzar objetos", action: "throwObjects",
    params: [
      { key: "object", label: "Objeto", type: "select", options: THROW_OBJECTS, default: "ball" },
      // showIf: el inspector solo muestra el campo cuando tiene sentido.
      { key: "allowed", label: "Objetos que puede pedir (vacío = todos)", type: "text", default: "", showIf: p => p.object === "chat" },
      { key: "image", label: "Imagen o GIF propio (opcional)", type: "asset", accept: "image/*", default: "", showIf: p => p.object !== "avatar" && p.object !== "chat" },
      { key: "count", label: "Cantidad", type: "number", min: 1, max: MAX_THROW, default: 5 },
      { key: "perAmount", label: "Multiplicar por la cantidad del evento", type: "toggle", default: false },
      { key: "size", label: "Tamaño (px)", type: "number", min: 16, max: 400, default: 64 },
      { key: "from", label: "Desde", type: "select", options: THROW_FROM, default: "sides" },
      { key: "aim", label: "Apuntar a la cabeza del modelo", type: "toggle", default: true },
      { key: "sticky", label: "Se pega a la cabeza y deja mancha", type: "toggle", default: false },
      { key: "explode", label: "Explota al golpear", type: "toggle", default: false },
      { key: "pile", label: "Se amontonan en el suelo", type: "toggle", default: false },
      { key: "showName", label: "Mostrar el nombre del viewer", type: "toggle", default: false },
    ],
    build: (p, ctx) => {
      const object = p.object === "chat" ? pickChatObject(ctx.message, p.allowed) : p.object
      return {
        object, image: object === "avatar" ? "" : p.image, size: p.size, from: p.from, aim: p.aim,
        sticky: p.sticky, explode: p.explode, pile: p.pile,
        count: Math.min(MAX_THROW, p.perAmount ? p.count * Math.max(1, ctx.amount) : p.count),
        label: p.showName ? ctx.user : "", by: ctx.user || "",
        viewer: object === "avatar" ? viewerRef(ctx) : null,
        // Lanzados por un impacto: no reportan los suyos, o un flujo
        // "golpe -> lanzar objetos" se alimentaria a si mismo sin fin.
        silent: ctx.event?.type === "object_hit",
      }
    },
  },
  {
    type: "bonk", kind: "action", label: "Martillo bonk", action: "bonk",
    params: [
      { key: "size", label: "Tamaño del martillo (px)", type: "number", min: 100, max: 500, default: 260 },
      { key: "squash", label: "Aplastar el modelo al golpear (VTS)", type: "toggle", default: true },
    ],
    build: (p, ctx) => ({ size: p.size, squash: p.squash, by: ctx.user || "", silent: ctx.event?.type === "object_hit" }),
  },
  {
    type: "anvil", kind: "action", label: "Yunque que aplasta", action: "anvil",
    params: [
      { key: "size", label: "Tamaño del yunque (px)", type: "number", min: 120, max: 500, default: 220 },
      { key: "flatten", label: "Dejar el modelo aplastado (VTS)", type: "toggle", default: true },
      { key: "seconds", label: "Segundos aplastado", type: "number", min: 1, max: 60, default: 8, showIf: p => p.flatten },
      { key: "strength", label: "Fuerza del aplastón (%)", type: "number", min: 10, max: 100, default: 80, showIf: p => p.flatten },
      { key: "daze", label: "Ojos cerrados y cabeza gacha al recibirlo", type: "toggle", default: true, showIf: p => p.flatten },
    ],
    build: (p, ctx) => ({
      size: p.size, flatten: p.flatten, seconds: p.seconds, strength: p.strength, daze: p.daze,
      by: ctx.user || "", silent: ctx.event?.type === "object_hit",
    }),
  },
  {
    type: "attach_avatar", kind: "action", label: "Pegar el avatar del viewer (VTS)", action: "attachAvatar",
    params: [
      { key: "where", label: "Dónde se pega", type: "select", options: PIN_PLACES, default: "body" },
      { key: "seconds", label: "Segundos pegado", type: "number", min: 5, max: 3600, default: 120 },
      { key: "size", label: "Tamaño (%)", type: "number", min: 5, max: 60, default: 16 },
      { key: "max", label: "Máximo a la vez", type: "number", min: 1, max: 30, default: 12 },
      { key: "flyIn", label: "Llega volando por el overlay", type: "toggle", default: true },
      { key: "askFirst", label: "Pedir permiso en VTube Studio por cada avatar nuevo", type: "toggle", default: false },
    ],
    build: (p, ctx) => ({ ...p, viewer: viewerRef(ctx) }),
  },
  {
    type: "vts_accessory", kind: "action", label: "Accesorio en el modelo (VTS)", action: "vtsAccessory",
    params: [
      { key: "item", label: "Accesorio", type: "select", options: ACCESSORIES, default: "hat" },
      { key: "where", label: "Dónde", type: "select", options: PIN_PLACES, default: "head" },
      { key: "seconds", label: "Segundos", type: "number", min: 3, max: 3600, default: 60 },
      { key: "size", label: "Tamaño (%)", type: "number", min: 5, max: 80, default: 28 },
    ],
    build: p => ({ item: p.item, where: p.where, seconds: p.seconds, size: p.size }),
  },
  {
    type: "bump_grow", kind: "action", label: "Chichón que crece (VTS)", action: "bumpGrow",
    params: [
      { key: "step", label: "Crece por golpe (%)", type: "number", min: 1, max: 20, default: 3 },
      { key: "max", label: "Tamaño máximo (%)", type: "number", min: 10, max: 80, default: 35 },
      { key: "resetSeconds", label: "Se deshincha tras (segundos sin golpes)", type: "number", min: 5, max: 600, default: 30 },
    ],
    build: p => ({ step: p.step, max: p.max, resetSeconds: p.resetSeconds }),
  },
  {
    type: "show_text", kind: "action", label: "Mostrar texto", action: "showText",
    params: [
      { key: "text", label: "Texto", type: "text", default: "Gracias {usuario}", template: true },
      { key: "seconds", label: "Segundos", type: "number", min: 1, max: 30, default: 5 },
    ],
    build: (p, ctx) => ({ text: renderTemplate(p.text, ctx), seconds: p.seconds }),
  },
  {
    type: "speak", kind: "action", label: "Texto a voz", action: "speak",
    params: [
      { key: "text", label: "Texto", type: "text", default: "{usuario} dice {mensaje}", template: true },
      { key: "voice", label: "Voz", type: "voice", default: "" },
      { key: "rate", label: "Velocidad (50-200%)", type: "number", min: 50, max: 200, default: 100 },
      { key: "volume", label: "Volumen (%)", type: "number", min: 0, max: 100, default: 90 },
      { key: "lipSync", label: "Mover la boca del modelo", type: "toggle", default: true },
    ],
    build: (p, ctx) => ({ text: renderTemplate(p.text, ctx), voice: p.voice, rate: p.rate, volume: p.volume, lipSync: p.lipSync }),
  },
  {
    type: "play_sound", kind: "action", label: "Efecto de sonido", action: "playSound",
    params: [
      { key: "sound", label: "Sonido", type: "asset", accept: "audio/*", default: "" },
      { key: "volume", label: "Volumen (%)", type: "number", min: 0, max: 100, default: 80 },
    ],
    build: p => ({ sound: p.sound, volume: p.volume }),
  },
  {
    type: "gravity", kind: "action", label: "Gravedad loca", action: "gravity",
    params: [
      { key: "mode", label: "Modo", type: "select", options: GRAVITY_MODES, default: "float" },
      { key: "seconds", label: "Segundos", type: "number", min: 2, max: 60, default: 10 },
    ],
    build: p => ({ mode: p.mode, seconds: p.seconds }),
  },
  {
    type: "shield", kind: "action", label: "Escudo", action: "shield",
    params: [{ key: "seconds", label: "Segundos", type: "number", min: 3, max: 600, default: 30 }],
    build: (p, ctx) => ({ seconds: p.seconds, by: ctx.user || "" }),
  },
  {
    type: "dizzy_stars", kind: "action", label: "Estrellas de mareo", action: "dizzyStars",
    params: [{ key: "seconds", label: "Segundos", type: "number", min: 1, max: 30, default: 5 }],
    build: p => ({ seconds: p.seconds }),
  },
  {
    type: "boss_mode", kind: "action", label: "Modo jefe", action: "bossMode",
    params: [
      { key: "title", label: "Título", type: "text", default: "Derrotad a la VTuber" },
      { key: "hits", label: "Golpes necesarios", type: "number", min: 5, max: 5000, default: 50 },
      { key: "seconds", label: "Tiempo (segundos)", type: "number", min: 10, max: 600, default: 60 },
    ],
    build: (p, ctx) => ({ title: renderTemplate(p.title, ctx), hits: p.hits, seconds: p.seconds }),
  },
  {
    type: "vts_hotkey", kind: "action", label: "Atajo de VTube Studio", action: "vtsHotkey",
    params: [
      { key: "hotkeyId", label: "Atajo de VTube Studio", type: "hotkey", default: "" },
      // Nombre visible del atajo elegido; solo para dibujar el nodo.
      { key: "hotkeyName", label: "Nombre", type: "text", hidden: true, default: "" },
    ],
    build: p => ({ hotkeyId: p.hotkeyId }),
  },
  {
    type: "vts_expression", kind: "action", label: "Expresión temporal (VTS)", action: "vtsExpression",
    params: [
      { key: "expression", label: "Expresión", type: "expression", default: "" },
      { key: "expressionName", label: "Nombre", type: "text", hidden: true, default: "" },
      { key: "seconds", label: "Segundos", type: "number", min: 1, max: 600, default: 5 },
    ],
    build: p => ({ expression: p.expression, seconds: p.seconds }),
  },
  {
    type: "vts_tint", kind: "action", label: "Cambiar color (VTS)", action: "vtsTint",
    params: [
      { key: "color", label: "Color", type: "color", default: "#ff4d8d" },
      { key: "seconds", label: "Segundos", type: "number", min: 1, max: 120, default: 5 },
      { key: "rainbow", label: "Arcoíris", type: "toggle", default: false },
    ],
    build: p => ({ color: p.color, seconds: p.seconds, rainbow: p.rainbow }),
  },
  {
    type: "vts_move", kind: "action", label: "Mover el modelo (VTS)", action: "vtsMove",
    params: [
      { key: "move", label: "Movimiento", type: "select", options: MOVES, default: "shake" },
      { key: "strength", label: "Fuerza (%)", type: "number", min: 10, max: 100, default: 60 },
    ],
    build: (p, ctx) => ({ move: p.move, strength: p.strength, direction: ctx.direction || 0 }),
  },
  {
    type: "vts_physics", kind: "action", label: "Física exagerada (VTS)", action: "vtsPhysics",
    params: [
      { key: "strength", label: "Fuerza del pelo y la ropa (0-100)", type: "number", min: 0, max: 100, default: 100 },
      { key: "wind", label: "Viento (0-100)", type: "number", min: 0, max: 100, default: 70 },
      { key: "seconds", label: "Segundos", type: "number", min: 1, max: 300, default: 15 },
    ],
    build: p => ({ strength: p.strength, wind: p.wind, seconds: p.seconds }),
  },
  {
    type: "wait", kind: "action", label: "Esperar", action: null,
    params: [{ key: "seconds", label: "Segundos", type: "number", min: 0.1, max: 60, step: 0.1, default: 1 }],
  },
]

module.exports = { ACTIONS, BUILTIN_OBJECTS, ACCESSORIES, MAX_THROW, pickChatObject, objectFromWord }
