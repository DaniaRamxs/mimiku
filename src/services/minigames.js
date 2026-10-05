// services/minigames.js — minijuegos instantaneos de la pagina de canje:
// rasca y gana, ruleta de la fortuna y slots de personajes.
//
// El servidor decide todo (la pagina solo anima el resultado). Cada jugada
// cobra el precio y entrega el premio en una sola transaccion. Los precios
// estan en el panel (clave "minigames"). Los juegos por pasos (alta o baja,
// buscaminas) estan en minigames-risk.js.
const { normalizeRarity } = require("./canje-data.js")
const { createCardSleeves } = require("./card-sleeves.js")

const CONFIG_KEY = "minigames"
const DEFAULTS = { scratchPrice: 500, wheelPrice: 1000, slotsPrice: 300, riskMin: 100, riskMax: 100000 }
const MAX_PRICE = 100_000_000

// Rasca y gana: 3 casillas; si salen 3 iguales se gana ese premio (y `bonus`, si lo hay).
// "Diamante" y "legendario" son los golpes gordos (la pagina los celebra como jackpot).
const SCRATCH_SYMBOLS = {
  moneda: { label: "Monedas (x2)", prize: { type: "points", times: 2 } },
  bolas: { label: "Bolas (5 de Plinko)", prize: { type: "plinko", amount: 5 } },
  tiradas: { label: "Cápsulas (5 tiradas)", prize: { type: "gacha", amount: 5 } },
  bolsa: { label: "Bolsa de puntos (x5)", prize: { type: "points", times: 5 } },
  cofre: { label: "Cofre", prize: { type: "chest", amount: 1 } },
  raro: { label: "Personaje raro", prize: { type: "card", rarity: "raro" } },
  diamante: { label: "Diamante (x20)", prize: { type: "points", times: 20 } },
  epico: { label: "Personaje épico", prize: { type: "card", rarity: "epico" } },
  legendario: { label: "Legendario + 10 tiradas", prize: { type: "card", rarity: "legendario" }, bonus: { type: "gacha", amount: 10 } },
}
// "legendario" va el ultimo: con random() casi 1 sale el premio mayor.
const SCRATCH_ODDS = { nada: 55, moneda: 15, bolas: 8, tiradas: 6, bolsa: 5, cofre: 4, raro: 3.5, diamante: 0.5, epico: 1.5, legendario: 0.4 }

// Ruleta: 12 sectores en orden (la pagina los dibuja igual). "weight" = probabilidad relativa.
// `big`: premio gordo (la pagina lo celebra como jackpot y sale en el aviso en vivo).
// Los gordos van junto a "Nada" y "-50%" para que frenar cerca de ellos tenga emocion.
const WHEEL_SECTORS = [
  { id: "x2", label: "x2", color: "#f59e0b", weight: 14, prize: { type: "points", times: 2 } },
  { id: "nada1", label: "Nada", color: "#3f3a52", weight: 15, prize: null },
  { id: "tiradas10", label: "10 tiradas", color: "#db2777", weight: 6, prize: { type: "gacha", amount: 10 } },
  { id: "bolas5", label: "5 bolas", color: "#6d28d9", weight: 10, prize: { type: "plinko", amount: 5 } },
  { id: "x3", label: "x3", color: "#ea580c", weight: 6, prize: { type: "points", times: 3 } },
  { id: "menos", label: "-50%", color: "#be123c", weight: 9, prize: { type: "lose", times: 0.5 } },
  { id: "tiradas40", label: "40 tiradas", color: "#ec4899", weight: 2, big: true, prize: { type: "gacha", amount: 40 } },
  { id: "cofre", label: "Cofre", color: "#b45309", weight: 8, prize: { type: "chest", amount: 1 } },
  { id: "x1", label: "x1", color: "#0d9488", weight: 14, prize: { type: "points", times: 1 } },
  { id: "nada2", label: "Nada", color: "#3f3a52", weight: 15, prize: null },
  { id: "epico", label: "Épico", color: "#a855f7", weight: 3, prize: { type: "card", rarity: "epico" } },
  { id: "bolas30", label: "30 bolas", color: "#4f46e5", weight: 2, big: true, prize: { type: "plinko", amount: 30 } },
  { id: "funda", label: "Funda", color: "#2563eb", weight: 3, prize: { type: "sleeve", sleeve: "rara" } },
  { id: "cofres3", label: "3 cofres", color: "#c2410c", weight: 3, prize: { type: "chest", amount: 3 } },
  { id: "legendario", label: "Legendario", color: "#facc15", weight: 1, big: true, prize: { type: "card", rarity: "legendario" } },
  { id: "x10", label: "x10", color: "#fbbf24", weight: 1, big: true, prize: { type: "points", times: 10 } },
]

// Slots: cada rodillo sale de la "tira" del dia (hasta 8 personajes, cambia cada dia).
const SLOTS_STRIP_SIZE = 8
const SLOTS_WEIGHTS = { comun: 20, raro: 15, epico: 10, legendario: 5 }
const SLOTS_BONUS = { comun: 0, raro: 0, epico: 5, legendario: 20 } // puntos extra (x precio) con 3 iguales
const RARITY_ORDER = ["comun", "raro", "epico", "legendario"]

function pickWeighted(entries, random) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let cursor = random() * total
  for (const [value, weight] of entries) {
    cursor -= weight
    if (cursor < 0) return value
  }
  return entries[entries.length - 1][0]
}

function hash(text) {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0
  return value
}

function dayKey(ms) {
  const date = new Date(ms)
  const pad = n => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function createMinigames({ platform, getChannel, now = Date.now, random = Math.random }) {
  const db = platform.db
  const sleeves = createCardSleeves({ platform, getChannel })

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function getConfig() {
    const saved = platform.moderation.getConfig(activeChannel(), CONFIG_KEY) || {}
    return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => {
      const value = Math.trunc(Number(saved[key]))
      return [key, value >= 1 && value <= MAX_PRICE ? value : fallback]
    }))
  }

  function setConfig(input = {}) {
    const next = { ...getConfig(), ...input }
    for (const key of Object.keys(DEFAULTS)) {
      const value = Number(next[key])
      if (!Number.isInteger(value) || value < 1 || value > MAX_PRICE) throw new Error("Los precios de los minijuegos deben ser números enteros de 1 o más")
      next[key] = value
    }
    if (next.riskMin > next.riskMax) throw new Error("La apuesta mínima no puede ser mayor que la máxima")
    platform.moderation.setConfig(activeChannel(), CONFIG_KEY, Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, next[key]])))
    return getConfig()
  }

  // ── Puntos y premios ────────────────────────────────────────────────────────
  function move(viewerId, delta, key, reason) {
    platform.economy.applyMovement({ channelId: activeChannel(), viewerId, balanceDelta: delta, idempotencyKey: key, reason, sourceType: "minigame", sourceId: reason })
  }

  function giftBox() {
    const boxes = platform.mimics.listBoxes(activeChannel())
    const saved = (platform.moderation.getConfig(activeChannel(), "sub_pass") || {}).boxId
    return boxes.find(box => box.id === saved) || boxes[boxes.length - 1] || null
  }

  function randomCard(rarity) {
    const pool = platform.profiles.droppableCards(activeChannel()).filter(card => normalizeRarity(card.rarity) === rarity)
    return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : null
  }

  // Entrega un premio y devuelve lo que se dio, listo para ensenar.
  // `price`: precio de la jugada (para los premios "xN").
  function grant(viewerId, prize, price, key, reason) {
    if (!prize) return null
    const channelId = activeChannel()
    if (prize.type === "points") {
      const amount = Math.floor(price * prize.times)
      if (amount > 0) move(viewerId, amount, `${key}:premio`, reason)
      return { type: "points", amount }
    }
    if (prize.type === "lose") {
      const balance = platform.economy.getBalance(channelId, viewerId).balance
      const amount = Math.min(balance, Math.floor(price * prize.times))
      if (amount > 0) move(viewerId, -amount, `${key}:castigo`, reason)
      return { type: "lose", amount }
    }
    if (prize.type === "chest") {
      const box = giftBox()
      if (!box) { move(viewerId, price * 3, `${key}:premio`, reason); return { type: "points", amount: price * 3 } }
      platform.mimics.grantBoxes(channelId, viewerId, box.id, prize.amount, `${key}:cofre`, "minijuego")
      return { type: "chest", amount: prize.amount, name: box.name }
    }
    if (prize.type === "plinko") { platform.tickets.grant(channelId, viewerId, "plinko", prize.amount); return { type: "plinko", amount: prize.amount } }
    // Tiradas gratis del gachapon (se gastan antes que los puntos, desde el chat o la web).
    if (prize.type === "gacha") { platform.tickets.grant(channelId, viewerId, "gachapon", prize.amount); return { type: "gacha", amount: prize.amount } }
    if (prize.type === "sleeve") { sleeves.grant(viewerId, prize.sleeve, 1); return { type: "sleeve", sleeve: prize.sleeve } }
    // Una carta concreta (la de los slots).
    if (prize.type === "fixed-card") {
      platform.profiles.grantCard(channelId, viewerId, prize.card.id, 1, `${key}:carta`)
      return { type: "card", id: prize.card.id, name: prize.card.name, rarity: normalizeRarity(prize.card.rarity), imagePath: prize.card.image_path }
    }
    if (prize.type === "card") {
      const card = randomCard(prize.rarity)
      if (!card) { move(viewerId, price * 5, `${key}:premio`, reason); return { type: "points", amount: price * 5 } }
      platform.profiles.grantCard(channelId, viewerId, card.id, 1, `${key}:carta`)
      return { type: "card", id: card.id, name: card.name, rarity: normalizeRarity(card.rarity), imagePath: card.image_path }
    }
    return null
  }

  // Cobra, decide y entrega en una transaccion. `decide()` -> { prize, extra, ... }.
  function playPaid(viewerId, price, key, reason, decide, { free = false } = {}) {
    try {
      return db.transaction(() => {
        if (!free) move(viewerId, -price, `${key}:apuesta`, reason)
        const outcome = decide()
        const given = outcome.prize ? grant(viewerId, outcome.prize, price, key, reason) : null
        const bonus = outcome.bonus ? grant(viewerId, outcome.bonus, price, `${key}:extra`, reason) : null
        return { ok: true, price: free ? 0 : price, free, ...outcome.show, prize: given, bonus }
      })()
    } catch (error) {
      if (/saldo insuficiente/i.test(error.message)) return { ok: false, reason: "insufficient" }
      throw error
    }
  }

  // ── Rasca y gana ────────────────────────────────────────────────────────────
  function scratch(viewerId, key) {
    const { scratchPrice } = getConfig()
    return playPaid(viewerId, scratchPrice, `rasca:${key}`, "Rasca y gana", () => {
      const result = pickWeighted(Object.entries(SCRATCH_ODDS), random)
      const symbols = Object.keys(SCRATCH_SYMBOLS)
      if (result !== "nada") return { prize: SCRATCH_SYMBOLS[result].prize, bonus: SCRATCH_SYMBOLS[result].bonus || null, show: { cells: [result, result, result], win: result } }
      // Sin premio: nunca 3 iguales (a veces 2, para que haya emocion).
      const first = symbols[Math.floor(random() * symbols.length)]
      const second = random() < 0.45 ? first : symbols[Math.floor(random() * symbols.length)]
      const others = symbols.filter(symbol => symbol !== first || second !== first)
      let third = others[Math.floor(random() * others.length)]
      if (third === first && second === first) third = symbols.find(symbol => symbol !== first)
      const cells = [first, second, third]
      for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]] }
      return { prize: null, show: { cells, win: null } }
    })
  }

  // ── Ruleta ──────────────────────────────────────────────────────────────────
  function freeSpinAvailable(viewerId) {
    return !db.prepare("SELECT 1 FROM minigame_free_spins WHERE channel_id=? AND viewer_id=? AND game='wheel' AND day_key=?")
      .get(activeChannel(), viewerId, dayKey(now()))
  }

  function wheel(viewerId, key) {
    const { wheelPrice } = getConfig()
    const free = freeSpinAvailable(viewerId)
    return playPaid(viewerId, wheelPrice, `ruleta:${key}`, "Ruleta de la fortuna", () => {
      if (free) db.prepare("INSERT INTO minigame_free_spins(channel_id, viewer_id, game, day_key) VALUES(?,?,?,?)").run(activeChannel(), viewerId, "wheel", dayKey(now()))
      const index = pickWeighted(WHEEL_SECTORS.map((sector, i) => [i, sector.weight]), random)
      const sector = WHEEL_SECTORS[index]
      // En el giro gratis el "-50%" no quita nada.
      const prize = free && sector.prize && sector.prize.type === "lose" ? null : sector.prize
      return { prize, show: { sector: index, sectorId: sector.id } }
    }, { free })
  }

  // ── Slots de personajes ─────────────────────────────────────────────────────
  // Tira del dia: hasta 2 personajes por rareza (los mismos para todos ese dia).
  function slotsStrip() {
    const cards = platform.profiles.droppableCards(activeChannel())
    const seed = hash(`${activeChannel()}:${dayKey(now())}`)
    const shuffled = cards.map(card => [hash(`${seed}:${card.id}`), card]).sort((a, b) => a[0] - b[0]).map(([, card]) => card)
    const picked = []
    for (const rarity of RARITY_ORDER) picked.push(...shuffled.filter(card => normalizeRarity(card.rarity) === rarity).slice(0, 2))
    for (const card of shuffled) if (picked.length < SLOTS_STRIP_SIZE && !picked.includes(card)) picked.push(card)
    return picked.slice(0, SLOTS_STRIP_SIZE)
  }

  function slots(viewerId, key) {
    const strip = slotsStrip()
    if (strip.length < 3) return { ok: false, reason: "no-cards" }
    const { slotsPrice } = getConfig()
    return playPaid(viewerId, slotsPrice, `slots:${key}`, "Slots de personajes", () => {
      const weights = strip.map((card, index) => [index, SLOTS_WEIGHTS[normalizeRarity(card.rarity)] || 10])
      const reels = [0, 1, 2].map(() => pickWeighted(weights, random))
      const [a, b, c] = reels
      if (a === b && b === c) {
        const card = strip[a]
        const rarity = normalizeRarity(card.rarity)
        return {
          prize: { type: "fixed-card", card },
          bonus: SLOTS_BONUS[rarity] ? { type: "points", times: SLOTS_BONUS[rarity] } : null,
          show: { reels, line: "triple", jackpot: rarity === "legendario" },
        }
      }
      // Dos iguales: se devuelve lo apostado.
      if (a === b || b === c || a === c) return { prize: { type: "points", times: 1 }, show: { reels, line: "pair" } }
      return { prize: null, show: { reels, line: null } }
    })
  }

  return { getConfig, setConfig, scratch, wheel, slots, slotsStrip, freeSpinAvailable, move }
}

module.exports = { createMinigames, SCRATCH_SYMBOLS, SCRATCH_ODDS, WHEEL_SECTORS, SLOTS_STRIP_SIZE, DEFAULTS, dayKey }
