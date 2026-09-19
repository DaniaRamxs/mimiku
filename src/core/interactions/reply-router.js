function createReplyRouter({ notifyLocal = () => {} } = {}) {
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
    return { delivered: "local" }
  }

  return { send }
}

module.exports = { createReplyRouter }
