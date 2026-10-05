// services/canje.js — ajustes y arranque de la pagina de canje (ver canje-server.js).
//
// Todo vive en esta PC: la pagina, los datos y los canjes. ngrok solo abre un
// tunel desde internet hasta el puerto del servidor de canje.
// Nada de esto es secreto: el Client ID de Twitch es publico por diseno.
const SETTINGS_KEY = "canje_config_v2"
const DEFAULT_PORT = 7780
const DEFAULTS = Object.freeze({ enabled: false, port: DEFAULT_PORT, clientId: "", publicUrl: "" })
const RESERVED_PORTS = [7777, 7778] // overlay: no debe quedar detras del tunel

function cleanPublicUrl(value) {
  const text = String(value || "").trim()
  if (!text) return ""
  let parsed
  try { parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`) } catch { throw new Error("La dirección pública no es válida") }
  if (parsed.protocol !== "https:") throw new Error("La dirección pública debe empezar con https://")
  return parsed.origin
}

function cleanPort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("El puerto debe estar entre 1024 y 65535")
  if (RESERVED_PORTS.includes(port)) throw new Error("Ese puerto es del overlay: usa otro (por ejemplo 7780)")
  return port
}

function cleanClientId(value) {
  const text = String(value || "").trim()
  if (text && !/^[a-z0-9]{10,64}$/i.test(text)) throw new Error("El Client ID de Twitch no parece válido")
  return text
}

function createCanje({ getDatabase, createServer, log = console }) {
  let server = null
  let runningPort = null
  let lastError = ""

  function readConfig() {
    const raw = getDatabase().prepare("SELECT value FROM settings WHERE key=?").get(SETTINGS_KEY)?.value
    try { return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) } } catch { return { ...DEFAULTS } }
  }

  function writeConfig(config) {
    getDatabase().prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SETTINGS_KEY, JSON.stringify(config))
  }

  function getSettings() {
    const config = readConfig()
    const domain = config.publicUrl ? new URL(config.publicUrl).host : "TU-DOMINIO.ngrok-free.app"
    return {
      ...config,
      link: config.publicUrl ? `${config.publicUrl}/` : "",
      // Lo que hay que registrar en la app de Twitch como "OAuth Redirect URL".
      redirectUrl: config.publicUrl ? `${config.publicUrl}/` : "",
      ngrokCommand: `ngrok http --url=${domain} ${config.port}`,
      status: { running: !!server, port: runningPort, error: lastError },
    }
  }

  async function stop() {
    if (server) await server.stop()
    server = null
    runningPort = null
  }

  async function start() {
    await stop()
    const config = readConfig()
    lastError = ""
    if (!config.enabled) return false
    if (!config.clientId) { lastError = "Falta el Client ID de Twitch"; return false }
    const next = createServer(() => readConfig())
    try {
      runningPort = await next.start(config.port)
      server = next
      return true
    } catch (error) {
      lastError = error.code === "EADDRINUSE" ? `El puerto ${config.port} está ocupado` : error.message
      log.error("[canje]", lastError)
      return false
    }
  }

  async function saveSettings(input = {}) {
    writeConfig({
      enabled: input.enabled === true,
      port: cleanPort(input.port ?? DEFAULT_PORT),
      clientId: cleanClientId(input.clientId),
      publicUrl: cleanPublicUrl(input.publicUrl),
    })
    await start()
    return getSettings()
  }

  return { getSettings, saveSettings, start, stop }
}

// Clave para firmar las sesiones de los viewers: se crea la primera vez y se
// guarda cifrada. Si el cifrado no esta disponible vive solo en memoria y las
// sesiones duran hasta que se cierre Mimiku.
const SESSION_KEY_SECRET = "canje_session_key"
function sessionKey() {
  const store = require("./secret-store.js").getDefaultSecretStore()
  let key = store.getSecret(SESSION_KEY_SECRET)
  if (!key) {
    key = require("node:crypto").randomBytes(32).toString("hex")
    store.setSecret(SESSION_KEY_SECRET, key)
  }
  return key
}

let defaultCanje = null
function getDefaultCanje() {
  if (!defaultCanje) {
    defaultCanje = createCanje({
      getDatabase: () => require("./db.js").getDb(),
      createServer: getConfig => {
        const path = require("node:path")
        const { app } = require("electron")
        const { createCanjeServer, createTwitchValidator, createSessionSigner } = require("./canje-server.js")
        const { createCanjeData } = require("./canje-data.js")
        const { createCanjeGacha } = require("./canje-gacha.js")
        const { createCanjeGames } = require("./canje-games.js")
        const { createCanjeEffects } = require("./canje-effects.js")
        const { createCanjePass } = require("./canje-pass.js")
        const { createCanjeSupport } = require("./canje-support.js")
        const { createCanjeProfiles } = require("./canje-profiles.js")
        const { createCanjeLive, createStealPermission } = require("./canje-live.js")
        const { createCanjeRewards } = require("./canje-rewards.js")
        const feed = require("./live-feed.js").getDefaultLiveFeed()
        const { createTwitchSubs } = require("./twitch-subs.js")
        const getChannel = () => require("./currentChannel.js").get()
        const platform = require("./local-runtime.js").getLocalPlatform()
        // Comunidad: portada en vivo y logros (cada jugada del tablon suma a los logros).
        const community = require("./community.js").createCommunity({
          platform, getChannel,
          isSub: viewerId => require("./twitch-subs.js").subStatus(platform, String(getChannel() || "local").toLowerCase(), viewerId).sub,
          getChatters: () => require("./levels.js").activeChatters(),
        })
        feed.subscribe("community", (channelId, event) => community.track(channelId, event))
        const broadcasterLogin = () => String(require("./app-config.js").getAppConfig().streamer.twitchChannel || getChannel() || "").toLowerCase()
        return createCanjeServer({
          community,
          // Posts, Novedades y Buzon: publica solo la cuenta de Twitch del canal.
          posts: require("./canje-posts.js").createCanjePosts({
            platform, getChannel,
            isStreamer: login => !!login && String(login).toLowerCase() === broadcasterLogin(),
            isSub: viewer => require("./twitch-subs.js").subStatus(platform, String(getChannel() || "local").toLowerCase(), viewer.id).sub
              || require("./seen-badges.js").getDefaultSeenBadges().get(viewer.platform_user_id).isSubscriber,
          }),
          data: createCanjeData({ platform, getChannel }),
          gacha: createCanjeGacha({ platform, getChannel, gachapon: require("./gachapon.js").getDefaultGachapon() }),
          games: createCanjeGames({ platform, getChannel, feed, gachapon: require("./gachapon.js").getDefaultGachapon() }),
          rewards: createCanjeRewards({
            platform, getChannel,
            economy: require("./economy.js"),
            loyalty: require("./loyalty.js").getDefaultLoyaltyService(),
            broadcast: payload => require("./overlay-server.js").broadcast(payload),
            // Sub verificado con el Pase Sub, o insignia de sub vista en el chat.
            isSub: viewer => require("./twitch-subs.js").subStatus(platform, String(getChannel() || "local").toLowerCase(), viewer.id).sub
              || require("./seen-badges.js").getDefaultSeenBadges().get(viewer.platform_user_id).isSubscriber,
            canRob: createStealPermission({
              command: "!robar",
              evaluate: (command, event) => require("./command-config.js").evaluate(command, event),
              badges: require("./seen-badges.js").getDefaultSeenBadges(),
              isSub: viewerId => require("./twitch-subs.js").subStatus(platform, String(getChannel() || "local").toLowerCase(), viewerId).sub,
            }),
          }),
          live: createCanjeLive({
            platform, getChannel, feed,
            gachapon: require("./gachapon.js").getDefaultGachapon(),
            canSteal: createStealPermission({
              evaluate: (command, event) => require("./command-config.js").evaluate(command, event),
              badges: require("./seen-badges.js").getDefaultSeenBadges(),
              isSub: viewerId => require("./twitch-subs.js").subStatus(platform, String(getChannel() || "local").toLowerCase(), viewerId).sub,
            }),
          }),
          effects: createCanjeEffects({ platform, getChannel }),
          pass: createCanjePass({ platform, getChannel }),
          support: createCanjeSupport({ platform, getChannel }),
          profiles: createCanjeProfiles({
            platform, getChannel, community,
            fetchAvatar: login => require("./twitch-avatars.js").getDefaultTwitchAvatars().getAvatar(login),
          }),
          subs: createTwitchSubs({
            platform, getChannel,
            getClientId: () => getConfig().clientId,
            getBroadcasterLogin: () => require("./app-config.js").getAppConfig().streamer.twitchChannel || getChannel(),
          }),
          validator: createTwitchValidator({ getClientId: () => getConfig().clientId }),
          sessions: createSessionSigner({ getKey: sessionKey }),
          getConfig: () => ({ ...getConfig(), channelDisplay: require("./app-config.js").getAppConfig().streamer.twitchChannel || getChannel() }),
          assetDir: path.join(app.getPath("userData"), "assets"),
        })
      },
    })
  }
  return defaultCanje
}

module.exports = { createCanje, getDefaultCanje, cleanPublicUrl, cleanPort, cleanClientId, DEFAULT_PORT }
