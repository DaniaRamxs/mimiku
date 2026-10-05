// Alta o baja (pestana Minijuegos). Se apuesta y sale una carta del mazo
// (valor de A a K, con un personaje en el centro). Hay que adivinar si la
// siguiente sera mayor o menor: cada acierto multiplica la apuesta y se puede
// cobrar cuando se quiera; si se falla, se pierde. Las cartas salen del mazo
// volando y se dan la vuelta en 3D; la racha enciende llamas y la escalera.
(function () {
  "use strict"

  var FACES = { 1: "A", 11: "J", 12: "Q", 13: "K" }

  var kit = window.GameKit
  var ui = null
  var game = null
  var busy = false
  var bet = null
  var heart = null // latido mientras el multiplicador esta alto
  var HEART_FROM = 3

  function el(tag, className, text) { return kit.el(tag, className, text) }
  function faceOf(power) { return FACES[power] || String(power) }

  // Naipe con cara (valor + personaje) y dorso.
  function playingCard(power, card) {
    var node = el("div", "hl-card r-" + (card && card.rarity || "comun"))
    var inner = el("div", "hl-card-inner")
    var front = el("div", "hl-front")
    front.appendChild(el("span", "hl-corner tl", faceOf(power)))
    front.appendChild(el("span", "hl-corner br", faceOf(power)))
    var art = el("div", "hl-art")
    art.appendChild(kit.cardFace(card || { name: faceOf(power), rarity: "comun" }, "hl-face"))
    front.appendChild(art)
    front.appendChild(el("span", "hl-value", faceOf(power)))
    if (card) front.appendChild(el("span", "hl-name", card.name))
    var back = el("div", "hl-back")
    back.appendChild(el("span", "hl-back-logo"))
    inner.appendChild(front)
    inner.appendChild(back)
    node.appendChild(inner)
    return node
  }

  // Carta que sale del mazo y se voltea en el hueco central.
  function deal(power, card) {
    kit.sound("deal")
    var node = playingCard(power, card)
    node.classList.add("is-dealing")
    var slot = ui.slot
    var previous = slot.firstElementChild
    slot.appendChild(node)
    return kit.wait(kit.reducedMotion ? 0 : 650).then(function () {
      kit.sound("flip")
      node.classList.remove("is-dealing")
      if (previous) previous.remove()
      return node
    })
  }

  function paintLadder() {
    ui.ladder.textContent = ""
    var info = kit.info()
    var max = info ? info.risk.hiloMaxSteps : 12
    var steps = game ? game.steps : 0
    for (var i = 1; i <= max; i++) {
      var dot = el("span", "hl-step" + (i <= steps ? " is-on" : "") + (i === steps ? " is-last" : ""))
      ui.ladder.appendChild(dot)
    }
    ui.stage.setAttribute("data-streak", String(Math.min(steps, 6)))
  }

  function paintHistory() {
    ui.trail.textContent = ""
    ;((game && game.history) || []).slice(-8).forEach(function (step) {
      var chip = el("span", "hl-mini o-" + step.outcome, faceOf(step.to))
      ui.trail.appendChild(chip)
    })
  }

  // Latido mas rapido cuanto mas alto el multiplicador; se para al terminar.
  function updateHeart() {
    var active = game && game.status === "active" && game.multiplier >= HEART_FROM
    if (!active) { if (heart) { heart.stop(); heart = null } ; ui.stage.classList.remove("is-tense"); return }
    var bpm = 72 + Math.min(80, (game.multiplier - HEART_FROM) * 14)
    if (!heart) heart = window.SoundKit.heartbeat(bpm)
    else heart.set(bpm)
    ui.stage.classList.add("is-tense")
    ui.stage.style.setProperty("--beat", (60 / bpm).toFixed(2) + "s")
  }

  function paint() {
    var info = kit.info()
    if (!ui || !info) return
    var active = game && game.status === "active"
    ui.betBox.hidden = !!active
    ui.play.hidden = !!active
    ui.guessRow.hidden = !active
    ui.cashout.hidden = !active
    ui.play.disabled = busy || kit.points() < (bet ? bet.value() : 0)
    ui.play.textContent = busy ? "..." : "Repartir · " + kit.fmt(bet ? bet.value() : info.risk.min) + " pts"
    if (active) {
      ui.higher.disabled = busy || !game.odds.higher
      ui.lower.disabled = busy || !game.odds.lower
      ui.higherOdds.textContent = game.odds.higher ? "x" + game.odds.higher.toFixed(2) : "—"
      ui.lowerOdds.textContent = game.odds.lower ? "x" + game.odds.lower.toFixed(2) : "—"
      ui.cashout.disabled = busy
      ui.cashout.textContent = game.steps ? "Cobrar " + kit.fmt(game.cashout) + " pts" : "Retirar apuesta"
    }
    ui.mult.textContent = "x" + (game ? game.multiplier : 1).toFixed(2)
    paintLadder()
    paintHistory()
    updateHeart()
  }

  function start() {
    if (busy) return
    busy = true
    paint()
    ui.stage.classList.remove("is-lost", "is-cashed")
    kit.post("/api/games/hilo/start", { key: window.CanjeApp.randomKey(), bet: bet.value() }).then(function (result) {
      game = result.game
      if (typeof result.balance === "number") kit.countUp(ui.points, result.balance, 500)
      return deal(game.power, game.card)
    }).catch(function (error) {
      window.CanjeApp.toast(error.message)
    }).then(function () { busy = false; paint() })
  }

  function guess(which) {
    if (busy || !game) return
    busy = true
    paint()
    kit.restart(which === "higher" ? ui.higher : ui.lower, "is-press")
    kit.post("/api/games/hilo/guess", { id: game.id, guess: which }).then(function (result) {
      var before = game.multiplier
      game = result.game
      return deal(game.power, game.card).then(function (node) {
        if (result.outcome === "win") {
          node.classList.add("is-win")
          kit.restart(ui.mult, "is-pop")
          kit.sound("correct", { step: game.steps })
          kit.floatText(kit.centerOf(ui.mult), "x" + game.multiplier.toFixed(2), "#34d399")
          kit.sparks(kit.centerOf(node), "#6ee7b7", 14)
          kit.celebrate("small", "#34d399", centerOf(ui.mult), true)
          if (result.auto) cashed(result)
        } else if (result.outcome === "push") {
          node.classList.add("is-push")
          kit.sound("tap")
          window.CanjeApp.toast("Empate: la carta es igual, sigues igual.")
        } else {
          node.classList.add("is-lose")
          ui.stage.classList.add("is-lost")
          kit.sparks(kit.centerOf(node), "#fb7185", 18)
          kit.sound("wrong")
          kit.flash("#e11d48", "lose")
          kit.shake(ui.stage)
          ui.mult.textContent = "x0.00"
          window.CanjeApp.toast("Perdiste " + kit.fmt(game.bet) + " pts (ibas x" + before.toFixed(2) + ").")
          kit.afterPlay(result)
        }
      })
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () { busy = false; paint() })
  }

  function centerOf(node) {
    var rect = node.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  function cashed(result) {
    ui.stage.classList.add("is-cashed")
    kit.sound("cashout")
    kit.celebrate("coins", "#fbbf24", centerOf(ui.mult), true)
    if (game.multiplier >= 5) kit.celebrate("big", "#34d399")
    window.CanjeApp.toast("Cobraste " + kit.fmt(game.payout) + " pts.")
    kit.afterPlay(result)
  }

  function cashout() {
    if (busy || !game) return
    busy = true
    paint()
    kit.post("/api/games/hilo/cashout", { id: game.id }).then(function (result) {
      game = result.game
      cashed(result)
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () { busy = false; paint() })
  }

  function build(section, info) {
    var parts = kit.layout(section, { id: "hilo", title: "Alta o baja", hint: "¿La siguiente carta será mayor o menor? Cada acierto multiplica tu apuesta. Cobra cuando quieras: si fallas, la pierdes." })
    ui = { points: parts.points, stage: parts.stage }
    var chips = el("div", "hl-chips")
    for (var c = 0; c < 6; c++) {
      var chip = el("span", "hl-chip")
      chip.style.setProperty("--i", String(c))
      chips.appendChild(chip)
    }
    parts.stage.appendChild(chips)
    var table = el("div", "hl-table")
    var deck = el("div", "hl-deck")
    for (var i = 0; i < 5; i++) {
      var back = el("div", "hl-card hl-deck-card")
      back.style.setProperty("--i", String(i))
      var inner = el("div", "hl-card-inner is-back")
      var face = el("div", "hl-back")
      face.appendChild(el("span", "hl-back-logo"))
      inner.appendChild(face)
      back.appendChild(inner)
      deck.appendChild(back)
    }
    var slot = el("div", "hl-slot")
    slot.appendChild(el("div", "hl-slot-empty", "Repartir"))
    var meter = el("div", "hl-meter")
    meter.appendChild(el("span", "hl-meter-label", "Multiplicador"))
    var mult = el("strong", "hl-mult", "x1.00")
    meter.appendChild(mult)
    var ladder = el("div", "hl-ladder")
    meter.appendChild(ladder)
    meter.appendChild(el("div", "hl-flames"))
    table.appendChild(meter)
    table.appendChild(slot)
    table.appendChild(deck)
    var trail = el("div", "hl-trail")
    parts.stage.appendChild(table)
    parts.stage.appendChild(trail)
    ui.slot = slot
    ui.mult = mult
    ui.ladder = ladder
    ui.trail = trail

    bet = kit.betControl({ min: info.risk.min, max: info.risk.max, value: Math.max(info.risk.min, 500), onChange: paint })
    ui.betBox = bet.node
    parts.side.appendChild(bet.node)
    var play = el("button", "btn btn-buy plinko-play", "Repartir")
    play.type = "button"
    play.addEventListener("click", start)
    parts.side.appendChild(play)
    var row = el("div", "hl-guess")
    function guessButton(which, label) {
      var button = el("button", "hl-btn hl-" + which)
      button.type = "button"
      button.appendChild(el("span", "hl-arrow"))
      button.appendChild(el("strong", "", label))
      var odds = el("span", "hl-odds", "")
      button.appendChild(odds)
      button.addEventListener("click", function () { guess(which) })
      row.appendChild(button)
      return { button: button, odds: odds }
    }
    var higher = guessButton("higher", "Mayor")
    var lower = guessButton("lower", "Menor")
    parts.side.appendChild(row)
    var cash = el("button", "btn hl-cashout", "Cobrar")
    cash.type = "button"
    cash.addEventListener("click", cashout)
    parts.side.appendChild(cash)
    parts.side.appendChild(el("p", "hint hl-rules", "A es la más baja y K la más alta. Si sale la misma, es empate y sigues igual."))
    ui.play = play
    ui.guessRow = row
    ui.higher = higher.button
    ui.lower = lower.button
    ui.higherOdds = higher.odds
    ui.lowerOdds = lower.odds
    ui.cashout = cash
    // Partida a medias (tras recargar la pagina).
    if (info.hilo && info.hilo.status === "active") {
      game = info.hilo
      slot.textContent = ""
      slot.appendChild(playingCard(game.power, game.card))
    }
    paint()
  }

  kit.register("hilo", {
    build: build,
    show: paint,
    hide: function () { if (heart) { heart.stop(); heart = null } },
    onViewer: function () { if (ui) paint() },
    onInfo: function (info) {
      if (!ui || busy) return
      if (info.hilo && info.hilo.status === "active" && (!game || game.id !== info.hilo.id)) {
        game = info.hilo
        ui.slot.textContent = ""
        ui.slot.appendChild(playingCard(game.power, game.card))
      }
      paint()
    },
  })
})()
