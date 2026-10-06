const { viewerIdentityKey } = require("../core/identity/viewer-identity.js")
const { isValidRankId } = require("./ranks.js")
const {
  LIVE_EFFECTS, EFFECT_CATEGORY, EFFECT_DEFAULT_PLATFORM, EFFECT_DEFAULT_COOLDOWN_SECONDS,
} = require("../core/interactions/live-effects.js")

const COMMANDS = [
  { name: "!puntos", aliases: [], category: "Economía", description: "Muestra el saldo del viewer." },
  { name: "!nivel", aliases: ["!level", "!xp"], category: "Progreso", description: "Muestra nivel, título y XP." },
  { name: "!ranking", aliases: [], category: "Economía", description: "Muestra el ranking local." },
  { name: "!daily", aliases: [], category: "Economía", description: "Recompensa diaria." },
  { name: "!work", aliases: [], category: "Economía", description: "Trabajo aleatorio con recompensa." },
  { name: "!depositar", aliases: ["!dep"], category: "Banco", description: "Mueve puntos al banco." },
  { name: "!retirar", aliases: ["!ret"], category: "Banco", description: "Retira puntos del banco." },
  { name: "!banco", aliases: ["!bank"], category: "Banco", description: "Consulta mano y banco." },
  { name: "!robar", aliases: ["!steal"], category: "Juegos", description: "Intenta robar a otro viewer de la misma plataforma." },
  { name: "!regalar", aliases: ["!regalarpuntos"], category: "Economía", description: "Regala puntos a otro viewer (ej: !regalar @amigo 5000). Comisión del 5 % y tope diario." },
  { name: "!ruleta", aliases: [], category: "Juegos", description: "Apuesta en ruleta." },
  { name: "!cofres", aliases: [], category: "Mimics", description: "Muestra cuantos cofres sin abrir tiene el viewer." },
  { name: "!abrircofre", aliases: ["!abrir"], category: "Mimics", description: "Abre cofres del inventario y entrega Mimics (opcional: cantidad)." },
  { name: "!ruletacofres", aliases: [], category: "Mimics", description: "Gira la ruleta de cofres (premio en cofres, no en puntos)." },
  { name: "!estado", aliases: ["!status"], category: "Fidelidad", description: "Pone tu avatar flotando en el Overlay 2 con tu estado (ej: !estado comiendo). !estado quitar lo retira.",
    defaultPlatform: "twitch", defaultCooldownSeconds: 20, defaultAllowedRanks: ["twitch:sub", "twitch:mod"] },
  { name: "!carcel", aliases: ["!jail"], category: "Fidelidad", description: "Encierra el avatar de @usuario en una celda del Overlay 2 (ej: !carcel @amigo).",
    defaultPlatform: "twitch", defaultCooldownSeconds: 60, defaultAllowedRanks: ["twitch:sub"] },
  { name: "!gachapon", aliases: [], category: "Gachapon", description: "Paga puntos y le sale un personaje al azar, que se muestra en el Overlay 3.",
    defaultCooldownSeconds: 10 },
  { name: "!robarpj", aliases: [], category: "Gachapon", description: "En los 15 segundos después de que a alguien le sale un personaje del gachapon, el primero que lo escribe se lo roba.",
    defaultPlatform: "twitch", defaultCooldownSeconds: 5, defaultAllowedRanks: ["twitch:vip", "twitch:mod", "twitch:sub"] },
  { name: "!regalarpj", aliases: ["!regalarpersonaje"], category: "Gachapon", description: "Regala un personaje tuyo del gachapon a otro viewer (ej: !regalarpj @amigo Dragon).",
    defaultCooldownSeconds: 10 },
  { name: "!prediccion", aliases: ["!predicción", "!pred"], category: "Predicciones", description: "Solo streamer y mods. Crea una predicción: !prediccion ¿Gano la partida? | Sí | No (de 2 a 4 respuestas; opcional: segundos al principio, ej. !prediccion 180 ...). Los viewers apuestan puntos en la página de canje.",
    defaultPlatform: "twitch" },
  { name: "!op1", aliases: ["!op2", "!op3", "!op4"], category: "Predicciones", description: "Solo streamer y mods. Elige la respuesta ganadora de la predicción (!op1 = primera respuesta, !op2 = segunda...) y reparte los puntos. Con las apuestas ya cerradas (!cerrarpred o al acabar el tiempo).",
    defaultPlatform: "twitch" },
  { name: "!cerrarpred", aliases: [], category: "Predicciones", description: "Solo streamer y mods. Cierra las apuestas de la predicción antes de que se acabe el tiempo.", defaultPlatform: "twitch" },
  { name: "!cancelarpred", aliases: [], category: "Predicciones", description: "Solo streamer y mods. Cancela la predicción y devuelve todos los puntos apostados.", defaultPlatform: "twitch" },
  { name: "!claim", aliases: [], category: "Fidelidad", description: "Sella la tarjeta de fidelidad semanal (una vez por directo).", defaultPlatform: "twitch" },
  { name: "!slots", aliases: ["!tragamonedas"], category: "Juegos", description: "Juega a tragamonedas." },
  { name: "!plinko", aliases: [], category: "Juegos", description: "Suelta una bola en el Plinko (mismo precio y premios que en la página de canje).",
    defaultPlatform: "twitch", defaultCooldownSeconds: 4, defaultAllowedRanks: ["twitch:vip", "twitch:mod", "twitch:sub"] },
  { name: "!bj", aliases: ["!blackjack"], category: "Juegos", description: "Entra a Blackjack." },
  { name: "!hit", aliases: [], category: "Juegos", description: "Pide carta en Blackjack." },
  { name: "!stand", aliases: ["!plantarse"], category: "Juegos", description: "Se planta en Blackjack." },
  { name: "!duelo", aliases: ["!duel"], category: "Juegos", description: "Desafía a otro viewer." },
  { name: "!moneda", aliases: ["!coin", "!caracruz"], category: "Juegos", description: "Apuesta a cara o cruz." },
  { name: "!atacar", aliases: [], category: "Eventos", description: "Ataca al boss activo." },
  { name: "!boleto", aliases: [], category: "Eventos", description: "Compra un boleto de lotería." },
  { name: "!confeti", aliases: ["!confetti"], category: "Tienda", description: "Compra confeti para el overlay." },
  { name: "!arcoiris", aliases: ["!rainbow"], category: "Tienda", description: "Compra un arcoíris para el overlay." },
  { name: "!misterio", aliases: ["!mystery"], category: "Tienda", description: "Activa un evento misterioso." },
  { name: "!info", aliases: [], category: "Ayuda", description: "Muestra los comandos configurados para VIPs." },
  { name: "!comandos", aliases: ["!cmds"], category: "Ayuda", description: "Lista comandos disponibles." },
  // Efectos de directo: gratis, solo animaciones. Nacen exclusivos de TikTok.
  ...LIVE_EFFECTS.map(effect => ({
    name: effect.name, aliases: effect.aliases, category: EFFECT_CATEGORY, description: effect.description,
    defaultPlatform: EFFECT_DEFAULT_PLATFORM, defaultCooldownSeconds: EFFECT_DEFAULT_COOLDOWN_SECONDS,
  })),
]

const PLATFORM_SCOPES = new Set(["all", "twitch", "youtube", "tiktok", "kick"])

// Rangos calificados por plataforma ("tiktok:superfan"). Lista vacia = sin filtro de rango.
function normalizeAllowedRanks(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isValidRankId))]
}

// `rankResolver(event)` devuelve los rangos calificados del autor del evento.
function createCommandConfigService(platform, getChannel, { now = Date.now, rankResolver = () => [] } = {}) {
  const uses = new Map()

  function load() { return platform.moderation.getConfig(getChannel(), "commands") || {} }
  function find(command) {
    const normalized = String(command || "").toLowerCase()
    return COMMANDS.find(item => item.name === normalized || item.aliases.includes(normalized))
  }
  function settingsFor(command) {
    const item = find(command)
    if (!item) return null
    const saved = load()[item.name] || {}
    return {
      ...item,
      enabled: saved.enabled !== false,
      platform: PLATFORM_SCOPES.has(saved.platform) ? saved.platform : (item.defaultPlatform || "all"),
      cooldownSeconds: Math.min(3600, Math.max(0, Number(saved.cooldownSeconds ?? item.defaultCooldownSeconds) || 0)),
      allowedRanks: normalizeAllowedRanks(saved.allowedRanks === undefined ? item.defaultAllowedRanks : saved.allowedRanks),
    }
  }
  function list() { return COMMANDS.map(item => settingsFor(item.name)) }
  function update(command, updates = {}) {
    const item = find(command)
    if (!item) throw new Error("Comando desconocido")
    const current = load()
    // Base = lo vigente (guardado o por defecto), para que editar un solo campo
    // de un efecto no le quite su plataforma/cooldown por defecto.
    const previous = settingsFor(item.name)
    current[item.name] = {
      enabled: updates.enabled === undefined ? previous.enabled : updates.enabled === true,
      platform: PLATFORM_SCOPES.has(updates.platform) ? updates.platform : previous.platform,
      cooldownSeconds: Math.min(3600, Math.max(0, Number(updates.cooldownSeconds ?? previous.cooldownSeconds) || 0)),
      allowedRanks: updates.allowedRanks === undefined
        ? previous.allowedRanks
        : normalizeAllowedRanks(updates.allowedRanks),
    }
    platform.moderation.setConfig(getChannel(), "commands", current)
    return settingsFor(item.name)
  }
  function isEnabled(command, eventPlatform) {
    const settings = settingsFor(command)
    if (!settings) return true
    return settings.enabled && (settings.platform === "all" || settings.platform === eventPlatform)
  }
  function evaluate(command, event) {
    const settings = settingsFor(command)
    if (!settings) return { allowed: true, remainingMs: 0 }
    if (!isEnabled(command, event.platform)) return { allowed: false, disabled: true, remainingMs: 0 }
    // El rango se comprueba ANTES del cooldown: quien no tiene acceso no consume turno.
    if (settings.allowedRanks.length) {
      const held = rankResolver(event)
      if (!settings.allowedRanks.some(rank => held.includes(rank))) {
        return { allowed: false, rankDenied: true, requiredRanks: settings.allowedRanks, remainingMs: 0 }
      }
    }
    if (!settings.cooldownSeconds) return { allowed: true, remainingMs: 0 }
    const key = `${settings.name}:${viewerIdentityKey({ ...event.actor, platform: event.platform })}`
    const usedAt = uses.get(key)
    if (usedAt === undefined) return { allowed: true, remainingMs: 0, key }
    const remainingMs = Math.max(0, settings.cooldownSeconds * 1000 - (now() - usedAt))
    return { allowed: remainingMs === 0, remainingMs, key }
  }
  function record(command, event) {
    const decision = evaluate(command, event)
    if (decision.key && decision.allowed) uses.set(decision.key, now())
  }
  return { list, update, isEnabled, evaluate, record }
}


let defaultService = null
function service() {
  if (!defaultService) {
    defaultService = createCommandConfigService(
      require("./local-runtime.js").getLocalPlatform(),
      () => require("./currentChannel.js").get(),
      { rankResolver: event => require("./ranks.js").getDefaultRankService().getEventRanks(event) },
    )
  }
  return defaultService
}

module.exports = {
  COMMANDS,
  createCommandConfigService,
  list: (...args) => service().list(...args),
  update: (...args) => service().update(...args),
  isEnabled: (...args) => service().isEnabled(...args),
  evaluate: (...args) => service().evaluate(...args),
  record: (...args) => service().record(...args),
}
