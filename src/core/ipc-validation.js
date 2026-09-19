function plainObject(value, name = "datos") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} inválidos`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${name} inválidos`)
  return value
}

function text(value, { name = "texto", max = 500, required = false } = {}) {
  const result = typeof value === "string" ? value.trim().slice(0, max) : ""
  if (required && !result) throw new Error(`${name} requerido`)
  return result
}

function integer(value, { name = "valor", min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} inválido`)
  return result
}

function twitchChannel(value) {
  const result = text(value, { name: "canal", max: 25, required: true })
    .replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, "")
  if (!result) throw new Error("Canal de Twitch inválido")
  return result
}

function configUpdates(value) {
  const input = plainObject(value, "configuración")
  const output = {}
  if (input.onboarding && typeof input.onboarding === "object") {
    output.onboarding = { completed: input.onboarding.completed === true }
  }
  if (input.workspace && typeof input.workspace === "object") {
    output.workspace = {
      id: text(input.workspace.id, { max: 80 }),
      name: text(input.workspace.name, { max: 80 }),
    }
  }
  if (input.streamer && typeof input.streamer === "object") {
    output.streamer = {
      displayName: text(input.streamer.displayName, { max: 80 }),
      twitchChannel: text(input.streamer.twitchChannel, { max: 25 }),
    }
  }
  if (input.integrations && typeof input.integrations === "object") {
    output.integrations = {}
    if (input.integrations.legacySupabase && typeof input.integrations.legacySupabase === "object") {
      output.integrations.legacySupabase = {
        enabled: input.integrations.legacySupabase.enabled === true,
        url: text(input.integrations.legacySupabase.url, { max: 500 }),
      }
      const key = text(input.integrations.legacySupabase.anonKey, { max: 4096 })
      if (key) output.integrations.legacySupabase.anonKey = key
    }
    if (input.integrations.tiktok && typeof input.integrations.tiktok === "object") {
      output.integrations.tiktok = {
        enabled: input.integrations.tiktok.enabled === true,
        username: text(input.integrations.tiktok.username, { max: 40 }),
        autoReconnect: input.integrations.tiktok.autoReconnect !== false,
        sendReplies: input.integrations.tiktok.sendReplies === true,
      }
    }
  }
  return output
}

module.exports = { plainObject, text, integer, twitchChannel, configUpdates }
