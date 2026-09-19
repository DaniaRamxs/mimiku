// Sound Trigger Engine: consume eventos Mimiku normalizados de tipo
// "chat_message" y decide si el texto dispara un sonido local configurado
// por el streamer. No sabe si el mensaje vino de tmi.js, Social Stream Ninja,
// YouTube o TikTok — solo mira event.platform y la configuración del trigger.
//
// La lógica real de matching/cooldown/reproducción sigue viviendo en
// src/services/emoteSounds.js (no se duplica); este módulo es la capa de
// enganche con el Event Engine, extraída de src/services/twitch.js.
//
// emoteSounds.js se importa de forma perezosa (solo cuando llega un evento
// real, no al cargar este archivo) para no arrastrar su dependencia de
// Electron en contextos donde este motor se prueba de forma aislada.

function createSoundTriggerEngine(overrides = {}) {
  const triggerFromText = overrides.onMessage || defaultOnMessage

  function defaultOnMessage(text, platform) {
    return require("../../services/emoteSounds.js").onMessage(text, platform)
  }

  function handle(event) {
    const text = event.message && event.message.text
    if (!text) return
    if (text.trim().startsWith("!")) return // los comandos no disparan sonidos, igual que hoy
    triggerFromText(text, event.platform)
  }

  return { handle }
}

function registerSoundTriggerEngine(eventEngine, overrides = {}) {
  const engine = createSoundTriggerEngine(overrides)
  eventEngine.subscribe("chat_message", engine.handle)
  return engine
}

module.exports = { createSoundTriggerEngine, registerSoundTriggerEngine }
