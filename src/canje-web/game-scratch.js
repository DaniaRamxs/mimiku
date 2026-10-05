// Rasca y gana (pestana Minijuegos). Se compra un boleto (el servidor decide
// las 3 casillas y el premio) y se rasca de verdad: la capa plateada es un
// canvas que se borra con el raton o el dedo, suelta polvo de plata, y cada
// casilla se destapa sola al rascar mas de la mitad. Con 3 iguales, un rayo
// dorado une las casillas y cae confeti. "Rascar todo" lo hace solo.
(function () {
  "use strict"

  var CELLS = 3
  var REVEAL_AT = 0.5
  var BRUSH = 26
  // Dibujos de cada simbolo (SVG estatico, sin datos del usuario).
  var ART = {
    moneda: '<svg viewBox="0 0 64 64"><defs><radialGradient id="gm" cx="35%" cy="30%"><stop offset="0" stop-color="#fff7cc"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></radialGradient></defs><circle cx="32" cy="32" r="26" fill="url(#gm)" stroke="#92400e" stroke-width="2"/><circle cx="32" cy="32" r="19" fill="none" stroke="#fde68a" stroke-width="2" stroke-dasharray="3 3"/><path d="M32 18l4 9 10 1-7.5 6.7 2.3 9.8L32 39.5 23.2 44.5l2.3-9.8L18 28l10-1z" fill="#fef3c7"/></svg>',
    bolsa: '<svg viewBox="0 0 64 64"><defs><linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a3e635"/><stop offset="1" stop-color="#3f6212"/></linearGradient></defs><path d="M24 14h16l-4 8h-8z" fill="#65a30d"/><path d="M26 22h12c10 6 16 16 14 26-1 6-7 10-20 10S13 54 12 48c-2-10 4-20 14-26z" fill="url(#gb)" stroke="#1a2e05" stroke-width="2"/><rect x="24" y="20" width="16" height="4" rx="2" fill="#fbbf24"/><circle cx="32" cy="42" r="8" fill="#fbbf24" stroke="#92400e" stroke-width="2"/><path d="M32 37v10" stroke="#92400e" stroke-width="2.5"/></svg>',
    cofre: '<svg viewBox="0 0 64 64"><defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b45309"/><stop offset="1" stop-color="#78350f"/></linearGradient></defs><path d="M10 28a12 12 0 0 1 12-12h20a12 12 0 0 1 12 12v4H10z" fill="#d97706" stroke="#451a03" stroke-width="2"/><rect x="10" y="30" width="44" height="22" rx="3" fill="url(#gc)" stroke="#451a03" stroke-width="2"/><rect x="16" y="16" width="5" height="36" fill="#fbbf24"/><rect x="43" y="16" width="5" height="36" fill="#fbbf24"/><rect x="27" y="27" width="10" height="11" rx="2" fill="#fde68a" stroke="#451a03" stroke-width="2"/></svg>',
    bolas: '<svg viewBox="0 0 64 64"><defs><radialGradient id="gpb" cx="35%" cy="30%"><stop offset="0" stop-color="#fff7cc"/><stop offset=".45" stop-color="#ffd54a"/><stop offset="1" stop-color="#d97706"/></radialGradient></defs><g fill="#c9b8ff" stroke="#6d55b8"><circle cx="12" cy="14" r="3.5"/><circle cx="52" cy="14" r="3.5"/><circle cx="9" cy="42" r="3.5"/><circle cx="55" cy="42" r="3.5"/><circle cx="32" cy="8" r="3.5"/></g><circle cx="32" cy="34" r="17" fill="url(#gpb)" stroke="#92400e" stroke-width="2"/><path d="M24 26l5-4" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
    tiradas: '<svg viewBox="0 0 64 64"><path d="M12 32a20 20 0 0 1 40 0z" fill="#ec4899" stroke="#831843" stroke-width="2"/><path d="M12 32a20 20 0 0 0 40 0z" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/><rect x="10" y="29" width="44" height="6" rx="3" fill="#1f1530"/><circle cx="24" cy="21" r="4" fill="#fff" opacity=".85"/><path d="M47 10l1.5 4 4 1.5-4 1.5L47 21l-1.5-4-4-1.5 4-1.5z" fill="#fde68a"/></svg>',
    diamante: '<svg viewBox="0 0 64 64"><path d="M14 24L22 12h20l8 12L32 54z" fill="#67e8f9" stroke="#0e7490" stroke-width="2" stroke-linejoin="round"/><path d="M22 12l6 12h8l6-12M14 24h36M28 24l4 30 4-30" fill="none" stroke="#ecfeff" stroke-width="1.5"/><path d="M22 12l6 12H14z" fill="#cffafe"/><path d="M50 6l1.5 4 4 1.5-4 1.5L50 17l-1.5-4-4-1.5 4-1.5z" fill="#fff"/></svg>',
    gem: '<svg viewBox="0 0 64 64"><path class="gem-body" d="M16 22l8-10h16l8 10-16 30z" stroke="rgba(0,0,0,.5)" stroke-width="2"/><path d="M16 22h32L32 52z" fill="rgba(0,0,0,.18)"/><path d="M24 12l8 10 8-10M16 22l16 30 16-30" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/><path d="M22 18l5-5" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
  }
  var GEM_COLORS = { raro: "#3b82f6", epico: "#a855f7", legendario: "#f59e0b" }
  // Color de la celebracion de cada premio.
  var WIN_COLORS = { raro: "#3b82f6", epico: "#a855f7", legendario: "#f59e0b", diamante: "#22d3ee", tiradas: "#ec4899", bolas: "#f59e0b" }
  var JACKPOTS = ["legendario", "diamante"]
  var BIG_WINS = ["epico", "bolsa", "tiradas", "bolas"]

  var kit = window.GameKit
  var ui = null
  var ticket = null // { cells, win, prize, revealed: [bool], done }
  var buying = false
  var drawing = false
  var lastPoint = null
  var moves = 0
  var history = []
  var scratchSound = null // ruido de rascar mientras el dedo se mueve
  var lastMove = null
  var tease = null // tension cuando las dos primeras casillas coinciden

  function el(tag, className, text) { return kit.el(tag, className, text) }

  function symbolNode(id) {
    var node = el("span", "sc-symbol s-" + id)
    node.innerHTML = ART[id] || ART.gem
    if (GEM_COLORS[id]) node.style.setProperty("--gem", GEM_COLORS[id])
    return node
  }

  // ── Capa plateada ───────────────────────────────────────────────────────────
  function paintFoil() {
    var canvas = ui.canvas
    var rect = canvas.getBoundingClientRect()
    var ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    var ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.globalCompositeOperation = "source-over"
    var grad = ctx.createLinearGradient(0, 0, rect.width, rect.height)
    grad.addColorStop(0, "#9ca3af"); grad.addColorStop(0.25, "#f3f4f6"); grad.addColorStop(0.5, "#a1a1aa")
    grad.addColorStop(0.75, "#e5e7eb"); grad.addColorStop(1, "#71717a")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, rect.width, rect.height)
    // Grano metalico
    for (var i = 0; i < rect.width * rect.height / 18; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.08)"
      ctx.fillRect(Math.random() * rect.width, Math.random() * rect.height, 1.2, 1.2)
    }
    // Texto "RASCA" repetido en diagonal
    ctx.save()
    ctx.fillStyle = "rgba(63,63,70,.22)"
    ctx.font = "800 15px Baloo 2, sans-serif"
    ctx.rotate(-0.35)
    for (var y = -rect.width; y < rect.height * 2; y += 30) {
      for (var x = -rect.width; x < rect.width * 2; x += 90) ctx.fillText("RASCA", x + (y % 60 ? 45 : 0), y)
    }
    ctx.restore()
    // Separadores entre casillas
    ctx.fillStyle = "rgba(24,24,27,.25)"
    for (var c = 1; c < CELLS; c++) ctx.fillRect(rect.width * c / CELLS - 1, 8, 2, rect.height - 16)
    ui.foil.classList.remove("is-gone")
  }

  function scratchAt(x, y) {
    var ctx = ui.canvas.getContext("2d")
    ctx.globalCompositeOperation = "destination-out"
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = BRUSH * 2
    ctx.beginPath()
    if (lastPoint) ctx.moveTo(lastPoint.x, lastPoint.y)
    else ctx.moveTo(x - 0.1, y)
    ctx.lineTo(x, y)
    ctx.stroke()
    if (scratchSound && lastPoint) {
      var now = performance.now()
      var dt = Math.max(8, now - (lastMove || now - 16))
      var speed = Math.hypot(x - lastPoint.x, y - lastPoint.y) / dt
      scratchSound.set(Math.min(1, speed / 1.6))
      lastMove = now
    }
    lastPoint = { x: x, y: y }
    dust(x, y)
    moves += 1
    if (moves % 8 === 0) checkCells()
  }

  // Polvo de plata que cae al rascar.
  function dust(x, y) {
    if (kit.reducedMotion || Math.random() < 0.45) return
    var bit = el("span", "sc-dust")
    bit.style.left = x + "px"
    bit.style.top = y + "px"
    bit.style.setProperty("--dx", (Math.random() - 0.5) * 60 + "px")
    bit.style.setProperty("--rot", Math.random() * 360 + "deg")
    ui.ticketArea.appendChild(bit)
    setTimeout(function () { bit.remove() }, 900)
  }

  // Cuanto se ha rascado de cada casilla (muestreando la transparencia).
  function clearedShare(index) {
    var canvas = ui.canvas
    var ctx = canvas.getContext("2d", { willReadFrequently: true })
    var cellWidth = canvas.width / CELLS
    var data = ctx.getImageData(Math.floor(cellWidth * index), 0, Math.floor(cellWidth), canvas.height).data
    var clear = 0
    var total = 0
    for (var i = 3; i < data.length; i += 4 * 24) { total += 1; if (data[i] < 40) clear += 1 }
    return total ? clear / total : 0
  }

  function checkCells() {
    if (!ticket || ticket.done) return
    for (var i = 0; i < CELLS; i++) if (!ticket.revealed[i] && clearedShare(i) >= REVEAL_AT) revealCell(i)
  }

  // Destapa del todo una casilla (con un golpe de brillo).
  function revealCell(index) {
    ticket.revealed[index] = true
    var canvas = ui.canvas
    var ctx = canvas.getContext("2d", { willReadFrequently: true })
    var ratio = window.devicePixelRatio || 1
    var width = canvas.width / ratio / CELLS
    ctx.globalCompositeOperation = "destination-out"
    ctx.fillRect(width * index, 0, width, canvas.height / ratio)
    var cell = ui.cells[index]
    kit.restart(cell, "is-revealed")
    var shown = ticket.revealed.filter(Boolean).length
    kit.sparks(kit.centerOf(cell), "#fde68a", 12)
    kit.sound("reveal", { index: shown - 1 })
    kit.haptic(18)
    // Dos casillas iguales destapadas: sube la tension hasta la tercera.
    if (shown === 2 && !tease) {
      var open = ticket.cells.filter(function (value, i) { return ticket.revealed[i] })
      if (open[0] === open[1]) {
        tease = window.SoundKit.loop("drone")
        tease.set(0.75)
        ui.ticket.classList.add("is-tense")
      }
    }
    if (ticket.revealed.every(Boolean)) finish()
  }

  function stopScratchSound() {
    if (scratchSound) { scratchSound.stop(); scratchSound = null }
  }

  function finish() {
    ticket.done = true
    stopScratchSound()
    if (tease) { tease.stop(); tease = null }
    ui.ticket.classList.remove("is-tense")
    ui.foil.classList.add("is-gone")
    var cells = ticket.cells
    var result = ui.result
    result.textContent = ""
    if (ticket.win) {
      ui.cells.forEach(function (cell) { cell.classList.add("is-win") })
      kit.restart(ui.bolt, "is-on")
      kit.restart(ui.stamp, "is-on")
      kit.floatText(kit.centerOf(ui.ticket), kit.prizeText(ticket.prize), WIN_COLORS[ticket.win] || "#fbbf24")
      var jackpot = JACKPOTS.indexOf(ticket.win) >= 0
      kit.celebrate(jackpot ? "jackpot" : BIG_WINS.indexOf(ticket.win) >= 0 ? "big" : "small", WIN_COLORS[ticket.win] || "#fbbf24")
      if (jackpot) kit.flash(WIN_COLORS[ticket.win])
      result.className = "g-result is-win"
      result.appendChild(el("strong", "", "¡Premio!"))
      var bonus = ticket.result && ticket.result.bonus
      result.appendChild(el("span", "", kit.prizeText(ticket.prize) + (bonus ? " + " + kit.prizeText(bonus) : "")))
    } else {
      var pair = cells[0] === cells[1] || cells[1] === cells[2] || cells[0] === cells[2]
      if (pair) ui.cells.forEach(function (cell, i) {
        var matches = cells.filter(function (value) { return value === cells[i] }).length
        if (matches === 1) kit.shake(cell)
      })
      result.className = "g-result"
      result.appendChild(el("strong", "", pair ? "¡Casi!" : "Sin premio"))
      result.appendChild(el("span", "", pair ? "Te faltó una casilla." : "Prueba con otro boleto."))
    }
    history = [{ win: ticket.win, prize: ticket.prize }].concat(history).slice(0, 6)
    paintHistory()
    paintButtons()
    kit.afterPlay(ticket.result)
  }

  // "Rascar todo": un pincel que recorre el boleto en zigzag.
  function autoScratch() {
    if (!ticket || ticket.done) return
    var rect = ui.canvas.getBoundingClientRect()
    var points = []
    for (var row = 0; row <= 4; row++) {
      var y = (row + 0.5) * rect.height / 5
      for (var step = 0; step <= 14; step++) points.push({ x: (row % 2 ? 14 - step : step) * rect.width / 14, y: y })
    }
    lastPoint = null
    var i = 0
    ui.auto.disabled = true
    if (!scratchSound) scratchSound = window.SoundKit.loop("scratch")
    scratchSound.set(0.55)
    function frame() {
      for (var n = 0; n < 3 && i < points.length; n++, i++) scratchAt(points[i].x, points[i].y)
      if (i < points.length && !ticket.done) requestAnimationFrame(frame)
      else { lastPoint = null; stopScratchSound(); for (var c = 0; c < CELLS; c++) if (!ticket.revealed[c]) revealCell(c) }
    }
    requestAnimationFrame(frame)
  }

  // ── Comprar ─────────────────────────────────────────────────────────────────
  function buy() {
    if (buying) return
    buying = true
    paintButtons()
    kit.post("/api/games/scratch", { key: window.CanjeApp.randomKey() }).then(function (result) {
      ticket = { cells: result.cells, win: result.win, prize: result.prize, revealed: [false, false, false], done: false, result: result }
      kit.sound("ticket")
      ui.cells.forEach(function (cell, i) {
        cell.className = "sc-cell"
        cell.textContent = ""
        cell.appendChild(symbolNode(result.cells[i]))
      })
      ui.result.className = "g-result is-hidden"
      ui.result.textContent = ""
      ui.stamp.classList.remove("is-on")
      kit.restart(ui.ticket, "is-new")
      paintFoil()
      if (typeof result.balance === "number") kit.countUp(ui.points, result.balance, 600)
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () {
      buying = false
      paintButtons()
    })
  }

  function paintButtons() {
    var info = kit.info()
    var price = info ? info.scratch.price : 0
    var playing = ticket && !ticket.done
    ui.buy.textContent = buying ? "..." : playing ? "Rasca el boleto" : (ticket ? "Otro boleto · " : "Comprar boleto · ") + kit.fmt(price) + " pts"
    ui.buy.disabled = buying || playing || kit.points() < price
    ui.auto.hidden = !playing
    ui.auto.disabled = false
  }

  function paintHistory() {
    ui.history.textContent = ""
    if (!history.length) ui.history.appendChild(el("li", "muted", "Todavía no has rascado ningún boleto."))
    history.forEach(function (entry) {
      var item = el("li", entry.win ? "is-win" : "")
      item.appendChild(el("span", "plinko-dot"))
      item.appendChild(el("span", "", entry.win ? kit.prizeText(entry.prize) : "Sin premio"))
      ui.history.appendChild(item)
    })
  }

  function paintOdds(info) {
    ui.odds.textContent = ""
    ;["legendario", "diamante", "epico", "raro", "cofre", "bolsa", "tiradas", "bolas", "moneda"].forEach(function (id) {
      if (!info.scratch.symbols[id]) return
      var item = el("li", "sc-odd")
      item.appendChild(symbolNode(id))
      item.appendChild(el("span", "", "3 x " + info.scratch.symbols[id]))
      ui.odds.appendChild(item)
    })
  }

  // ── Construccion ────────────────────────────────────────────────────────────
  function build(section, info) {
    var parts = kit.layout(section, { id: "scratch", title: "Rasca y gana", hint: "Compra un boleto y rasca las 3 casillas con el ratón o el dedo. Si salen 3 iguales, te llevas ese premio." })
    ui = { points: parts.points }
    var table = el("div", "sc-table")
    var ticketNode = el("div", "sc-ticket")
    ticketNode.appendChild(el("div", "sc-holo"))
    var head = el("div", "sc-head")
    head.appendChild(el("span", "sc-brand", "RASCA Y GANA"))
    head.appendChild(el("span", "sc-serial", "Nº " + String(Math.floor(Math.random() * 900000) + 100000)))
    ticketNode.appendChild(head)
    var area = el("div", "sc-area")
    var row = el("div", "sc-cells")
    ui.cells = []
    for (var i = 0; i < CELLS; i++) {
      var cell = el("div", "sc-cell")
      cell.appendChild(el("span", "sc-q", "?"))
      row.appendChild(cell)
      ui.cells.push(cell)
    }
    area.appendChild(row)
    var bolt = el("div", "sc-bolt")
    area.appendChild(bolt)
    var foil = el("div", "sc-foil")
    var canvas = document.createElement("canvas")
    canvas.className = "sc-canvas"
    foil.appendChild(canvas)
    foil.appendChild(el("span", "sc-shine"))
    area.appendChild(foil)
    ticketNode.appendChild(area)
    ticketNode.appendChild(el("p", "sc-foot", "3 iguales = premio. Premio mayor: legendario + 10 tiradas o diamante x20."))
    var stamp = el("span", "sc-stamp", "GANADOR")
    ticketNode.appendChild(stamp)
    ui.stamp = stamp
    table.appendChild(ticketNode)
    parts.stage.appendChild(table)
    ui.ticket = ticketNode
    ui.ticketArea = area
    ui.canvas = canvas
    ui.foil = foil
    ui.bolt = bolt

    function pointAt(event) {
      var rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    canvas.addEventListener("pointerdown", function (event) {
      if (!ticket || ticket.done) return
      drawing = true
      lastPoint = null
      lastMove = null
      if (!scratchSound) scratchSound = window.SoundKit.loop("scratch")
      canvas.setPointerCapture(event.pointerId)
      var p = pointAt(event)
      scratchAt(p.x, p.y)
    })
    canvas.addEventListener("pointermove", function (event) {
      if (!drawing) return
      var p = pointAt(event)
      scratchAt(p.x, p.y)
    })
    function stop() { if (drawing) { drawing = false; lastPoint = null; stopScratchSound(); checkCells() } }
    canvas.addEventListener("pointerup", stop)
    canvas.addEventListener("pointercancel", stop)

    var buyButton = el("button", "btn btn-buy plinko-play", "Comprar boleto")
    buyButton.type = "button"
    buyButton.addEventListener("click", buy)
    var auto = el("button", "btn btn-quiet sc-auto", "Rascar todo")
    auto.type = "button"
    auto.hidden = true
    auto.addEventListener("click", autoScratch)
    parts.side.appendChild(buyButton)
    parts.side.appendChild(auto)
    var result = el("div", "g-result is-hidden")
    parts.side.appendChild(result)
    parts.side.appendChild(el("h3", "mini-title", "Premios"))
    var odds = el("ul", "sc-odds")
    parts.side.appendChild(odds)
    parts.side.appendChild(el("h3", "mini-title", "Tus últimos boletos"))
    var list = el("ul", "plinko-history")
    parts.side.appendChild(list)
    ui.buy = buyButton
    ui.auto = auto
    ui.result = result
    ui.odds = odds
    ui.history = list
    paintOdds(info)
    paintHistory()
    requestAnimationFrame(paintFoil)
    window.addEventListener("resize", function () { if (!ticket || ticket.done) paintFoil() })
  }

  kit.register("scratch", {
    build: build,
    show: function () { if (!ticket) requestAnimationFrame(paintFoil); paintButtons() },
    onViewer: function () { if (ui) paintButtons() },
    onInfo: function (info) { if (ui) { paintOdds(info); paintButtons() } },
  })
})()
