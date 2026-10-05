// Minijuego Plinko de la pagina de canje (pestana Minijuegos).
// El servidor decide la casilla y el premio (POST /api/games/plinko); aqui
// solo se dibuja el tablero y se anima la bola hasta esa casilla: en cada fila
// de clavos la bola va media casilla a la izquierda o a la derecha, y el
// numero de pasos a la derecha es la casilla final. Se pueden tirar varias
// bolas a la vez (1x/5x/10x): caen escalonadas y al final se resumen los premios.
// Cada bola sale del dispensador con estela; los clavos sueltan chispas y
// suenan mas agudos segun baja (y a izquierda o derecha segun donde da); la
// casilla atrapa la bola y, si hay premio, sube un haz de luz con el premio.
// Expone window.PlinkoGame y lo usa app.js (window.CanjeApp).
(function () {
  "use strict"

  var ROWS = 8
  var SLOT_COUNT = ROWS + 1
  var TOP = 0.06
  var ROW_GAP = 0.094
  var SLOT_Y = 0.93
  var STEP_MS = 290
  var HISTORY_SIZE = 10
  var BALL_GAP_MS = 230
  var COUNT_OPTIONS = [1, 5, 10]
  var TIER_LABELS = { nada: "Nada", raro: "Raro", epico: "Épico", legendario: "Legendario" }
  var TIER_SHORT = { nada: "Nada", raro: "Raro", epico: "Épico", legendario: "Leg." }
  var TIER_ORDER = ["legendario", "epico", "raro", "nada"]
  var TIER_COLORS = { raro: "#3b82f6", epico: "#a855f7", legendario: "#f59e0b" }
  var GHOSTS = 3
  var GHOST_LAG_MS = 26
  var SPARKS = 4

  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  var info = null
  var visible = false
  var playing = false
  var points = 0
  var history = []
  var count = 1
  var pegs = []
  var prizesThisPlay = 0

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function tierClass(tier) { return tier === "nada" ? "t-nada" : "r-" + tier }
  function sound(name, options) { window.SoundKit.play(name, options) }
  function panOf(x) { return (x - 0.5) * 1.6 }
  function restart(node, className) { node.classList.remove(className); void node.offsetWidth; node.classList.add(className) }
  function slotX(index) { return (index + 0.5) / SLOT_COUNT }
  function rowY(row) { return TOP + row * ROW_GAP }
  // Clavo j de la fila r (j = -1 y r + 1 son clavos de adorno en los lados).
  function pegX(row, j) { return 0.5 + (j - row / 2) / SLOT_COUNT }

  // ── Tablero ─────────────────────────────────────────────────────────────────
  function buildBoard() {
    var box = $("plinko-pegs")
    box.textContent = ""
    pegs = []
    for (var row = 0; row < ROWS; row++) {
      var line = []
      for (var j = -1; j <= row + 1; j++) {
        var x = pegX(row, j)
        if (x < 0.02 || x > 0.98) continue
        var peg = el("span", "plinko-peg")
        peg.style.left = (x * 100) + "%"
        peg.style.top = (rowY(row) * 100) + "%"
        peg.style.setProperty("--d", (Math.random() * -4).toFixed(2) + "s")
        box.appendChild(peg)
        line[j] = peg
      }
      pegs.push(line)
    }
    var slots = $("plinko-slots")
    slots.textContent = ""
    info.plinko.slots.forEach(function (tier, index) {
      var slot = el("span", "plinko-slot " + tierClass(tier), TIER_SHORT[tier] || tier)
      slot.style.setProperty("--i", String(index))
      slots.appendChild(slot)
    })
    var board = $("plinko-board")
    if (!board.querySelector(".plinko-dropper")) {
      board.insertBefore(el("span", "plinko-dropper"), board.firstChild)
      board.appendChild(el("div", "plinko-fx"))
      board.appendChild(el("span", "plinko-combo"))
    }
  }

  function fxLayer() { return $("plinko-board").querySelector(".plinko-fx") }

  // Pieza de efecto que se borra sola. pos: fracciones del tablero (0..1).
  function fxPiece(className, x, y, text, ttl) {
    var node = el("span", className, text)
    node.style.left = (x * 100) + "%"
    if (y !== null) node.style.top = (y * 100) + "%"
    fxLayer().appendChild(node)
    setTimeout(function () { node.remove() }, ttl)
    return node
  }

  function sparks(x, y) {
    if (reducedMotion) return
    for (var i = 0; i < SPARKS; i++) {
      var spark = fxPiece("plinko-spark", x, y, null, 520)
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4
      var speed = 14 + Math.random() * 18
      spark.style.setProperty("--dx", (Math.cos(angle) * speed).toFixed(1) + "px")
      spark.style.setProperty("--dy", (Math.sin(angle) * speed).toFixed(1) + "px")
    }
  }

  function hitPeg(hit) {
    flashPeg(hit.row, hit.j)
    sound("peg", { row: hit.row, pan: panOf(hit.x) })
    sparks(hit.x, rowY(hit.row))
  }

  function renderCount() {
    var box = $("plinko-count")
    box.textContent = ""
    var max = info.plinko.maxBalls || 1
    COUNT_OPTIONS.filter(function (option) { return option <= max }).forEach(function (option) {
      var chip = el("button", "plinko-chip" + (count === option ? " is-selected" : ""), option + "x")
      chip.type = "button"
      chip.disabled = playing
      chip.setAttribute("aria-pressed", String(count === option))
      chip.addEventListener("click", function () { sound("chip"); count = option; renderSide() })
      box.appendChild(chip)
    })
  }

  function renderSide() {
    var price = info.plinko.price
    var button = $("plinko-play")
    renderCount()
    // Las bolas gratis (Pase Sub) se usan primero y no cuestan puntos.
    var free = Math.min(count, info.plinko.freeBalls || 0)
    var cost = price * (count - free)
    button.textContent = playing
      ? (count > 1 ? "Cayendo " + count + " bolas..." : "Cayendo...")
      : "Jugar" + (count > 1 ? " x" + count : "") + " · " + (cost ? app().formatNumber(cost) + " pts" : "gratis") + (free && cost ? " (" + free + " gratis)" : "")
    button.disabled = playing || points < cost
    $("plinko-points").textContent = app().formatNumber(points)
    var odds = $("plinko-odds")
    odds.textContent = ""
    TIER_ORDER.forEach(function (tier) {
      var item = el("li", tierClass(tier) + (info.plinko.odds[tier] ? "" : " is-off"))
      item.appendChild(el("span", "plinko-dot"))
      item.appendChild(el("span", "", TIER_LABELS[tier]))
      item.appendChild(el("b", "", info.plinko.odds[tier] ? info.plinko.odds[tier] + "%" : "sin premios"))
      odds.appendChild(item)
    })
    var list = $("plinko-history")
    list.textContent = ""
    if (!history.length) list.appendChild(el("li", "muted", "Todavía no has jugado."))
    history.forEach(function (entry) {
      var item = el("li", tierClass(entry.tier))
      item.appendChild(el("span", "plinko-dot"))
      item.appendChild(el("span", "", entry.prize ? entry.prize.name : "Nada"))
      item.appendChild(el("b", "", TIER_LABELS[entry.tier]))
      list.appendChild(item)
    })
  }

  // ── Caida de la bola ────────────────────────────────────────────────────────
  // Lista de pasos (+1 derecha / -1 izquierda) que termina en la casilla `slot`.
  function pathTo(slot) {
    var moves = []
    for (var i = 0; i < ROWS; i++) moves.push(i < slot ? 1 : -1)
    for (var k = moves.length - 1; k > 0; k--) {
      var swap = Math.floor(Math.random() * (k + 1))
      var tmp = moves[k]; moves[k] = moves[swap]; moves[swap] = tmp
    }
    return moves
  }

  function flashPeg(row, j) {
    var peg = pegs[row] && pegs[row][j]
    if (!peg) return
    peg.classList.remove("is-hit")
    void peg.offsetWidth
    peg.classList.add("is-hit")
  }

  function dropBall(slot) {
    var board = $("plinko-board")
    var width = board.clientWidth
    var height = board.clientHeight
    var ball = el("span", "plinko-ball")
    board.appendChild(ball)
    var moves = pathTo(slot)
    var frames = [{ transform: "translate(" + (0.5 * width) + "px, " + (0.01 * height) + "px)", offset: 0 }]
    var hits = []
    var rights = 0
    var total = ROWS + 1
    for (var row = 0; row < ROWS; row++) {
      // Toca el clavo de la fila, rebota hacia arriba y cae hacia el lado.
      var x = pegX(row, rights)
      var hitAt = (row + 0.6) / total
      frames.push({ transform: "translate(" + (x * width) + "px, " + ((rowY(row) - 0.025) * height) + "px)", offset: hitAt, easing: "ease-out" })
      var next = x + moves[row] / (2 * SLOT_COUNT)
      frames.push({ transform: "translate(" + (((x + next) / 2) * width) + "px, " + ((rowY(row) - 0.045) * height) + "px)", offset: hitAt + 0.18 / total, easing: "ease-in" })
      hits.push({ row: row, j: rights, at: hitAt, x: x })
      if (moves[row] > 0) rights += 1
    }
    frames.push({ transform: "translate(" + (slotX(slot) * width) + "px, " + (SLOT_Y * height) + "px)", offset: 1 })
    var duration = STEP_MS * total
    hits.forEach(function (hit) { setTimeout(function () { hitPeg(hit) }, hit.at * duration) })
    restart(board.querySelector(".plinko-dropper"), "is-drop")
    sound("launch")
    // Estela: copias de la bola que siguen el mismo camino un poco despues.
    var ghosts = []
    if (!reducedMotion) {
      for (var g = 1; g <= GHOSTS; g++) {
        var ghost = el("span", "plinko-ball is-ghost g" + g)
        board.insertBefore(ghost, ball)
        ghost.animate(frames, { duration: duration, delay: g * GHOST_LAG_MS, fill: "both" })
        ghosts.push(ghost)
      }
    }
    var animation = ball.animate(frames, { duration: duration, fill: "forwards" })
    return animation.finished.catch(function () {}).then(function () {
      ghosts.forEach(function (ghost) { ghost.remove() })
      ball.classList.add("is-landed")
      setTimeout(function () { ball.remove() }, 900)
    })
  }

  // La casilla atrapa la bola: rebote siempre; con premio, haz de luz, el
  // premio flotando, contador de premios y celebracion segun la rareza.
  function markSlot(slot, tier, single) {
    var node = $("plinko-slots").children[slot]
    if (!node) return
    var x = slotX(slot)
    sound("land", { tier: tier, pan: panOf(x) })
    window.SoundKit.haptic(tier === "nada" ? 12 : 35)
    restart(node, tier === "nada" ? "is-catch" : "is-win")
    var board = $("plinko-board")
    board.classList.remove("is-jackpot")
    if (tier === "legendario") { void board.offsetWidth; board.classList.add("is-jackpot") }
    if (tier === "nada") {
      var slots = info.plinko.slots
      if (single && (slots[slot - 1] === "legendario" || slots[slot + 1] === "legendario")) fxPiece("plinko-float t-nada", x, null, "¡Uy, casi!", 1300)
      return
    }
    if (!reducedMotion) {
      fxPiece("plinko-beam " + tierClass(tier), x, null, null, 1200)
      fxPiece("plinko-float " + tierClass(tier), x, null, "+" + TIER_LABELS[tier], 1300)
    }
    prizesThisPlay += 1
    var combo = board.querySelector(".plinko-combo")
    combo.textContent = prizesThisPlay === 1 ? "1 premio" : prizesThisPlay + " premios"
    restart(combo, "is-on")
    var kit = window.GameKit
    var rect = node.getBoundingClientRect()
    var origin = { x: rect.left + rect.width / 2, y: rect.top }
    if (tier === "legendario") kit.celebrate("jackpot", TIER_COLORS.legendario, origin)
    else if (tier === "epico") kit.celebrate("big", TIER_COLORS.epico, origin, true)
    else if (single) kit.celebrate("small", TIER_COLORS.raro, origin, true)
  }

  function prizeArt(prize) {
    var art = el("span", "plinko-prize-art")
    if (prize.image) {
      var img = document.createElement("img")
      img.src = prize.image
      img.alt = ""
      img.width = 56
      img.height = 56
      art.appendChild(img)
    } else {
      art.textContent = prize.icon || String(prize.name || "?").charAt(0)
    }
    return art
  }

  function prizeLabel(ball) {
    return TIER_LABELS[ball.tier] + (ball.prize.kind === "card" ? " · Gachapon" : " · Mimic")
  }

  function bestTier(balls) {
    return TIER_ORDER.filter(function (tier) { return balls.some(function (ball) { return ball.tier === tier }) })[0] || "nada"
  }

  // Premios iguales juntos ("x2"), de mas raro a menos.
  function groupPrizes(won) {
    var groups = []
    won.slice().sort(function (a, b) { return TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) }).forEach(function (ball) {
      var key = ball.prize.kind + ":" + ball.prize.name
      var group = groups.filter(function (item) { return item.key === key })[0]
      if (group) group.qty += 1
      else groups.push({ key: key, ball: ball, qty: 1 })
    })
    return groups
  }

  // Una bola: el premio en grande. Varias: lista de premios y cuantas no dieron nada.
  function showResult(balls) {
    var box = $("plinko-result")
    box.textContent = ""
    var won = balls.filter(function (ball) { return ball.prize })
    box.className = "plinko-result is-shown " + tierClass(bestTier(balls)) + (balls.length > 1 ? " is-multi" : "")
    if (!won.length) {
      box.appendChild(el("strong", "", balls.length > 1 ? "Nada esta vez (" + balls.length + " bolas)" : "Nada esta vez"))
      box.appendChild(el("span", "", balls.length > 1 ? "Todas cayeron en el centro. Prueba otra vez." : "La bola cayó en el centro. Prueba otra vez."))
      return
    }
    if (balls.length === 1) {
      var prize = won[0].prize
      box.appendChild(prizeArt(prize))
      var text = el("span", "plinko-prize-text")
      text.appendChild(el("span", "rarity", prizeLabel(won[0])))
      text.appendChild(el("strong", "", prize.name))
      text.appendChild(el("span", "", prize.kind === "card" ? "Ya está en tu colección." : "Ya está en Tus Mimics."))
      box.appendChild(text)
      return
    }
    box.appendChild(el("strong", "", won.length + (won.length === 1 ? " premio" : " premios") + " en " + balls.length + " bolas"))
    var list = el("ul", "plinko-prizes")
    groupPrizes(won).forEach(function (group) {
      var item = el("li", tierClass(group.ball.tier))
      item.appendChild(prizeArt(group.ball.prize))
      var line = el("span", "plinko-prize-text")
      line.appendChild(el("span", "rarity", prizeLabel(group.ball)))
      line.appendChild(el("strong", "", group.ball.prize.name))
      item.appendChild(line)
      if (group.qty > 1) item.appendChild(el("b", "", "x" + group.qty))
      list.appendChild(item)
    })
    box.appendChild(list)
    var empty = balls.length - won.length
    if (empty) box.appendChild(el("span", "plinko-empty", empty + (empty === 1 ? " bola sin premio" : " bolas sin premio")))
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

  // Suelta las bolas escalonadas; cada casilla se ilumina cuando cae la suya.
  function dropAll(balls) {
    return Promise.all(balls.map(function (ball, index) {
      var single = balls.length === 1
      if (reducedMotion) { markSlot(ball.slot, ball.tier, single); return Promise.resolve() }
      return wait(index * BALL_GAP_MS).then(function () { return dropBall(ball.slot) }).then(function () { markSlot(ball.slot, ball.tier, single) })
    }))
  }

  function play() {
    if (playing || !info) return
    playing = true
    prizesThisPlay = 0
    renderSide()
    $("plinko-result").className = "plinko-result"
    app().api("/api/games/plinko", { method: "POST", body: { key: app().randomKey(), count: count } }).then(function (result) {
      points = result.balance
      renderSide()
      if (result.balls.length < result.requested) app().toast("Solo te alcanzó para " + result.balls.length + (result.balls.length === 1 ? " bola." : " bolas."))
      return dropAll(result.balls).then(function () {
        showResult(result.balls)
        history = result.balls.slice().reverse().concat(history).slice(0, HISTORY_SIZE)
        var won = result.balls.filter(function (ball) { return ball.prize })
        var jackpot = won.filter(function (ball) { return ball.tier === "legendario" })[0]
        if (jackpot) app().toast("Premio mayor: " + jackpot.prize.name + "!")
        else if (won.length === 1) app().toast("Ganaste " + won[0].prize.name)
        else if (won.length > 1) app().toast("Ganaste " + won.length + " premios")
        window.LiveFeed.nudge()
        return app().reload().catch(function () {})
      })
    }).catch(function (error) {
      app().toast(error.message)
    }).then(function () {
      playing = false
      renderSide()
    })
  }

  // ── Datos ───────────────────────────────────────────────────────────────────
  function refresh() {
    if (!app()) return Promise.resolve()
    return app().api("/api/games").then(function (result) {
      var first = !info
      info = result
      if (first) buildBoard()
      renderSide()
    }).catch(function (error) { if (visible) app().toast(error.message) })
  }

  function onViewer(viewer) {
    if (!playing) points = Number(viewer.points) || 0
    if (info) renderSide()
    else if (visible) refresh()
  }

  function setVisible(isVisible) {
    visible = isVisible
    if (visible) refresh()
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("plinko-play").addEventListener("click", play)
    window.LiveFeed.list($("plinko-live"), { games: ["plinko"] })
  })

  window.PlinkoGame = { onViewer: onViewer, setVisible: setVisible }
})()
