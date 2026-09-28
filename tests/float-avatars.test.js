const test = require("node:test")
const assert = require("node:assert/strict")

const { createFloatAvatars, sanitizeStatus, isRemoveRequest, viewerKey, normalizeFloatAvatars } = require("../src/services/float-avatars.js")
const { createTwitchAvatars } = require("../src/services/twitch-avatars.js")
const { createTwitchHelix } = require("../src/services/twitch-helix.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")
const { createCommandConfigService } = require("../src/services/command-config.js")

const CONFIG = { enabled: true, status_max: 40 }

function identity(overrides = {}) {
  return { platform: "twitch", platformUserId: "42", username: "emiligatita", displayName: "emiligatita", avatarUrl: "", ...overrides }
}

// ── Texto del estado ─────────────────────────────────────────────────────────
test("el estado se limpia: sin enlaces, sin saltos y con longitud maxima", () => {
  assert.equal(sanitizeStatus("  comiendo   pizza \n rica "), "comiendo pizza rica")
  assert.equal(sanitizeStatus("mira https://spam.example/x ya"), "mira ya")
  assert.equal(sanitizeStatus("entra a www.spam.com"), "entra a")
  assert.equal(sanitizeStatus("visita spam.tv/abc ahora"), "visita ahora")
  assert.equal(sanitizeStatus("a".repeat(100), 40).length, 40)
  assert.equal(sanitizeStatus("https://solo-un-enlace.com"), "")
})

test("quitar / off / borrar retiran el avatar", () => {
  for (const word of ["quitar", "OFF", "borrar", " salir "]) assert.equal(isRemoveRequest(word), true)
  assert.equal(isRemoveRequest("comiendo"), false)
})

test("la clave del avatar separa plataformas", () => {
  assert.notEqual(viewerKey(identity()), viewerKey(identity({ platform: "tiktok" })))
})

// ── Servicio ─────────────────────────────────────────────────────────────────
function service({ config = CONFIG, avatar = "https://cdn.example/emi.png" } = {}) {
  const sent = []
  const lookups = []
  const floats = createFloatAvatars({
    getConfig: () => config,
    getAvatar: async who => { lookups.push(who.username); return avatar },
    broadcast: payload => sent.push(payload),
  })
  return { floats, sent, lookups }
}

test("!estado manda al overlay la foto de Twitch, el nombre y el estado", async () => {
  const { floats, sent, lookups } = service()
  const result = await floats.show(identity(), "comiendo", "#FF00AA")
  assert.equal(result.ok, true)
  assert.deepEqual(lookups, ["emiligatita"])
  assert.deepEqual(sent[0], {
    type: "float_avatar", key: "twitch:42", name: "emiligatita",
    avatar: "https://cdn.example/emi.png", color: "#FF00AA", status: "comiendo",
  })
})

test("sin foto disponible sale igual (con la inicial en el overlay)", async () => {
  const { floats, sent } = service({ avatar: null })
  await floats.show(identity(), "durmiendo")
  assert.equal(sent[0].avatar, null)
})

test("si el evento ya trae la foto no se consulta a Twitch", async () => {
  const { floats, lookups, sent } = service()
  await floats.show(identity({ avatarUrl: "https://ya.example/a.png" }), "hola")
  assert.deepEqual(lookups, [])
  assert.equal(sent[0].avatar, "https://ya.example/a.png")
})

test("un estado que solo era un enlace no se muestra", async () => {
  const { floats, sent } = service()
  const result = await floats.show(identity(), "https://spam.com")
  assert.equal(result.reason, "empty")
  assert.equal(sent.length, 0)
})

test("desactivado no muestra nada", async () => {
  const { floats, sent } = service({ config: { enabled: false, status_max: 40 } })
  assert.equal((await floats.show(identity(), "hola")).reason, "disabled")
  assert.equal(sent.length, 0)
})

test("quitar manda la orden de retirar ese avatar", () => {
  const { floats, sent } = service()
  floats.remove(identity())
  assert.deepEqual(sent, [{ type: "float_avatar_remove", key: "twitch:42" }])
})

test("la configuracion se limpia", () => {
  const config = normalizeFloatAvatars({ duration_s: 99999, size: 1, speed: "x", theme: "raro", collisions: false })
  assert.equal(config.duration_s, 600)
  assert.equal(config.size, 40)
  assert.equal(config.speed, 140)
  assert.equal(config.theme, "noche")
  assert.equal(config.collisions, false)
})

// ── Foto de Twitch ───────────────────────────────────────────────────────────
function fakeHelix(responses) {
  const calls = []
  return {
    calls,
    helix: {
      hasToken: () => true,
      get: async path => {
        calls.push(path)
        const next = responses.shift()
        if (next instanceof Error) throw next
        return next
      },
    },
  }
}

test("busca la foto en Helix una vez y la recuerda", async () => {
  const { helix, calls } = fakeHelix([{ data: [{ profile_image_url: "https://static-cdn.example/emi.png" }] }])
  const remembered = []
  const avatars = createTwitchAvatars({ helix, remember: (login, url) => remembered.push([login, url]) })
  assert.equal(await avatars.getAvatar("EmiliGatita"), "https://static-cdn.example/emi.png")
  assert.equal(await avatars.getAvatar("emiligatita"), "https://static-cdn.example/emi.png")
  assert.deepEqual(calls, ["users?login=emiligatita"])
  assert.deepEqual(remembered, [["emiligatita", "https://static-cdn.example/emi.png"]])
})

test("si Helix falla devuelve null y no reintenta enseguida", async () => {
  let clock = 0
  const { helix, calls } = fakeHelix([new Error("401"), { data: [{ profile_image_url: "https://x.example/a.png" }] }])
  const avatars = createTwitchAvatars({ helix, now: () => clock })
  assert.equal(await avatars.getAvatar("luna"), null)
  assert.equal(await avatars.getAvatar("luna"), null)
  assert.equal(calls.length, 1)
  clock = 11 * 60 * 1000
  assert.equal(await avatars.getAvatar("luna"), "https://x.example/a.png")
})

test("nombres de usuario invalidos no se consultan", async () => {
  const { helix, calls } = fakeHelix([])
  const avatars = createTwitchAvatars({ helix })
  assert.equal(await avatars.getAvatar("../../hack"), null)
  assert.equal(calls.length, 0)
})

test("twitch-helix valida el token una vez y usa su client_id", async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers })
    return { ok: true, json: async () => (url.includes("validate") ? { client_id: "cid" } : { data: [] }) }
  }
  const helix = createTwitchHelix({ getToken: () => "oauth:abc", fetchImpl })
  await helix.get("users?login=a")
  await helix.get("users?login=b")
  assert.equal(calls.filter(call => call.url.includes("validate")).length, 1)
  assert.equal(calls[1].headers["Client-Id"], "cid")
  assert.equal(calls[1].headers.Authorization, "Bearer abc")
})

// ── Comando ──────────────────────────────────────────────────────────────────
function engineWith(ranks = []) {
  const replies = []
  const shown = []
  const removed = []
  let saved = null
  const moderation = { moderation: { getConfig: () => saved, setConfig: (_c, _k, value) => { saved = value; return saved } } }
  const commandConfig = createCommandConfigService(moderation, () => "canal", { rankResolver: () => ranks })
  const engine = createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }), addPoints() {}, getRanking: () => [] },
    games: {}, events: {}, shop: {}, vipService: {}, afk: { getIdleCommandReply: () => null },
    replyRouter: { send: (_event, message) => replies.push(message) },
    floatAvatars: {
      show: async (who, text, color) => { shown.push({ who: who.username, text, color }); return { ok: true } },
      remove: who => removed.push(who.username),
    },
    commandConfig,
  })
  return { engine, replies, shown, removed }
}

function chat(text, overrides = {}) {
  return {
    platform: "twitch", type: "chat_message", metadata: { channel: "canal", color: "#ff00aa" },
    actor: { platformUserId: "42", username: "emiligatita", displayName: "emiligatita", ...overrides },
    message: { text },
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test("!estado es solo para subs (y mods) por defecto", async () => {
  const noSub = engineWith([])
  noSub.engine.handle(chat("!estado comiendo"))
  await flush()
  assert.equal(noSub.shown.length, 0)
  assert.match(noSub.replies[0], /solo para: Suscriptor de Twitch o Moderador de Twitch/)

  const sub = engineWith(["twitch:sub"])
  sub.engine.handle(chat("!estado comiendo pizza"))
  await flush()
  assert.deepEqual(sub.shown, [{ who: "emiligatita", text: "comiendo pizza", color: "#ff00aa" }])
})

test("!estado sin texto explica el uso y !estado quitar lo retira", async () => {
  const { engine, replies, removed, shown } = engineWith(["twitch:sub"])
  engine.handle(chat("!estado"))
  assert.match(replies[0], /Uso: !estado/)
  engine.handle(chat("!status quitar", { platformUserId: "43", username: "otra" }))
  assert.deepEqual(removed, ["otra"])
  assert.equal(shown.length, 0)
})

test("!estado tiene cooldown por persona", async () => {
  const { engine, replies, shown } = engineWith(["twitch:sub"])
  engine.handle(chat("!estado comiendo"))
  engine.handle(chat("!estado durmiendo"))
  await flush()
  assert.equal(shown.length, 1)
  assert.match(replies.at(-1), /espera \d+s/)
})
