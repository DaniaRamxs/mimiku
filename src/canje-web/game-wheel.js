// Ruleta de la fortuna (pestana Minijuegos). El servidor decide el sector;
// aqui la rueda (SVG) gira muchas vueltas y frena con un pequeno rebote
// justo en ese sector. La aguja salta al pasar cada clavija, las bombillas
// del aro corren mientras gira y el sector ganador late al parar.
// Un giro gratis al dia; los demas se pagan.
(function () {
  "use strict"

  var SVG = "http://www.w3.org/2000/svg"
  var R = 200
  var BULBS = 24
  var SPIN_MS = 5600
  var TURNS = 7

  var kit = window.GameKit
  var ui = null
  var sectors = []
  var rotation = 0
  var spinning = false
  var idleFrame = 0
  var shown = false
  var history = []

  function el(tag, className, text) { return kit.el(tag, className, text) }

  function svg(tag, attrs) {
    var node = document.createElementNS(SVG, tag)
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]) })
    return node
  }

  function point(deg, radius) {
    var rad = deg * Math.PI / 180
    return [radius * Math.sin(rad), -radius * Math.cos(rad)]
  }

  function sectorPath(index, count, radius) {
    var size = 360 / count
    var a = point(index * size - size / 2, radius)
    var b = point(index * size + size / 2, radius)
    return "M0 0 L" + a[0].toFixed(2) + " " + a[1].toFixed(2) + " A" + radius + " " + radius + " 0 0 1 " + b[0].toFixed(2) + " " + b[1].toFixed(2) + " Z"
  }

  function shade(hex, amount) {
    var value = parseInt(hex.slice(1), 16)
    var channel = function (shift) { return Math.max(0, Math.min(255, ((value >> shift) & 255) + amount)) }
    return "rgb(" + channel(16) + "," + channel(8) + "," + channel(0) + ")"
  }

  // ── Dibujo de la rueda ──────────────────────────────────────────────────────
  function drawWheel() {
    var count = sectors.length
    var size = 360 / count
    var root = svg("svg", { viewBox: "-230 -230 460 460", class: "wh-svg", "aria-hidden": "true" })
    var defs = svg("defs")
    sectors.forEach(function (sector, i) {
      var grad = svg("radialGradient", { id: "whg-" + i, cx: "0", cy: "0", r: String(R), gradientUnits: "userSpaceOnUse" })
      grad.appendChild(svg("stop", { offset: "0.25", "stop-color": shade(sector.color, -60) }))
      grad.appendChild(svg("stop", { offset: "0.8", "stop-color": sector.color }))
      grad.appendChild(svg("stop", { offset: "1", "stop-color": shade(sector.color, 50) }))
      defs.appendChild(grad)
    })
    var rim = svg("linearGradient", { id: "wh-rim", x1: "0", y1: "0", x2: "1", y2: "1" })
    ;[["0", "#fde68a"], ["0.35", "#b45309"], ["0.55", "#fef3c7"], ["0.8", "#92400e"], ["1", "#fbbf24"]].forEach(function (stop) {
      rim.appendChild(svg("stop", { offset: stop[0], "stop-color": stop[1] }))
    })
    defs.appendChild(rim)
    var gloss = svg("radialGradient", { id: "wh-gloss", cx: "0.35", cy: "0.25", r: "0.8" })
    gloss.appendChild(svg("stop", { offset: "0", "stop-color": "rgba(255,255,255,.35)" }))
    gloss.appendChild(svg("stop", { offset: "0.6", "stop-color": "rgba(255,255,255,0)" }))
    defs.appendChild(gloss)
    var hub = svg("radialGradient", { id: "wh-hub", cx: "0.35", cy: "0.3", r: "0.8" })
    hub.appendChild(svg("stop", { offset: "0", "stop-color": "#fff7cc" }))
    hub.appendChild(svg("stop", { offset: "0.5", "stop-color": "#f59e0b" }))
    hub.appendChild(svg("stop", { offset: "1", "stop-color": "#78350f" }))
    defs.appendChild(hub)
    root.appendChild(defs)

    // Aro dorado con bombillas (fijo)
    root.appendChild(svg("circle", { r: String(R + 26), fill: "url(#wh-rim)", class: "wh-rim" }))
    root.appendChild(svg("circle", { r: String(R + 8), fill: "#1a0f2e" }))
    var bulbs = svg("g", { class: "wh-bulbs" })
    for (var b = 0; b < BULBS; b++) {
      var p = point(b * 360 / BULBS, R + 17)
      var bulb = svg("circle", { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: "6", class: "wh-bulb" + (b % 2 ? " odd" : "") })
      bulb.style.setProperty("--i", String(b))
      bulbs.appendChild(bulb)
    }
    root.appendChild(bulbs)

    // Rueda que gira
    var spin = svg("g", { class: "wh-spin" })
    sectors.forEach(function (sector, i) {
      spin.appendChild(svg("path", { d: sectorPath(i, count, R), fill: "url(#whg-" + i + ")", stroke: "rgba(0,0,0,.35)", "stroke-width": "2" }))
    })
    var win = svg("path", { d: sectorPath(0, count, R), class: "wh-win" })
    spin.appendChild(win)
    sectors.forEach(function (sector, i) {
      // Texto en direccion radial (del centro al borde), como en las ruletas reales:
      // con 16 casillas no cabe atravesado.
      var label = svg("text", { class: "wh-label" + (sector.label.length > 6 ? " is-long" : "") + (sector.big ? " is-big" : ""), transform: "rotate(" + (i * size - 90) + ") translate(" + (R * 0.6) + " 0)" })
      label.textContent = sector.label
      spin.appendChild(label)
      // Clavija en cada borde
      var peg = point(i * size + size / 2, R - 6)
      spin.appendChild(svg("circle", { cx: peg[0].toFixed(1), cy: peg[1].toFixed(1), r: "5", class: "wh-peg" }))
    })
    spin.appendChild(svg("circle", { r: String(R), fill: "url(#wh-gloss)", "pointer-events": "none" }))
    root.appendChild(spin)

    // Centro
    root.appendChild(svg("circle", { r: "46", fill: "url(#wh-hub)", stroke: "#451a03", "stroke-width": "3", class: "wh-hub" }))
    var star = svg("path", { d: "M0 -26 L7 -8 L26 -8 L11 4 L17 23 L0 12 L-17 23 L-11 4 L-26 -8 L-7 -8 Z", fill: "#fef3c7", stroke: "#92400e", "stroke-width": "2" })
    root.appendChild(star)
    ui.svg = root
    ui.spin = spin
    ui.winPath = win
    return root
  }

  function applyRotation() { ui.spin.setAttribute("transform", "rotate(" + rotation.toFixed(3) + ")") }

  // Giro lento cuando no se juega.
  function idle() {
    idleFrame = 0
    if (!shown || spinning || kit.reducedMotion) return
    rotation = (rotation + 0.06) % 360
    applyRotation()
    idleFrame = requestAnimationFrame(idle)
  }

  // La aguja salta y hace "clac" en cada clavija (el ritmo frena con la rueda).
  function tick() {
    kit.restart(ui.pointer, "is-tick")
    kit.sound("wheel-tick")
    var tip = ui.pointer.getBoundingClientRect()
    kit.sparks({ x: tip.left + tip.width / 2, y: tip.bottom - 4 }, "#fde68a", 2)
  }

  // Frenado con un pequeno rebote al final.
  function ease(t) {
    var c = 1.2
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
  }

  function spinTo(index) {
    return new Promise(function (resolve) {
      var size = 360 / sectors.length
      var jitter = (Math.random() - 0.5) * size * 0.6
      var start = rotation
      var target = -index * size + jitter
      var delta = ((target - start) % 360 + 360) % 360 + 360 * TURNS
      var end = start + delta
      var began = performance.now()
      var lastPeg = Math.floor((start + size / 2) / size)
      var duration = kit.reducedMotion ? 1 : SPIN_MS
      ui.wrap.classList.add("is-spinning")
      function frame(time) {
        var t = Math.min(1, (time - began) / duration)
        rotation = start + delta * ease(t)
        applyRotation()
        var peg = Math.floor((rotation + size / 2) / size)
        if (peg !== lastPeg) { lastPeg = peg; tick() }
        if (t < 1) requestAnimationFrame(frame)
        else { rotation = end % 360; applyRotation(); ui.wrap.classList.remove("is-spinning"); resolve() }
      }
      requestAnimationFrame(frame)
    })
  }

  // ── Jugar ───────────────────────────────────────────────────────────────────
  function play() {
    if (spinning) return
    spinning = true
    cancelAnimationFrame(idleFrame)
    ui.wrap.classList.remove("is-win", "is-lose")
    paintButton()
    ui.result.className = "g-result is-hidden"
    kit.post("/api/games/wheel", { key: window.CanjeApp.randomKey() }).then(function (result) {
      kit.sound("deal")
      return spinTo(result.sector).then(function () { kit.sound("reel-stop"); land(result) })
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () {
      spinning = false
      paintButton()
      kit.refreshInfo()
      setTimeout(function () { if (!spinning) idle() }, 2600)
    })
  }

  function land(result) {
    var sector = sectors[result.sector]
    ui.winPath.setAttribute("d", sectorPath(result.sector, sectors.length, R))
    var prize = result.prize
    var box = ui.result
    box.textContent = ""
    if (prize && prize.type === "lose") {
      ui.wrap.classList.add("is-lose")
      kit.flash("#e11d48", "lose")
      kit.shake(ui.stageBox)
      box.className = "g-result is-lose"
      box.appendChild(el("strong", "", sector.label))
      box.appendChild(el("span", "", "Pierdes " + kit.fmt(prize.amount) + " puntos."))
    } else if (prize) {
      ui.wrap.classList.add("is-win")
      var jackpot = !!sector.big
      kit.celebrate(jackpot ? "jackpot" : prize.type === "points" && prize.amount <= 0 ? "small" : "big", sector.color)
      if (jackpot) kit.flash("#fbbf24")
      kit.floatText(kit.centerOf(ui.svg), sector.label, sector.color)
      box.className = "g-result is-win"
      box.appendChild(el("strong", "", sector.label))
      box.appendChild(el("span", "", kit.prizeText(prize)))
    } else {
      kit.sound("tap")
      box.className = "g-result"
      box.appendChild(el("strong", "", "Nada"))
      box.appendChild(el("span", "", "La próxima vez será."))
    }
    history = [{ label: sector.label, color: sector.color, prize: prize }].concat(history).slice(0, 6)
    paintHistory()
    kit.afterPlay(result)
  }

  function paintButton() {
    var info = kit.info()
    if (!info || !ui) return
    var free = info.wheel.freeSpin
    ui.button.textContent = spinning ? "Girando..." : free ? "Giro gratis de hoy" : "Girar · " + kit.fmt(info.wheel.price) + " pts"
    ui.button.classList.toggle("is-free", free && !spinning)
    ui.button.disabled = spinning || (!free && kit.points() < info.wheel.price)
    ui.freeBadge.hidden = !free
  }

  function paintHistory() {
    ui.history.textContent = ""
    if (!history.length) ui.history.appendChild(el("li", "muted", "Todavía no has girado."))
    history.forEach(function (entry) {
      var item = el("li", "")
      var dot = el("span", "plinko-dot")
      dot.style.setProperty("--c", entry.color)
      item.appendChild(dot)
      item.appendChild(el("span", "", entry.label))
      item.appendChild(el("b", "", entry.prize ? kit.prizeText(entry.prize) : "Nada"))
      ui.history.appendChild(item)
    })
  }

  function build(section, info) {
    sectors = info.wheel.sectors
    var parts = kit.layout(section, { id: "wheel", title: "Ruleta de la fortuna", hint: "Gira la ruleta: multiplica tus puntos hasta x10, gana hasta 40 tiradas de gachapon o 30 bolas de Plinko, cofres, una funda o un personaje legendario. Cuidado con el -50%." })
    ui = { points: parts.points, stageBox: parts.stage }
    var wrap = el("div", "wh-wrap")
    var pointer = el("div", "wh-pointer")
    wrap.appendChild(pointer)
    wrap.appendChild(drawWheel())
    var badge = el("div", "wh-free", "GIRO GRATIS")
    wrap.appendChild(badge)
    parts.stage.appendChild(wrap)
    parts.stage.appendChild(el("div", "wh-stand"))
    wrap.insertBefore(el("span", "wh-rays"), wrap.firstChild)
    wrap.appendChild(el("span", "wh-blur"))
    ui.wrap = wrap
    ui.pointer = pointer
    ui.freeBadge = badge
    ui.svg.addEventListener("click", play)
    var button = el("button", "btn btn-buy plinko-play", "Girar")
    button.type = "button"
    button.addEventListener("click", play)
    parts.side.appendChild(button)
    var result = el("div", "g-result is-hidden")
    parts.side.appendChild(result)
    parts.side.appendChild(el("h3", "mini-title", "Tus últimos giros"))
    var list = el("ul", "plinko-history")
    parts.side.appendChild(list)
    ui.button = button
    ui.result = result
    ui.history = list
    applyRotation()
    paintButton()
    paintHistory()
  }

  kit.register("wheel", {
    build: build,
    show: function () { shown = true; paintButton(); if (!spinning && !idleFrame) idle() },
    hide: function () { shown = false; cancelAnimationFrame(idleFrame); idleFrame = 0 },
    onViewer: function () { if (ui) paintButton() },
    onInfo: function () { if (ui) paintButton() },
  })
})()
