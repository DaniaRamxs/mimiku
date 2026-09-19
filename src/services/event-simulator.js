const { randomUUID } = require("node:crypto")

const SUPPORTED_PLATFORMS = new Set(["twitch", "youtube", "tiktok"])

function createEventSimulator({ eventEngine, getChannel, createId = randomUUID, now = () => new Date() }) {
  function simulate({ platform, text }) {
    const normalizedPlatform = String(platform || "").toLowerCase()
    const message = String(text || "").trim().slice(0, 300)
    if (!SUPPORTED_PLATFORMS.has(normalizedPlatform)) throw new Error("Plataforma de prueba no permitida")
    if (!message) throw new Error("Escribe un mensaje de prueba")
    const result = eventEngine.emit({
      id: `simulation:${createId()}`,
      source: "mimiku-simulator",
      platform: normalizedPlatform,
      type: "chat_message",
      actor: {
        platformUserId: "mimiku-test-viewer",
        username: "mimiku_test",
        displayName: "Viewer de prueba",
      },
      message: { text: message, emotes: [] },
      metadata: {
        channel: getChannel(),
        simulated: true,
        capabilities: { reply: false },
      },
      receivedAt: now().toISOString(),
    })
    return { delivered: result.delivered, duplicate: result.duplicate, handled: result.handled, platform: normalizedPlatform }
  }

  return { simulate }
}

let defaultSimulator = null
function getDefaultEventSimulator() {
  if (!defaultSimulator) {
    defaultSimulator = createEventSimulator({
      eventEngine: require("../core/events/event-engine.js").getDefaultEventEngine(),
      getChannel: () => require("./currentChannel.js").get(),
    })
  }
  return defaultSimulator
}

module.exports = { SUPPORTED_PLATFORMS, createEventSimulator, getDefaultEventSimulator }
