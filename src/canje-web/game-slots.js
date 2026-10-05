// Slots de personajes (pestana Minijuegos). Tres rodillos con los personajes
// de la "tira del dia" (los mismos para todos ese dia). El servidor decide
// donde para cada rodillo; aqui giran con desenfoque de movimiento y frenan
// uno detras de otro con un rebote. La linea de premio se enciende: cian con
// 2 iguales (se devuelve la apuesta), dorada con 3 (te llevas ese personaje)
// y arcoiris con 3 legendarios (jackpot con lluvia de monedas).
(function () {
  "use strict"

  var DEFAULT_ROW = 112
  var REPEAT = 10
  var BASE_MS = 1500
  var STEP_MS = 480
  // Si los dos primeros rodillos coinciden, el tercero gira este rato de mas.
  var ANTICIPATION_MS = 1600

  var kit = window.GameKit
  var ui = null
  var strip = []
  var positions = [0, 0, 0]
  var spinning = false
  var history = []

  function el(tag, className, text) { return kit.el(tag, className, text) }

  // Alto real de una fila (en movil es mas bajo).
  function rowHeight() {
    var first = ui && ui.reels[0].strip.firstElementChild
    return first && first.offsetHeight ? first.offsetHeight : DEFAULT_ROW
  }

  function symbol(card) {
    var node = el("div", "sl-symbol r-" + card.rarity)
    node.appendChild(kit.cardFace(card, "sl-face"))
    node.appendChild(el("span", "sl-name", card.name))
    return node
  }

  function fillReels() {
    ui.reels.forEach(function (reel) {
      reel.strip.textContent = ""
      for (var r = 0; r < REPEAT; r++) strip.forEach(function (card) { reel.strip.appendChild(symbol(card)) })
    })
    positions = [0, 1, 2].map(function (i) { return i % Math.max(1, strip.length) })
    ui.reels.forEach(function (reel, i) { place(reel, strip.length + positions[i]) })
  }

  // La fila `index` queda en el centro de la ventana. Se usa siempre una
  // vuelta intermedia de la tira, para que arriba y abajo haya personajes.
  function place(reel, index) { reel.strip.style.transform = "translateY(" + (-(index - 1) * rowHeight()) + "px)" }

  function spinReel(reel, i, target, extraMs) {
    var count = strip.length
    var from = count + positions[i] % count
    place(reel, from)
    var to = count * (4 + i * 2) + target
    positions[i] = target
    var duration = kit.reducedMotion ? 1 : BASE_MS + i * STEP_MS + (extraMs || 0)
    reel.window.classList.add("is-spinning")
    var start = -(from - 1) * rowHeight()
    var end = -(to - 1) * rowHeight()
    var animation = reel.strip.animate([
      { transform: "translateY(" + start + "px)" },
      { transform: "translateY(" + (start - rowHeight() * 0.35) + "px)", offset: 0.06, easing: "ease-in" },
      { transform: "translateY(" + (end - rowHeight() * 0.22) + "px)", offset: 0.9, easing: "cubic-bezier(.12,.72,.3,1)" },
      { transform: "translateY(" + end + "px)", easing: "cubic-bezier(.3,1.6,.5,1)" },
    ], { duration: duration, fill: "forwards" })
    setTimeout(function () { reel.window.classList.remove("is-spinning") }, duration * 0.82)
    return animation.finished.catch(function () {}).then(function () {
      animation.cancel()
      place(reel, count + target)
      kit.restart(reel.window, "is-stop")
      kit.sound("reel-stop", { pan: (i - 1) * 0.6 })
      kit.haptic(15)
      var center = reel.strip.children[count + target]
      if (center) kit.restart(center, "is-center")
    })
  }

  function pullLever() {
    kit.restart(ui.lever, "is-pulled")
    kit.sound("lever")
    play()
  }

  function play() {
    if (spinning || strip.length < 3) return
    spinning = true
    paintButton()
    ui.machine.classList.remove("is-pair", "is-triple", "is-jackpot", "is-anticipation")
    ui.banner.className = "sl-banner"
    ui.result.className = "g-result is-hidden"
    kit.post("/api/games/slots", { key: window.CanjeApp.randomKey() }).then(function (result) {
      ui.machine.classList.add("is-running")
      var hum = window.SoundKit.loop("reel")
      // Anticipacion: dos iguales en los dos primeros -> el tercero tarda y sube la tension.
      var tease = !kit.reducedMotion && strip[result.reels[0]] && strip[result.reels[1]] && strip[result.reels[0]].id === strip[result.reels[1]].id
      var spins = ui.reels.map(function (reel, i) { return spinReel(reel, i, result.reels[i], tease && i === 2 ? ANTICIPATION_MS : 0) })
      if (tease) {
        spins[1].then(function () {
          ui.machine.classList.add("is-anticipation")
          kit.sound("riser", { dur: (STEP_MS + ANTICIPATION_MS) / 1000 })
        })
      }
      return Promise.all(spins).then(function () { hum.stop(); ui.machine.classList.remove("is-anticipation"); land(result) }, function (error) { hum.stop(); throw error })
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () {
      spinning = false
      ui.machine.classList.remove("is-running")
      paintButton()
    })
  }

  function land(result) {
    var box = ui.result
    box.textContent = ""
    var card = strip[result.reels[0]]
    if (result.line === "triple") {
      ui.machine.classList.add(result.jackpot ? "is-jackpot" : "is-triple")
      ui.banner.textContent = result.jackpot ? "JACKPOT" : "¡TRIPLE!"
      kit.restart(ui.banner, "is-on")
      kit.celebrate(result.jackpot ? "jackpot" : "big", kit.RARITY_COLORS[card.rarity])
      kit.celebrate("coins", "#fbbf24", kit.centerOf(ui.tray), true)
      kit.floatText(kit.centerOf(ui.banner), kit.prizeText(result.prize), kit.RARITY_COLORS[card.rarity])
      ui.reels.forEach(function (reel) { kit.sparks(kit.centerOf(reel.window), kit.RARITY_COLORS[card.rarity], 12) })
      if (result.jackpot) { kit.flash("#fbbf24"); setTimeout(function () { kit.celebrate("coins") }, 600) }
      box.className = "g-result is-win"
      box.appendChild(el("strong", "", result.jackpot ? "¡Jackpot!" : "¡Tres iguales!"))
      box.appendChild(el("span", "", kit.prizeText(result.prize) + (result.bonus ? " + " + kit.prizeText(result.bonus) : "")))
    } else if (result.line === "pair") {
      ui.machine.classList.add("is-pair")
      kit.sound("correct")
      // El rodillo que no coincide tiembla (casi).
      var picks = result.reels.map(function (index) { return strip[index] && strip[index].id })
      picks.forEach(function (id, i) {
        if (picks.filter(function (other) { return other === id }).length === 1) kit.restart(ui.reels[i].window, "fx-shake")
      })
      box.className = "g-result"
      box.appendChild(el("strong", "", "Dos iguales"))
      box.appendChild(el("span", "", "Recuperas tu apuesta."))
    } else {
      box.className = "g-result"
      box.appendChild(el("strong", "", "Sin premio"))
      box.appendChild(el("span", "", "Tira otra vez."))
    }
    history = [{ line: result.line, jackpot: result.jackpot, prize: result.prize, bonus: result.bonus }].concat(history).slice(0, 6)
    paintHistory()
    kit.afterPlay(result)
  }

  function paintButton() {
    var info = kit.info()
    if (!info || !ui) return
    var price = info.slots.price
    var ready = strip.length >= 3
    ui.button.textContent = spinning ? "Girando..." : ready ? "Tirar · " + kit.fmt(price) + " pts" : "Hacen falta 3 personajes"
    ui.button.disabled = spinning || !ready || kit.points() < price
    ui.lever.classList.toggle("is-locked", ui.button.disabled)
  }

  function paintHistory() {
    ui.history.textContent = ""
    if (!history.length) ui.history.appendChild(el("li", "muted", "Todavía no has tirado."))
    history.forEach(function (entry) {
      var item = el("li", entry.line === "triple" ? "is-win" : "")
      item.appendChild(el("span", "plinko-dot"))
      item.appendChild(el("span", "", entry.jackpot ? "Jackpot" : entry.line === "triple" ? "Triple" : entry.line === "pair" ? "Dos iguales" : "Nada"))
      item.appendChild(el("b", "", entry.line === "triple" ? kit.prizeText(entry.prize) : entry.line === "pair" ? "Apuesta devuelta" : ""))
      ui.history.appendChild(item)
    })
  }

  function paintPaytable() {
    ui.paytable.textContent = ""
    ;[["legendario", "3 legendarios", "El personaje + jackpot de puntos"], ["epico", "3 épicos", "El personaje + puntos extra"], ["raro", "3 raros o comunes", "Te llevas ese personaje"], ["pair", "2 iguales", "Recuperas la apuesta"]].forEach(function (row) {
      var item = el("li", row[0] === "pair" ? "t-pair" : "r-" + row[0])
      item.appendChild(el("span", "plinko-dot"))
      item.appendChild(el("span", "", row[1]))
      item.appendChild(el("b", "", row[2]))
      ui.paytable.appendChild(item)
    })
  }

  function build(section, info) {
    strip = info.slots.strip
    var parts = kit.layout(section, { id: "slots", title: "Slots de personajes", hint: "Los rodillos llevan los personajes del día. Tres iguales y te llevas ese personaje; tres legendarios, jackpot." })
    ui = { points: parts.points }
    var machine = el("div", "sl-machine")
    var sign = el("div", "sl-sign")
    "SLOTS".split("").forEach(function (letter, i) {
      var span = el("span", "sl-letter", letter)
      span.style.setProperty("--i", String(i))
      sign.appendChild(span)
    })
    machine.appendChild(sign)
    var body = el("div", "sl-body")
    var windows = el("div", "sl-windows")
    ui.reels = [0, 1, 2].map(function () {
      var windowNode = el("div", "sl-window")
      var stripNode = el("div", "sl-strip")
      windowNode.appendChild(stripNode)
      windowNode.appendChild(el("span", "sl-glass"))
      windows.appendChild(windowNode)
      return { window: windowNode, strip: stripNode }
    })
    windows.appendChild(el("span", "sl-line"))
    body.appendChild(windows)
    var banner = el("div", "sl-banner")
    body.appendChild(banner)
    machine.appendChild(body)
    var lever = el("button", "sl-lever")
    lever.type = "button"
    lever.setAttribute("aria-label", "Bajar la palanca")
    lever.appendChild(el("span", "sl-lever-stick"))
    lever.appendChild(el("span", "sl-lever-ball"))
    lever.addEventListener("click", function () { if (!ui.button.disabled) pullLever() })
    machine.appendChild(lever)
    var tray = el("div", "sl-tray")
    machine.appendChild(tray)
    machine.appendChild(el("span", "sl-chase"))
    ui.tray = tray
    parts.stage.appendChild(machine)
    ui.machine = machine
    ui.banner = banner
    ui.lever = lever

    var button = el("button", "btn btn-buy plinko-play", "Tirar")
    button.type = "button"
    button.addEventListener("click", pullLever)
    parts.side.appendChild(button)
    var result = el("div", "g-result is-hidden")
    parts.side.appendChild(result)
    parts.side.appendChild(el("h3", "mini-title", "Premios"))
    var paytable = el("ul", "plinko-odds sl-paytable")
    parts.side.appendChild(paytable)
    parts.side.appendChild(el("h3", "mini-title", "Tus últimas tiradas"))
    var list = el("ul", "plinko-history")
    parts.side.appendChild(list)
    ui.button = button
    ui.result = result
    ui.paytable = paytable
    ui.history = list
    if (strip.length) fillReels()
    paintPaytable()
    paintButton()
    paintHistory()
  }

  kit.register("slots", {
    build: build,
    show: paintButton,
    onViewer: function () { if (ui) paintButton() },
    onInfo: function (info) {
      if (!ui || spinning) return
      var changed = JSON.stringify(info.slots.strip.map(function (card) { return card.id })) !== JSON.stringify(strip.map(function (card) { return card.id }))
      strip = info.slots.strip
      if (changed && strip.length) fillReels()
      paintButton()
    },
  })
})()
