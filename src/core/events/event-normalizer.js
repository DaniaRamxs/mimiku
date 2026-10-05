// Normaliza cualquier evento de plataforma al contrato interno de Mimiku.
// No conoce tmi.js, Twitch, Social Stream Ninja ni ninguna plataforma concreta:
// solo rellena defaults y valida la forma mínima del evento.
const REQUIRED_FIELDS = ["platform", "type"]

function normalizeEvent(input = {}) {
  for (const field of REQUIRED_FIELDS) {
    if (!input[field]) throw new Error(`Evento inválido: falta "${field}"`)
  }
  const actor = input.actor || {}
  const normalizedActor = {
    platformUserId: actor.platformUserId || "",
    username: actor.username || "",
    displayName: actor.displayName || actor.username || "",
    avatarUrl: actor.avatarUrl || "",
    isModerator: !!actor.isModerator,
  }
  // Las insignias son datos opcionales del adaptador. Conservamos VIP solo
  // cuando el origen lo marcó explícitamente para no cambiar el contrato
  // histórico de eventos que no tienen roles.
  if (actor.isVip === true) normalizedActor.isVip = true
  if (actor.isSubscriber === true) normalizedActor.isSubscriber = true

  // `payload` es opcional: solo lo llevan eventos que no son chat (gift, like,
  // follow...). Se omite cuando no existe para no alterar el contrato de chat.
  const payload = input.payload && typeof input.payload === "object" ? { payload: input.payload } : {}

  return {
    ...payload,
    id: input.id || null, // null = la plataforma de origen no dio un id fiable
    source: input.source || `${input.platform}-native`,
    platform: input.platform,
    type: input.type,
    actor: normalizedActor,
    message: input.message
      ? { text: input.message.text || "", emotes: input.message.emotes || [] }
      : null,
    metadata: input.metadata || {},
    reply: typeof input.reply === "function" ? input.reply : () => {},
    receivedAt: input.receivedAt || new Date().toISOString(),
  }
}

module.exports = { normalizeEvent }
