// Efectos de directo: comandos gratuitos que solo disparan animaciones que el
// overlay ya sabe dibujar (confeti, arcoiris, lluvia de emojis, sacudida,
// destello). No tocan economia ni identidad. Nacen limitados a TikTok, donde
// la audiencia no tiene otra forma de interactuar con la pantalla; el streamer
// puede abrirlos a otras plataformas desde la seccion de Comandos.
//
// Cada efecto es un dato: `overlay` es la lista de mensajes que entiende
// overlay.html. Anadir un efecto nuevo no requiere tocar el Command Engine.

const EFFECT_CATEGORY = "Efectos"
const EFFECT_DEFAULT_PLATFORM = "tiktok"
// Por viewer. El streamer lo ajusta por comando desde la pantalla de Comandos.
const EFFECT_DEFAULT_COOLDOWN_SECONDS = 20
// Entre efectos de CUALQUIER viewer: sin esto un grupo apilaria animaciones y
// tapariamos el juego. Es un limite de seguridad, no configurable.
const EFFECT_GLOBAL_SPACING_MS = 3000

const LIVE_EFFECTS = Object.freeze([
  {
    name: "!fiesta", aliases: ["!party"], label: "Fiesta",
    description: "Confeti y arcoíris en pantalla.",
    overlay: [{ type: "confetti", duration: 6000 }, { type: "rainbow", duration: 6000 }],
  },
  {
    name: "!corazones", aliases: ["!hearts"], label: "Corazones",
    description: "Lluvia de corazones.",
    overlay: [{ type: "mimic_emoji_rain", emoji: "\u{1F496}", duration: 6000 }],
  },
  {
    name: "!fuego", aliases: ["!fire"], label: "Fuego",
    description: "Lluvia de fuego con destello naranja.",
    overlay: [
      { type: "mimic_flash", color: "#ff6a00", duration: 400 },
      { type: "mimic_emoji_rain", emoji: "\u{1F525}", duration: 6000 },
    ],
  },
  {
    name: "!estrellas", aliases: ["!stars"], label: "Estrellas",
    description: "Lluvia de estrellas.",
    overlay: [{ type: "mimic_emoji_rain", emoji: "\u{2B50}", duration: 6000 }],
  },
  {
    name: "!terremoto", aliases: ["!quake"], label: "Terremoto",
    description: "Sacude la pantalla.",
    overlay: [{ type: "mimic_shake", intensity: "strong", duration: 1500 }],
  },
  {
    name: "!flash", aliases: [], label: "Flash",
    description: "Destello blanco de pantalla completa.",
    overlay: [{ type: "mimic_flash", color: "#ffffff", duration: 500 }],
  },
])

const byCommand = new Map()
for (const effect of LIVE_EFFECTS) {
  byCommand.set(effect.name, effect)
  for (const alias of effect.aliases) byCommand.set(alias, effect)
}

function findLiveEffect(command) {
  return byCommand.get(String(command || "").toLowerCase()) || null
}

module.exports = {
  LIVE_EFFECTS, findLiveEffect,
  EFFECT_CATEGORY, EFFECT_DEFAULT_PLATFORM, EFFECT_DEFAULT_COOLDOWN_SECONDS, EFFECT_GLOBAL_SPACING_MS,
}
