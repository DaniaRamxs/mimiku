const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { applyMigrations } = require("../src/db/migrations.js")
const { createLocalPlatform } = require("../src/services/local-platform.js")
const { createLiveConfig, DEFAULTS } = require("../src/services/live-config.js")
const { createLiveBonus } = require("../src/services/live-bonus.js")
const { createLiveWatch, WATCH_BLOCK_MIN } = require("../src/services/live-watch.js")
const { createLiveDrops, DROP_MS } = require("../src/services/live-drops.js")
const { createPredictions } = require("../src/services/predictions.js")
const { createStreamRecap } = require("../src/services/stream-recap.js")
const { cleanClip, createTwitchClips } = require("../src/services/twitch-clips.js")
const { createCanjeStream } = require("../src/services/canje-stream.js")
const { createCanjeGames } = require("../src/services/canje-games.js")
const { createCanjeJobs } = require("../src/services/canje-jobs.js")
const { createCanjeData } = require("../src/services/canje-data.js")
const { createCanjeServer, createSessionSigner } = require("../src/services/canje-server.js")
const { createCommandEngine } = require("../src/core/interactions/command-engine.js")

function setup() {
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const getChannel = () => "canal"
  const luna = platform.identities.resolve({ platform: "twitch", platformUserId: "111", username: "luna", display: "Luna" })
  const zorro = platform.identities.resolve({ platform: "twitch", platformUserId: "222", username: "zorro", display: "Zorro" })
  const seed = (viewer, amount) => platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: amount, idempotencyKey: `seed-${viewer.id}-${amount}`, reason: "seed" })
  seed(luna, 100000)
  seed(zorro, 100000)
  const balance = viewer => platform.economy.getBalance("canal", viewer.id).balance
  return { db, platform, getChannel, luna, zorro, balance }
}

function clock(start = 1_700_000_000_000) {
  let time = start
  return { now: () => time, advance: ms => { time += ms } }
}

const LIVE = { live: true, streamId: "s1", startedAt: "2026-10-06T18:00:00.000Z", viewers: 10, title: "Directo", game: "Juego" }

// ── Ajustes ──────────────────────────────────────────────────────────────────
test("ajustes del directo: valores por defecto, guardado y limites", () => {
  const { platform, getChannel } = setup()
  const config = createLiveConfig({ platform, getChannel })
  assert.deepEqual(config.getConfig(), { ...DEFAULTS })
  const saved = config.setConfig({ watchPoints: 0, dropsEnabled: false, bonusPercent: 100 })
  assert.equal(saved.watchPoints, 0)
  assert.equal(saved.dropsEnabled, false)
  assert.equal(saved.bonusPercent, 100)
  assert.throws(() => config.setConfig({ dropEveryMin: 1 }), /Minutos entre cofres/)
  assert.throws(() => config.setConfig({ bonusPercent: 1.5 }), /Bonus/)
})

// ── Bonus de directo ─────────────────────────────────────────────────────────
test("bonus de directo: solo en vivo, solo sobre lo ganado y una vez por jugada", () => {
  const { platform, getChannel, luna, balance } = setup()
  let live = true
  const granted = []
  const bonus = createLiveBonus({ platform, getChannel, isLive: () => live, getPercent: () => 50, onGrant: amount => granted.push(amount) })
  const before = balance(luna)
  assert.equal(bonus.grant(luna.id, 1000, "jugada-1", "wheel"), 500)
  assert.equal(bonus.grant(luna.id, 1000, "jugada-1", "wheel"), 500, "la misma clave no paga dos veces")
  assert.equal(balance(luna), before + 500)
  assert.equal(bonus.grant(luna.id, -300, "jugada-2", "wheel"), 0, "perder no tiene bonus")
  live = null
  assert.equal(bonus.grant(luna.id, 1000, "jugada-3", "wheel"), 0, "sin saber si hay directo no hay bonus")
  assert.equal(bonus.percent(), 0)
  assert.deepEqual(granted, [500, 500])
})

test("bonus de directo en minijuegos: la ruleta paga el extra y lo devuelve en la jugada", () => {
  const { platform, getChannel, balance, luna } = setup()
  const liveBonus = createLiveBonus({ platform, getChannel, isLive: () => true, getPercent: () => 50 })
  // random 0: primer sector de la ruleta; lo que importa es que el bonus cuadre con lo ganado.
  const games = createCanjeGames({ platform, getChannel, liveBonus, random: () => 0 })
  const before = balance(luna)
  const result = games.wheel("111", "ruleta-bonus-1")
  assert.equal(result.ok, true)
  const net = balance(luna) - before - (result.liveBonus || 0)
  if (net > 0) assert.equal(result.liveBonus, Math.floor(net / 2))
  else assert.equal(result.liveBonus, undefined)
  assert.equal(result.balance, balance(luna))
  assert.deepEqual(games.wheel("111", "ruleta-bonus-1"), result, "un reintento devuelve lo mismo")
})

test("bonus de directo en trabajos: la entrega lleva el extra", () => {
  const { platform, getChannel, balance, luna } = setup()
  const time = clock()
  const liveBonus = createLiveBonus({ platform, getChannel, isLive: () => true, getPercent: () => 100 })
  const jobs = createCanjeJobs({ platform, getChannel, liveBonus, now: time.now, random: () => 0.99 })
  const started = jobs.start("111", "dishes")
  assert.equal(started.ok, true)
  time.advance(60_000)
  const before = balance(luna)
  const done = jobs.finish("111", started.task.id)
  assert.equal(done.ok, true)
  if (done.delta > 0) {
    assert.equal(done.liveBonus, done.delta)
    assert.equal(balance(luna), before + done.delta * 2)
  }
})

// ── Puntos por ver desde la pagina ───────────────────────────────────────────
test("ver desde la pagina: un minuto por aviso, puntos cada bloque y nada sin directo", () => {
  const { platform, getChannel, luna, balance } = setup()
  const time = clock()
  let stream = LIVE
  const noted = []
  let first = 0
  const watch = createLiveWatch({
    platform, getChannel, getStream: () => stream, getPoints: () => 250, now: time.now,
    noteWatcher: viewer => noted.push(viewer.username), onFirstWatch: () => { first += 1 },
  })
  const before = balance(luna)
  const ping = () => { const result = watch.ping("111"); time.advance(60_000); return result }
  const results = Array.from({ length: WATCH_BLOCK_MIN }, ping)
  assert.equal(results.at(-1).granted, 250)
  assert.equal(balance(luna), before + 250)
  assert.equal(first, 1, "solo el primer minuto avisa al resumen")
  assert.equal(noted.length, WATCH_BLOCK_MIN)
  const quick = watch.ping("111")
  const again = watch.ping("111")
  assert.equal(quick.counted, true)
  assert.equal(again.counted, false, "dos avisos seguidos cuentan un solo minuto")
  stream = { live: false }
  assert.deepEqual(watch.ping("111"), { ok: false, reason: "offline" })
  assert.deepEqual(watch.ping("999"), { ok: false, reason: "unknown-viewer" })
})

// ── Cofres del directo ───────────────────────────────────────────────────────
test("cofres del directo: aparecen en vivo, los abren los primeros y caducan", () => {
  const { platform, getChannel, luna, zorro, balance } = setup()
  const time = clock()
  const claims = []
  const config = { ...DEFAULTS, dropSlots: 1, dropPoints: 2500, dropEveryMin: 10 }
  const drops = createLiveDrops({
    platform, getChannel, getStream: () => LIVE, getConfig: () => config, onClaim: prize => claims.push(prize), now: time.now, random: () => 0.5,
  })
  assert.equal(drops.current("111"), null, "al empezar no hay cofre")
  time.advance(10 * 60_000)
  const drop = drops.current("111")
  assert.ok(drop, "pasado el tiempo sale un cofre")
  assert.deepEqual(drop.prize, { type: "points", amount: 2500 })
  const before = balance(luna)
  const opened = drops.claim("111", drop.id)
  assert.equal(opened.ok, true)
  assert.equal(balance(luna), before + 2500)
  assert.deepEqual(drops.claim("111", drop.id), { ok: false, reason: "already" })
  assert.deepEqual(drops.claim("222", drop.id), { ok: false, reason: "full" })
  assert.equal(drops.current("222"), null, "lleno: los demas ya no lo ven")
  assert.equal(drops.current("111").mine, true, "quien lo abrio lo sigue viendo hasta que acaba")
  time.advance(DROP_MS + 1)
  assert.equal(drops.current("111"), null)
  assert.equal(balance(zorro), 100000)
  assert.equal(claims.length, 1)
})

test("cofres del directo: sin directo o desactivados no salen", () => {
  const { platform, getChannel } = setup()
  const time = clock()
  let stream = { live: false }
  let config = { ...DEFAULTS }
  const drops = createLiveDrops({ platform, getChannel, getStream: () => stream, getConfig: () => config, now: time.now, random: () => 0 })
  time.advance(60 * 60_000)
  assert.equal(drops.current("111"), null)
  stream = LIVE
  config = { ...DEFAULTS, dropsEnabled: false }
  time.advance(60 * 60_000)
  assert.equal(drops.current("111"), null)
})

test("cofres del directo: a veces trae una tirada gratis del gachapon", () => {
  const { platform, getChannel, luna } = setup()
  const time = clock()
  const drops = createLiveDrops({ platform, getChannel, getStream: () => LIVE, getConfig: () => DEFAULTS, now: time.now, random: () => 0 })
  assert.equal(drops.current("111"), null)
  time.advance(DEFAULTS.dropEveryMin * 60_000)
  const drop = drops.current("111")
  assert.equal(drop.prize.type, "gacha")
  drops.claim("111", drop.id)
  assert.equal(platform.tickets.get("canal", luna.id).gachapon, 1)
})

// ── Predicciones ─────────────────────────────────────────────────────────────
function predictionSetup() {
  const base = setup()
  const time = clock()
  let resolved = 0
  const predictions = createPredictions({ platform: base.platform, getChannel: base.getChannel, now: time.now, onResolved: () => { resolved += 1 } })
  return { ...base, time, predictions, resolved: () => resolved }
}

test("predicciones: los que aciertan se reparten el bote en proporcion", () => {
  const { predictions, luna, zorro, balance, platform } = predictionSetup()
  const mora = platform.identities.resolve({ platform: "twitch", platformUserId: "333", username: "mora" })
  platform.economy.applyMovement({ channelId: "canal", viewerId: mora.id, balanceDelta: 50000, idempotencyKey: "seed-mora", reason: "seed" })
  const { prediction } = predictions.create({ question: "¿Gano?", options: ["Sí", "No"], seconds: 60 })
  assert.equal(predictions.bet(luna.id, prediction.id, 0, 1000, "k-luna-1").ok, true)
  assert.equal(predictions.bet(mora.id, prediction.id, 0, 3000, "k-mora-1").ok, true)
  assert.equal(predictions.bet(zorro.id, prediction.id, 1, 4000, "k-zorro-1").ok, true)
  assert.throws(() => predictions.resolve(prediction.id, 0), /Primero cierra las apuestas/, "no se resuelve con las apuestas abiertas")
  predictions.lock(prediction.id)
  const done = predictions.resolve(prediction.id, 0).prediction
  assert.equal(done.status, "resolved")
  assert.equal(done.pool, 8000)
  assert.equal(balance(luna), 100000 - 1000 + 2000)
  assert.equal(balance(mora), 50000 - 3000 + 6000)
  assert.equal(balance(zorro), 100000 - 4000)
  assert.throws(() => predictions.resolve(prediction.id, 1), /ya terminó/)
})

test("predicciones: apuestas validas, una respuesta por viewer y reintentos sin doble cobro", () => {
  const { predictions, luna, balance, time } = predictionSetup()
  const { prediction } = predictions.create({ question: "¿Gano?", options: ["Sí", "No", "Empate"], seconds: 60 })
  assert.equal(predictions.bet(luna.id, prediction.id, 0, 50, "k-1").reason, "min")
  assert.equal(predictions.bet(luna.id, prediction.id, 0, 600000, "k-2").reason, "max")
  assert.equal(predictions.bet(luna.id, prediction.id, 7, 500, "k-3").reason, "bad-option")
  assert.equal(predictions.bet(luna.id, prediction.id, 0, 500, "k-4").ok, true)
  assert.equal(predictions.bet(luna.id, prediction.id, 0, 500, "k-4").ok, true, "mismo reintento")
  assert.equal(balance(luna), 99500, "el reintento no cobra otra vez")
  assert.equal(predictions.bet(luna.id, prediction.id, 1, 500, "k-5").reason, "other-option")
  const raised = predictions.bet(luna.id, prediction.id, 0, 700, "k-6")
  assert.equal(raised.prediction.myBet.amount, 1200)
  assert.equal(predictions.bet(luna.id, prediction.id, 0, 999999999, "k-7").reason, "max")
  time.advance(61_000)
  assert.equal(predictions.bet(luna.id, prediction.id, 0, 500, "k-8").reason, "closed", "se cierra sola al acabar el tiempo")
  assert.equal(predictions.view(luna.id).status, "locked")
})

test("predicciones: sin ganadores o cancelada se devuelve todo; solo una activa", () => {
  const { predictions, luna, zorro, balance, resolved } = predictionSetup()
  const first = predictions.create({ question: "¿Gano?", options: ["Sí", "No"], seconds: 60 }).prediction
  assert.throws(() => predictions.create({ question: "Otra", options: ["a", "b"], seconds: 60 }), /Ya hay una predicción activa/)
  predictions.bet(luna.id, first.id, 0, 1000, "k-1")
  predictions.lock(first.id)
  predictions.resolve(first.id, 1)
  assert.equal(balance(luna), 100000, "nadie acerto: devuelto")
  assert.equal(resolved(), 1)
  const second = predictions.create({ question: "¿Muero?", options: ["Sí", "No"], seconds: 60 }).prediction
  predictions.bet(zorro.id, second.id, 1, 2000, "k-2")
  predictions.lock(second.id)
  predictions.cancel(second.id)
  assert.equal(balance(zorro), 100000)
  assert.equal(predictions.view(zorro.id).status, "cancelled")
  assert.equal(predictions.view(zorro.id).myBet.payout, 2000)
})

test("predicciones: el panel valida la pregunta, las respuestas y el tiempo", () => {
  const { predictions } = predictionSetup()
  assert.throws(() => predictions.create({ question: "", options: ["a", "b"], seconds: 60 }), /pregunta/)
  assert.throws(() => predictions.create({ question: "x", options: ["a"], seconds: 60 }), /2 a 4/)
  assert.throws(() => predictions.create({ question: "x", options: ["a", "A"], seconds: 60 }), /repetidas/)
  assert.throws(() => predictions.create({ question: "x", options: ["a", "b"], seconds: 5 }), /30 a 900/)
})

// ── Comandos del chat ────────────────────────────────────────────────────────
function chatEngine(predictions) {
  return createCommandEngine({
    economy: { getViewer: () => ({ points: 0 }) }, games: {}, events: {}, shop: {}, vipService: { getCommandNames: () => [] },
    afk: { getIdleCommandReply: () => null }, predictions,
  })
}

function say(engine, text, isModerator) {
  const replies = []
  engine.handle({
    platform: "twitch", type: "chat_message", message: { text }, metadata: {}, reply: message => replies.push(message),
    actor: { platformUserId: "u1", username: "luna", displayName: "Luna", isModerator },
  })
  return replies
}

test("chat: streamer y mods crean y resuelven con !prediccion y !op1; los demas no", () => {
  const { predictions, luna, zorro, balance } = predictionSetup()
  const engine = chatEngine(predictions)
  assert.match(say(engine, "!prediccion ¿Gano? | Sí | No", false)[0], /solo para el streamer y los mods/)
  assert.equal(predictions.summary().prediction, null)
  const created = say(engine, "!prediccion 180 ¿Gano la partida? | Sí | No | Empate", true)[0]
  assert.match(created, /Nueva predicción: ¿Gano la partida\? \(!op1 Sí · !op2 No · !op3 Empate\)/)
  assert.match(created, /180 s/)
  const active = predictions.summary().prediction
  assert.deepEqual(active.options.map(option => option.label), ["Sí", "No", "Empate"])
  predictions.bet(luna.id, active.id, 1, 1000, "k-luna")
  predictions.bet(zorro.id, active.id, 0, 1000, "k-zorro")
  assert.match(say(engine, "!op4", true)[0], /solo tiene 3 respuestas/)
  assert.match(say(engine, "!op2", false)[0], /solo para el streamer/)
  assert.match(say(engine, "!op2", true)[0], /siguen abiertas/, "con las apuestas abiertas no se elige ganadora")
  say(engine, "!cerrarpred", true)
  assert.match(say(engine, "!op2", true)[0], /Ganó "No": 1 viewer se lleva 2\.?000 puntos/)
  assert.equal(balance(luna), 101000)
  assert.match(say(engine, "!op1", true)[0], /No hay ninguna predicción activa/)
})

test("chat: !cerrarpred, !cancelarpred y uso incorrecto", () => {
  const { predictions } = predictionSetup()
  const engine = chatEngine(predictions)
  assert.match(say(engine, "!prediccion solo pregunta", true)[0], /^Uso: !prediccion/)
  say(engine, "!pred ¿Gano? | Sí | No", true)
  assert.match(say(engine, "!cerrarpred", true)[0], /Apuestas cerradas/)
  assert.equal(predictions.summary().prediction.status, "locked")
  assert.match(say(engine, "!cancelarpred", true)[0], /cancelada/)
  assert.equal(predictions.summary().prediction.status, "cancelled")
  say(engine, "!cancelarpred", true)
  assert.match(say(engine, "!prediccion 5 kills? | Sí | No", true)[0], /Nueva predicción: 5 kills\?/, "un numero fuera de rango es parte de la pregunta")
})

// ── Resumen del directo ──────────────────────────────────────────────────────
test("resumen: guarda pico, top y contadores, y al terminar suma los puntos ganados sin transferencias", () => {
  const { db, platform, getChannel, luna, zorro } = setup()
  db.prepare("UPDATE economy_ledger SET created_at=datetime('now','-1 hour')").run() // los saldos iniciales son de antes del directo
  // El libro de puntos guarda la hora real: el resumen empieza "ahora".
  const time = clock(Date.now() - 1000)
  const live = { ...LIVE, startedAt: new Date(time.now()).toISOString() }
  let top = [{ name: "Luna", messages: 40 }, { name: "Zorro", messages: 12 }]
  const recap = createStreamRecap({ platform, getChannel, getTop: () => top, now: time.now, log: { error() {} } })
  const move = (viewer, delta, sourceType, key) => platform.economy.applyMovement({ channelId: "canal", viewerId: viewer.id, balanceDelta: delta, idempotencyKey: key, reason: "x", sourceType })
  recap.bump("drops")
  recap.onUpdate({ ...live, viewers: 10 })
  recap.bump("drops")
  recap.bump("legendaries", 2)
  time.advance(30 * 60_000)
  move(luna, 5000, "minigame", "gano")
  move(zorro, 1000, "regalo", "regalo-recibido")
  move(luna, -2000, "minigame", "perdio")
  recap.onUpdate({ ...live, viewers: 42 })
  top = []
  time.advance(30 * 60_000)
  recap.onUpdate({ ...live, viewers: 20 })
  recap.bump("predictions")
  time.advance(60_000)
  recap.onUpdate({ live: false, streamId: null })
  assert.equal(recap.last(), null, "una sola consulta sin directo no cierra el resumen")
  recap.onUpdate({ live: false, streamId: null })
  const last = recap.last()
  assert.equal(last.streamId, "s1")
  assert.equal(last.peakViewers, 42)
  assert.equal(last.minutes, 60, "termina en la ultima vez que se vio en vivo")
  assert.deepEqual(last.top.map(entry => entry.name), ["Luna", "Zorro"], "un top vacio no borra el ultimo conocido")
  assert.equal(last.drops, 1, "fuera de directo no cuenta")
  assert.equal(last.legendaries, 2)
  assert.equal(last.predictions, 1)
  assert.equal(last.pointsEarned, 5000)
  recap.onUpdate({ live: false })
  assert.equal(recap.last().streamId, "s1", "seguir sin directo no rehace el resumen")
})

test("resumen: si empieza otro directo sin ver el final, cierra el anterior", () => {
  const { platform, getChannel } = setup()
  const time = clock()
  const recap = createStreamRecap({ platform, getChannel, now: time.now, log: { error() {} } })
  recap.onUpdate(LIVE)
  time.advance(60_000)
  recap.onUpdate({ ...LIVE, streamId: "s2" })
  assert.equal(recap.last().streamId, "s1")
})

// ── Clips ────────────────────────────────────────────────────────────────────
test("clips: solo enlaces y miniaturas de Twitch, ordenados por vistas", async () => {
  assert.equal(cleanClip({ url: "https://evil.example/clip", thumbnail_url: "" }), null)
  const clip = cleanClip({ id: "a", url: "https://clips.twitch.tv/Abc-1", thumbnail_url: "javascript:alert(1)", title: "x", view_count: 3, duration: 12.4 })
  assert.equal(clip.thumbnail, "")
  assert.equal(clip.seconds, 12)
  const calls = []
  const helix = {
    hasToken: () => true,
    get: async path => {
      calls.push(path)
      if (path.startsWith("users")) return { data: [{ id: "99" }] }
      return { data: [
        { id: "1", url: "https://clips.twitch.tv/Uno", view_count: 5 },
        { id: "2", url: "https://clips.twitch.tv/Dos", view_count: 50 },
        { id: "3", url: "https://malo.example/x", view_count: 500 },
      ] }
    },
  }
  const clips = createTwitchClips({ helix, getChannel: () => "Canal", log: { warn() {} } })
  assert.deepEqual(clips.list(), [], "la primera vez no espera a Twitch")
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(clips.list().map(item => item.id), ["2", "1"])
  assert.match(calls[1], /broadcaster_id=99/)
})

// ── Mimics fuera de directo ──────────────────────────────────────────────────
test("Mimics: sin directo no se canjean; con directo o sin saberlo, si", () => {
  const { platform, getChannel, luna } = setup()
  let live = false
  const data = createCanjeData({ platform, getChannel, isLive: () => live })
  const mimic = platform.mimics.create("canal", { name: "Confeti", icon: "*", rarity: "raro" })
  platform.mimics.grant("canal", luna.id, mimic.id, 2, "g1")
  assert.deepEqual(data.redeem("111", mimic.id, "clave-1"), { ok: false, reason: "offline" })
  live = true
  assert.deepEqual(data.redeem("111", mimic.id, "clave-2"), { ok: true, name: "Confeti" })
  live = null
  assert.deepEqual(data.redeem("111", mimic.id, "clave-3"), { ok: true, name: "Confeti" })
})

// ── Pagina: /api/state y rutas ───────────────────────────────────────────────
test("pagina: /api/state trae los extras del directo y las rutas responden", async t => {
  const { platform, getChannel, luna } = setup()
  const time = clock()
  let stream = LIVE
  const predictions = createPredictions({ platform, getChannel, now: time.now })
  const config = { ...DEFAULTS, dropEveryMin: 3 }
  const recap = createStreamRecap({ platform, getChannel, now: time.now })
  const extras = createCanjeStream({
    platform, getStream: () => stream, now: time.now, recap,
    watch: createLiveWatch({ platform, getChannel, getStream: () => stream, getPoints: () => 250, now: time.now }),
    drops: createLiveDrops({ platform, getChannel, getStream: () => stream, getConfig: () => config, now: time.now, random: () => 0.9 }),
    bonus: createLiveBonus({ platform, getChannel, isLive: () => !!stream.live, getPercent: () => 50 }),
    predictions, clips: { list: () => [{ id: "c1" }] },
  })
  const sessions = createSessionSigner({ getKey: () => "clave" })
  const server = createCanjeServer({
    data: { viewerState: () => null }, stream: extras, getStream: () => stream, sessions,
    validator: { validate: async () => null }, assetDir: ".", getConfig: () => ({ clientId: "x", channelDisplay: "canal" }), log: { error() {} },
  })
  const port = await server.start(0)
  t.after(() => server.stop())
  const token = sessions.issue({ twitchId: "111", login: "luna" }).token
  const call = async (route, body) => {
    time.advance(1000) // la pagina limita a una accion por segundo
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, json: await response.json() }
  }
  const { prediction } = predictions.create({ question: "¿Gano?", options: ["Sí", "No"], seconds: 60 })
  let state = (await call("/api/state")).json
  assert.equal(state.live.bonusPercent, 50)
  assert.equal(state.live.watch.points, 250)
  assert.equal(state.live.prediction.question, "¿Gano?")
  assert.equal(state.live.recap, null)
  assert.deepEqual(state.live.clips, [])
  const watched = await call("/api/stream/watch", {})
  assert.equal(watched.status, 200)
  assert.equal(watched.json.minutes, 1)
  const bet = await call("/api/stream/predict", { id: prediction.id, option: 1, amount: 300, key: "apuesta-123" })
  assert.equal(bet.status, 200)
  assert.equal(bet.json.prediction.myBet.amount, 300)
  const bad = await call("/api/stream/predict", { id: prediction.id, option: 0, amount: 300, key: "apuesta-456" })
  assert.equal(bad.status, 409)
  assert.match(bad.json.error, /otra respuesta/)
  time.advance(3 * 60_000)
  state = (await call("/api/state")).json
  assert.ok(state.live.drop, "a los minutos sale el cofre")
  const opened = await call("/api/stream/drop", { id: state.live.drop.id })
  assert.equal(opened.status, 200)
  assert.equal(platform.economy.getBalance("canal", luna.id).balance, 100000 - 300 + DEFAULTS.dropPoints)
  stream = { live: false, login: "canal" }
  state = (await call("/api/state")).json
  assert.equal(state.live.drop, null)
  assert.deepEqual(state.live.clips, [{ id: "c1" }], "sin directo salen los clips")
})

// ── Arreglos de la revision ──────────────────────────────────────────────────
test("bonus de directo: tope por viewer y directo", () => {
  const { platform, getChannel, luna, balance } = setup()
  const stream = { ...LIVE, startedAt: new Date(Date.now() - 60_000).toISOString() }
  const bonus = createLiveBonus({ platform, getChannel, isLive: () => true, getPercent: () => 100, getStream: () => stream, cap: 3000 })
  const before = balance(luna)
  assert.equal(bonus.grant(luna.id, 2000, "j-1", "hilo"), 2000)
  assert.equal(bonus.grant(luna.id, 2000, "j-2", "hilo"), 1000, "solo hasta el tope")
  assert.equal(bonus.grant(luna.id, 2000, "j-3", "hilo"), 0)
  assert.equal(balance(luna), before + 3000)
})

test("ver desde la pagina: tras reiniciar no se anuncia un bloque ya pagado", () => {
  const { platform, getChannel, luna, balance } = setup()
  const time = clock()
  const make = () => createLiveWatch({ platform, getChannel, getStream: () => LIVE, getPoints: () => 250, now: time.now })
  const first = make()
  for (let i = 0; i < WATCH_BLOCK_MIN; i++) { first.ping("111"); time.advance(60_000) }
  const paid = balance(luna)
  const restarted = make()
  const results = Array.from({ length: WATCH_BLOCK_MIN }, () => { const result = restarted.ping("111"); time.advance(60_000); return result })
  assert.equal(results.at(-1).granted, 0)
  assert.equal(balance(luna), paid)
})

test("cofres del directo: tras reiniciar los ids no se repiten", () => {
  const { platform, getChannel } = setup()
  const time = clock()
  const make = () => createLiveDrops({ platform, getChannel, getStream: () => LIVE, getConfig: () => DEFAULTS, now: time.now, random: () => 0.5 })
  const a = make()
  a.current("111")
  time.advance(60 * 60_000)
  const first = a.current("111")
  const b = make()
  b.current("111")
  time.advance(60 * 60_000)
  const second = b.current("111")
  assert.ok(first && second)
  assert.equal(first.id === second.id, false)
})

test("predicciones: sin resultado en 24 h se devuelven solas", () => {
  const { predictions, luna, balance, time } = predictionSetup()
  const { prediction } = predictions.create({ question: "¿Gano?", options: ["Sí", "No"], seconds: 60 })
  predictions.bet(luna.id, prediction.id, 0, 1000, "k-1")
  time.advance(25 * 60 * 60_000)
  assert.equal(predictions.summary().prediction.status, "cancelled")
  assert.equal(balance(luna), 100000)
  assert.ok(predictions.create({ question: "Otra", options: ["a", "b"], seconds: 60 }).prediction)
})

test("resumen: las predicciones no cuentan como puntos ganados", () => {
  const { db, platform, getChannel, luna } = setup()
  db.prepare("UPDATE economy_ledger SET created_at=datetime('now','-1 hour')").run()
  const time = clock(Date.now() - 1000)
  const recap = createStreamRecap({ platform, getChannel, now: time.now, log: { error() {} } })
  recap.onUpdate({ ...LIVE, startedAt: new Date(time.now()).toISOString() })
  platform.economy.applyMovement({ channelId: "canal", viewerId: luna.id, balanceDelta: 9000, idempotencyKey: "pago", reason: "x", sourceType: "prediction" })
  time.advance(120_000)
  recap.onUpdate({ live: false })
  recap.onUpdate({ live: false })
  assert.equal(recap.last().pointsEarned, 0)
})
