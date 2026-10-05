// Pestana Minijuegos: selector de juegos (Plinko, Rasca y gana, Ruleta,
// Slots, Alta o baja, Buscaminas) y herramientas comunes para sus
// animaciones: confeti y lluvia de monedas en un canvas, contadores que
// suben, sacudidas, destellos y el control de apuesta. Celebrar, sacudir y
// destellar tambien suenan (SoundKit) y vibran en el movil, asi que cada
// juego tiene sonido de premio y de fallo sin hacer nada mas.
// Cada juego se registra con GameKit.register(id, { build, show, hide, onInfo }).
// Expone window.GameKit y window.GamesHub (lo usa app.js).
(function () {
  "use strict"

  var STORE_KEY = "canje_game"
  var RARITY_COLORS = { comun: "#a1a1aa", raro: "#3b82f6", epico: "#a855f7", legendario: "#f59e0b", mitico: "#ff3b6b" }
  var GAMES = [
    { id: "plinko", name: "Plinko", tag: "Bolas y premios", accent: "#f59e0b" },
    { id: "scratch", name: "Rasca y gana", tag: "3 iguales, premio", accent: "#e5e7eb" },
    { id: "wheel", name: "Ruleta", tag: "1 giro gratis al día", accent: "#f43f5e" },
    { id: "slots", name: "Slots", tag: "Tus personajes", accent: "#22d3ee" },
    { id: "hilo", name: "Alta o baja", tag: "Multiplica o cobra", accent: "#34d399" },
    { id: "mines", name: "Buscaminas", tag: "Cofres y trampas", accent: "#a855f7" },
    { id: "blackjack", name: "Blackjack", tag: "Contra Hikki", accent: "#ef4444" },
  ]
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  var CELEBRATE_SOUND = { small: "win-small", big: "win-big", jackpot: "jackpot", coins: "coins" }
  var CELEBRATE_BUZZ = { small: 25, big: [30, 40, 70], jackpot: [40, 40, 40, 40, 140], coins: [20, 30, 20] }

  var games = {}
  var built = {}
  var current = "plinko"
  var visible = false
  var info = null
  var viewer = null
  var fetching = null

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function storage(action, value) {
    try { return action === "get" ? localStorage.getItem(STORE_KEY) : localStorage.setItem(STORE_KEY, value) } catch (error) { return null }
  }

  function fmt(value) { return app().formatNumber(value) }
  function sound(name, options) { window.SoundKit.play(name, options) }
  function haptic(pattern) { window.SoundKit.haptic(pattern) }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

  // ── Efectos ─────────────────────────────────────────────────────────────────
  // Confeti / monedas en un canvas a pantalla completa. kind: "small" | "big" | "jackpot" | "coins".
  var confettiCanvas = null
  var particles = []
  var confettiFrame = 0

  function ensureCanvas() {
    if (confettiCanvas) return confettiCanvas
    confettiCanvas = el("canvas", "fx-confetti")
    confettiCanvas.setAttribute("aria-hidden", "true")
    document.body.appendChild(confettiCanvas)
    return confettiCanvas
  }

  // `quiet`: sin sonido (el juego ya pone el suyo).
  function celebrate(kind, color, origin, quiet) {
    if (!quiet) sound(CELEBRATE_SOUND[kind] || "win-small")
    haptic(CELEBRATE_BUZZ[kind] || 25)
    if (reducedMotion) return
    var canvas = ensureCanvas()
    var width = canvas.width = window.innerWidth
    var height = canvas.height = window.innerHeight
    var count = kind === "jackpot" ? 260 : kind === "big" ? 150 : kind === "coins" ? 90 : 70
    var palette = kind === "jackpot" ? ["#fde68a", "#f59e0b", "#fff", "#ff3fa4", "#4dffb8", "#3fc6ff", "#b25cff"]
      : [color || "#fbbf24", "#fff", "#fde68a", color || "#a855f7"]
    var ox = origin ? origin.x : width / 2
    var oy = origin ? origin.y : height * 0.45
    for (var i = 0; i < count; i++) {
      var coin = kind === "coins" || (kind === "jackpot" && i % 3 === 0)
      var fromTop = kind === "jackpot" && i % 2 === 0
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2
      var speed = 6 + Math.random() * (kind === "small" ? 7 : 12)
      particles.push({
        x: fromTop ? Math.random() * width : ox, y: fromTop ? -20 - Math.random() * height * 0.5 : oy,
        vx: fromTop ? (Math.random() - 0.5) * 2 : Math.cos(angle) * speed, vy: fromTop ? 2 + Math.random() * 3 : Math.sin(angle) * speed,
        size: coin ? 9 + Math.random() * 6 : 5 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
        color: coin ? "#fbbf24" : palette[i % palette.length], coin: coin, life: 0, ttl: 140 + Math.random() * 80,
      })
    }
    if (!confettiFrame) confettiFrame = requestAnimationFrame(drawConfetti)
  }

  // Chispas cortas que salen en todas direcciones desde `origin` (pantalla).
  function sparks(origin, color, count) {
    if (reducedMotion || !origin) return
    ensureCanvas()
    if (!particles.length) { confettiCanvas.width = window.innerWidth; confettiCanvas.height = window.innerHeight }
    for (var i = 0; i < (count || 10); i++) {
      var angle = Math.random() * Math.PI * 2
      var speed = 2 + Math.random() * 5
      particles.push({
        x: origin.x, y: origin.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, size: 2 + Math.random() * 2.5,
        rot: 0, vr: 0, color: color || "#fde68a", spark: true, life: 0, ttl: 26 + Math.random() * 20,
      })
    }
    if (!confettiFrame) confettiFrame = requestAnimationFrame(drawConfetti)
  }

  // Texto que sube y se desvanece (premio, multiplicador...) sobre `origin`.
  function floatText(origin, text, color) {
    if (reducedMotion || !origin) return
    var node = el("span", "fx-float", text)
    node.style.left = origin.x + "px"
    node.style.top = origin.y + "px"
    node.style.setProperty("--c", color || "#fde68a")
    document.body.appendChild(node)
    setTimeout(function () { node.remove() }, 1400)
  }

  // Centro en pantalla de un elemento (origen para chispas y textos).
  function centerOf(node) {
    if (!node) return null
    var rect = node.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  function drawConfetti() {
    var canvas = confettiCanvas
    var ctx = canvas.getContext("2d")
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    particles = particles.filter(function (p) { return p.life < p.ttl && p.y < canvas.height + 40 })
    particles.forEach(function (p) {
      p.life += 1
      p.vy += p.spark ? 0.08 : 0.22
      p.vx *= 0.99
      p.x += p.vx
      p.y += p.vy
      p.rot += p.vr
      var alpha = Math.min(1, (p.ttl - p.life) / 30)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      if (p.spark) {
        ctx.fillStyle = p.color
        ctx.shadowColor = p.color
        ctx.shadowBlur = 8
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 6.283); ctx.fill()
      } else if (p.coin) {
        // Moneda que gira (se aplana con el seno).
        ctx.scale(Math.abs(Math.sin(p.rot * 2)) * 0.8 + 0.2, 1)
        var grad = ctx.createRadialGradient(-p.size * 0.3, -p.size * 0.3, 1, 0, 0, p.size)
        grad.addColorStop(0, "#fff7cc"); grad.addColorStop(0.5, "#fbbf24"); grad.addColorStop(1, "#b45309")
        ctx.fillStyle = grad
        ctx.beginPath(); ctx.arc(0, 0, p.size, 0, 6.283); ctx.fill()
        ctx.strokeStyle = "rgba(120,53,15,.6)"; ctx.lineWidth = 1.5; ctx.stroke()
      } else {
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      }
      ctx.restore()
    })
    if (particles.length) confettiFrame = requestAnimationFrame(drawConfetti)
    else { confettiFrame = 0; ctx.clearRect(0, 0, canvas.width, canvas.height) }
  }

  function restart(node, className) {
    if (!node) return
    node.classList.remove(className)
    void node.offsetWidth
    node.classList.add(className)
  }

  function shake(node) {
    sound("thud")
    haptic(70)
    restart(node, "fx-shake")
  }

  // Destello de pantalla completa de un color. `tone`: "lose" para los fallos.
  function flash(color, tone) {
    sound(tone === "lose" ? "lose" : "shimmer")
    if (reducedMotion) return
    var node = el("div", "fx-flash")
    node.style.setProperty("--flash", color || "#fff")
    document.body.appendChild(node)
    setTimeout(function () { node.remove() }, 700)
  }

  // Numero que sube (o baja) hasta `to`.
  function countUp(node, to, ms, prefix, suffix) {
    var from = Number(node.getAttribute("data-value")) || 0
    node.setAttribute("data-value", String(to))
    var start = performance.now()
    var duration = reducedMotion ? 0 : (ms || 700)
    function frame(time) {
      var t = duration ? Math.min(1, (time - start) / duration) : 1
      var eased = 1 - Math.pow(1 - t, 3)
      var value = Math.round(from + (to - from) * eased)
      node.textContent = (prefix || "") + fmt(value) + (suffix || "")
      if (t < 1) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  // Texto corto de un premio devuelto por el servidor.
  function prizeText(prize) {
    if (!prize) return "Nada"
    if (prize.type === "points") return "+" + fmt(prize.amount) + " pts"
    if (prize.type === "lose") return "-" + fmt(prize.amount) + " pts"
    if (prize.type === "chest") return prize.amount + (prize.amount === 1 ? " cofre " : " cofres ") + (prize.name || "")
    if (prize.type === "plinko") return prize.amount + " bolas de Plinko"
    if (prize.type === "gacha") return prize.amount + " tiradas de gachapon"
    if (prize.type === "sleeve") return "Funda rara"
    if (prize.type === "card") return prize.name + " (" + ({ comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario" }[prize.rarity] || "") + ")"
    return "Premio"
  }

  // Miniatura de personaje (imagen o inicial) con el color de su rareza.
  function cardFace(card, className) {
    var box = el("span", "g-face " + (className || "") + " r-" + (card && card.rarity || "comun"))
    if (card && card.image) {
      var img = document.createElement("img")
      img.src = card.image
      img.alt = ""
      img.draggable = false
      box.appendChild(img)
    } else {
      box.appendChild(el("b", "", String(card && card.name || "?").charAt(0)))
    }
    return box
  }

  // Control de apuesta: numero + fichas (+100, +1000, x2, /2, max).
  function betControl(options) {
    var box = el("div", "g-bet")
    var label = el("label", "g-bet-label", "Apuesta")
    var input = document.createElement("input")
    input.type = "number"
    input.min = String(options.min)
    input.max = String(options.max)
    input.step = "1"
    input.inputMode = "numeric"
    input.value = String(options.value || options.min)
    label.appendChild(input)
    box.appendChild(label)
    var chips = el("div", "g-bet-chips")
    function set(value) {
      var clean = Math.max(options.min, Math.min(options.max, Math.floor(value) || options.min))
      input.value = String(clean)
      if (options.onChange) options.onChange(clean)
    }
    ;[["+100", function (v) { return v + 100 }], ["+1000", function (v) { return v + 1000 }], ["x2", function (v) { return v * 2 }], ["/2", function (v) { return v / 2 }], ["Máx", function () { return Math.min(options.max, points()) }]].forEach(function (chip) {
      var button = el("button", "g-chip", chip[0])
      button.type = "button"
      button.addEventListener("click", function () { sound("chip"); set(chip[1](Number(input.value) || 0)) })
      chips.appendChild(button)
    })
    box.appendChild(chips)
    input.addEventListener("change", function () { set(Number(input.value)) })
    return { node: box, value: function () { return Number(input.value) || 0 }, set: set, input: input }
  }

  // Estructura comun: escenario a la izquierda, panel a la derecha.
  function layout(section, options) {
    section.textContent = ""
    section.className = "game game-" + options.id
    var stage = el("div", "game-stage")
    var accent = (GAMES.filter(function (game) { return game.id === options.id })[0] || {}).accent
    if (accent) stage.style.setProperty("--ga", accent)
    stage.appendChild(el("span", "game-frame"))
    stage.appendChild(el("span", "game-motes"))
    var side = el("aside", "game-side")
    side.appendChild(el("p", "brand-kicker", "Minijuego"))
    side.appendChild(el("h2", "game-title", options.title))
    side.appendChild(el("p", "hint", options.hint))
    var wallet = el("div", "plinko-wallet game-wallet")
    wallet.appendChild(el("span", "", "Tus puntos"))
    var amount = el("strong", "g-points", fmt(points()))
    amount.setAttribute("data-value", String(points()))
    wallet.appendChild(amount)
    side.appendChild(wallet)
    section.appendChild(stage)
    section.appendChild(side)
    // "En vivo" de este juego al final del panel (se mueve ahi tras montar el juego).
    var live = el("section", "lv-box")
    live.appendChild(el("h3", "mini-title", "En vivo"))
    var list = el("ul", "lv-list")
    live.appendChild(list)
    setTimeout(function () { side.appendChild(live) }, 0)
    window.LiveFeed.list(list, { games: [options.id] })
    return { stage: stage, side: side, points: amount }
  }

  // Tras una jugada: saldo nuevo (animado) y recarga del estado del viewer.
  function afterPlay(result) {
    if (result && typeof result.balance === "number") {
      if (viewer) viewer.points = result.balance
      Array.prototype.forEach.call(document.querySelectorAll(".g-points"), function (node) { countUp(node, result.balance, 800) })
    }
    window.LiveFeed.nudge()
    return app().reload().catch(function () {})
  }

  function points() { return viewer ? Number(viewer.points) || 0 : 0 }

  function post(path, body) { return app().api(path, { method: "POST", body: body }) }

  // ── Selector ────────────────────────────────────────────────────────────────
  function buildNav() {
    var nav = $("games-nav")
    nav.textContent = ""
    GAMES.forEach(function (game) {
      var button = el("button", "games-nav-btn g-" + game.id)
      button.type = "button"
      button.setAttribute("role", "tab")
      button.setAttribute("data-game", game.id)
      button.style.setProperty("--accent", game.accent)
      var art = el("span", "games-nav-art")
      art.appendChild(el("span", "games-nav-glyph"))
      button.appendChild(art)
      var text = el("span", "games-nav-text")
      text.appendChild(el("strong", "", game.name))
      text.appendChild(el("span", "games-nav-tag", game.tag))
      button.appendChild(text)
      button.addEventListener("click", function () { sound("click"); select(game.id) })
      nav.appendChild(button)
    })
    // Debajo del selector: volumen (el mismo que en el gachapon) y la franja "En vivo".
    if (!document.querySelector(".games-bar")) {
      var bar = el("div", "games-bar")
      bar.appendChild(window.SoundKit.control("games-sound"))
      var strip = el("div", "lv-strip")
      strip.appendChild(el("span", "lv-live", "En vivo"))
      var ticker = el("ul", "lv-ticker")
      strip.appendChild(ticker)
      bar.appendChild(strip)
      nav.parentNode.insertBefore(bar, nav.nextSibling)
      window.LiveFeed.ticker(ticker, { games: GAMES.map(function (game) { return game.id }) })
    }
  }

  function select(id) {
    if (!GAMES.some(function (game) { return game.id === id })) id = "plinko"
    var previous = current
    current = id
    storage("set", id)
    Array.prototype.forEach.call(document.querySelectorAll(".games-nav-btn"), function (button) {
      var on = button.getAttribute("data-game") === id
      button.setAttribute("aria-selected", String(on))
      button.classList.toggle("is-selected", on)
    })
    $("game-plinko").hidden = id !== "plinko"
    GAMES.forEach(function (game) {
      if (game.id === "plinko") return
      var section = $("game-" + game.id)
      section.hidden = game.id !== id
    })
    window.PlinkoGame.setVisible(visible && id === "plinko")
    if (previous !== id && games[previous] && games[previous].hide) games[previous].hide()
    if (id !== "plinko" && visible) showGame(id)
  }

  function showGame(id) {
    var game = games[id]
    if (!game) return
    var section = $("game-" + id)
    if (!built[id] && info) { game.build(section, info); built[id] = true }
    if (built[id] && game.show) game.show(info)
    if (!info) refreshInfo()
  }

  function refreshInfo() {
    if (!app()) return Promise.resolve()
    if (fetching) return fetching
    fetching = app().api("/api/games").then(function (result) {
      info = result
      Object.keys(games).forEach(function (id) { if (built[id] && games[id].onInfo) games[id].onInfo(info) })
      if (visible && current !== "plinko") showGame(current)
    }).catch(function (error) { if (visible) app().toast(error.message) }).then(function () { fetching = null })
    return fetching
  }

  function onViewer(next) {
    viewer = next
    window.PlinkoGame.onViewer(next)
    Array.prototype.forEach.call(document.querySelectorAll(".g-points"), function (node) {
      if (Number(node.getAttribute("data-value")) !== points()) countUp(node, points(), 500)
    })
    Object.keys(games).forEach(function (id) { if (built[id] && games[id].onViewer) games[id].onViewer(next) })
  }

  function setVisible(isVisible) {
    visible = isVisible
    window.LiveFeed.setActive("games", visible)
    if (!visible && games[current] && games[current].hide) games[current].hide()
    if (visible) refreshInfo()
    select(current)
  }

  document.addEventListener("DOMContentLoaded", function () {
    current = storage("get") || "plinko"
    buildNav()
  })

  window.GameKit = {
    register: function (id, game) { games[id] = game },
    el: el, fmt: fmt, wait: wait, sound: sound, haptic: haptic, celebrate: celebrate, sparks: sparks, floatText: floatText, centerOf: centerOf, shake: shake, flash: flash, restart: restart, countUp: countUp,
    prizeText: prizeText, cardFace: cardFace, betControl: betControl, layout: layout, afterPlay: afterPlay, post: post,
    points: points, refreshInfo: refreshInfo, info: function () { return info }, reducedMotion: reducedMotion, RARITY_COLORS: RARITY_COLORS,
  }
  window.GamesHub = { onViewer: onViewer, setVisible: setVisible }
})()
