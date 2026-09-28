// Plataformas cuyo chat no admite respuestas nativas de Mimiku (TikTok exige un
// plan de pago de terceros): su respuesta tambien se muestra en el overlay para
// que la vea la audiencia del directo, no solo el streamer en el Dashboard.
const OVERLAY_REPLY_PLATFORMS = new Set(["tiktok"])
const OVERLAY_REPLY_MAX_CHARS = 110
const OVERLAY_REPLY_MS = 6000

function createReplyRouter({ notifyLocal = () => {}, showOnOverlay = () => {} } = {}) {
  function send(event, message) {
    const text = typeof message === "string" ? message.slice(0, 1000) : String(message || "").slice(0, 1000)
    // Una capacidad declarada manda: el normalizador pone SIEMPRE una funcion
    // reply (vacia si el adaptador no dio una), asi que sin esto un adaptador que
    // dice "no puedo responder" (TikTok) tiraria sus respuestas en silencio.
    const declared = event?.metadata?.capabilities?.reply
    const canReply = declared === true || (
      declared !== false && event?.source !== "social-stream-ninja" && typeof event?.reply === "function"
    )
    if (canReply && typeof event.reply === "function") {
      event.reply(text)
      return { delivered: "native" }
    }
    notifyLocal({
      platform: event?.platform || "unknown",
      username: event?.actor?.username || "",
      text,
    })
    if (OVERLAY_REPLY_PLATFORMS.has(event?.platform)) {
      const oneLine = text.replace(/\s+/g, " ").trim()
      const shown = oneLine.length > OVERLAY_REPLY_MAX_CHARS ? oneLine.slice(0, OVERLAY_REPLY_MAX_CHARS - 3) + "..." : oneLine
      if (shown) showOnOverlay({ type: "reply_toast", text: shown, duration: OVERLAY_REPLY_MS })
    }
    return { delivered: "local" }
  }

  return { send }
}

module.exports = { createReplyRouter }
