// Social Stream Ninja Adapter — fuente OPCIONAL y de SOLO LECTURA.
//
// Responsabilidad única: payload de SSN → normalizar → emitir al Event
// Engine. No importa ni llama a Command Engine, Sound Trigger Engine,
// economy, Mimics, levels, profiles, widgets, overlays, VTube Studio, shop
// ni Arena. Solo conoce el Event Engine y su propio estado en memoria.
//
// Ver docs/social-stream-ninja-audit.md para el porqué del protocolo elegido
// (postserver, sin relay cloud, sin sendChat) y docs/social-stream-ninja-integration.md
// para la documentación de esta implementación.

// Tabla explícita de normalización de plataforma (raw SSN `type` → Mimiku `platform`).
// "twitch", "youtube" y "kick" están confirmados por el fixture real de
// api.md citado en la auditoría. "tiktok" NO tiene un fixture confirmado en
// la auditoría — es el slug más probable dado el patrón del resto de
// plataformas de SSN, pero debe verificarse contra un payload real antes de
// confiar en él para triggers o comandos críticos.
const PLATFORM_ALIASES = {
  twitch: "twitch", // confirmado (api.md)
  youtube: "youtube", // confirmado (api.md)
  kick: "kick", // mencionado en api.md como ejemplo de `type`
  tiktok: "tiktok", // NO confirmado por fixture — mejor suposición, ver nota arriba
}

const LIMITS = { text: 500, name: 100, url: 1000, id: 200, badge: 60, maxBadges: 20, membership: 200, donation: 100 }

function truncate(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function normalizePlatform(rawType) {
  const key = truncate(rawType, 30).toLowerCase()
  if (!key) return { platform: null, rawPlatform: "" }
  const known = PLATFORM_ALIASES[key]
  return { platform: known || "unknown", rawPlatform: key }
}

function normalizeBadges(rawBadges) {
  if (!Array.isArray(rawBadges)) return []
  return rawBadges
    .slice(0, LIMITS.maxBadges)
    .map(badge => truncate(typeof badge === "string" ? badge : JSON.stringify(badge), LIMITS.badge))
    .filter(Boolean)
}

function hasVipBadge(rawBadges) {
  if (!Array.isArray(rawBadges)) return false
  return rawBadges.some(badge => String(typeof badge === "string" ? badge : JSON.stringify(badge))
    .toLowerCase().includes("vip"))
}

// Convierte un payload crudo de Social Stream Ninja (canal 4 / `postserver`)
// al contrato interno de Mimiku. Nunca lanza: devuelve { event } o
// { rejected: "motivo" }. No evalúa HTML/JS del payload — todo se trata como
// texto plano y se trunca.
function normalizeSsnPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { rejected: "el payload no es un objeto JSON" }
  }

  const { platform, rawPlatform } = normalizePlatform(raw.type)
  if (!platform) return { rejected: 'falta "type" (plataforma de origen)' }

  const text = truncate(raw.chatmessage, LIMITS.text)
  if (!text) return { rejected: 'falta "chatmessage" (sin texto de chat no hay evento que procesar en esta fase)' }

  const username = truncate(raw.chatname, LIMITS.name) || "anon"
  // Prioridad 1: userid de SSN. Si falta, se deja vacío — el modelo de
  // identidad existente (local-platform.js) ya sabe degradar de forma segura
  // a un id "legacy:<username>" ESCOPADO POR PLATAFORMA, sin fusionar
  // usernames iguales de plataformas distintas. No se inventa aquí ningún
  // id permanente propio.
  const platformUserId = truncate(raw.userid, 160)

  const metadata = {
    badges: normalizeBadges(raw.chatbadges),
    membership: truncate(raw.membership, LIMITS.membership) || null,
    donation: truncate(raw.hasDonation, LIMITS.donation) || null,
    capabilities: { reply: false },
  }
  if (rawPlatform && platform !== rawPlatform) metadata.ssn = { rawPlatform }

  const event = {
    id: truncate(raw.id, LIMITS.id) || null,
    source: "social-stream-ninja",
    platform,
    type: "chat_message",
    actor: {
      platformUserId,
      username,
      displayName: username,
      avatarUrl: truncate(raw.chatimg, LIMITS.url),
      isModerator: raw.moderator === true,
      ...(raw.vip === true || raw.vip === "true" || raw.isvip === true || hasVipBadge(raw.chatbadges) ? { isVip: true } : {}),
    },
    message: { text, emotes: [] },
    metadata,
    // Fase 1 es solo de entrada: no hay canal de salida seguro hacia SSN
    // todavía (ver docs/social-stream-ninja-integration.md, §"Sin salida").
    // `reply` no se asigna aquí: event-normalizer.js ya la sustituye por un
    // no-op si falta, así que un comando puede ejecutar su efecto (dar
    // puntos, etc.) aunque no pueda "hablar" de vuelta por este canal.
  }

  return { event }
}

function createSocialStreamNinjaAdapter(overrides = {}) {
  const eventEngine = overrides.eventEngine || require("../../core/events/event-engine.js").getDefaultEventEngine()
  const state = overrides.state || require("./social-stream-ninja-state.js").getDefaultSocialStreamNinjaState()

  function handlePayload(raw) {
    const { event, rejected } = normalizeSsnPayload(raw)
    if (rejected) {
      state.recordRejected(rejected)
      return { accepted: false, reason: rejected }
    }
    const result = eventEngine.emit(event)
    state.recordReceived(event.platform)
    return { accepted: true, duplicate: result.duplicate }
  }

  return { handlePayload }
}

let defaultAdapter = null
function getDefaultSocialStreamNinjaAdapter() {
  if (!defaultAdapter) defaultAdapter = createSocialStreamNinjaAdapter()
  return defaultAdapter
}

module.exports = {
  createSocialStreamNinjaAdapter,
  getDefaultSocialStreamNinjaAdapter,
  normalizeSsnPayload,
  hasVipBadge,
  PLATFORM_ALIASES,
}
