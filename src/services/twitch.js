// services/twitch.js — punto de entrada público de la integración de Twitch.
//
// Este archivo ya NO contiene lógica de comandos ni de sound triggers (Fase
// 0) y ya NO registra Command Engine / Sound Trigger Engine (Fase 1: ese
// registro se movió a overlay-server.js#start(), que corre siempre al
// arrancar Mimiku, se conecte o no Twitch — así una instalación que solo usa
// Social Stream Ninja también tiene comandos y sonidos funcionando). Aquí
// solo queda el cableado del adaptador de Twitch al Event Engine compartido.
// main.cjs y el resto de servicios siguen requiriendo este archivo
// exactamente igual que antes — la API pública no cambió.
const twitchAdapter = require("../integrations/twitch/twitch-adapter.js")
const { getDefaultEventEngine } = require("../core/events/event-engine.js")

twitchAdapter.setEventEngine(getDefaultEventEngine())

module.exports = {
  connect: twitchAdapter.connect,
  disconnect: twitchAdapter.disconnect,
  setWindow: twitchAdapter.setWindow,
  setBroadcast: twitchAdapter.setBroadcast,
  say: twitchAdapter.say,
  getActiveViewers: twitchAdapter.getActiveViewers,
  startMiniChallenge: twitchAdapter.startMiniChallenge,
  getStatus: twitchAdapter.getStatus,
  getRedemptionsStatus: twitchAdapter.getRedemptionsStatus,
}
