// Buscaminas de cofres (pestana Minijuegos). Tablero de 5x5 losas con
// cofres y algunas trampas (3, 5, 8 o 12). Cada cofre sube el multiplicador;
// se puede cobrar cuando se quiera, pero si sale una trampa se pierde todo.
// Las trampas las decide el servidor y solo se ensenan al terminar. Las losas
// se voltean en 3D: el cofre se abre con rayos y monedas; la trampa explota
// con una onda expansiva y destapa las demas.
(function () {
  "use strict"

  var SIZE = 25
  var CHEST = '<svg viewBox="0 0 64 64"><defs><linearGradient id="mc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b45309"/><stop offset="1" stop-color="#78350f"/></linearGradient></defs><path d="M12 22 L18 6 H46 L52 22 Z" fill="#d97706" stroke="#451a03" stroke-width="2"/><rect x="10" y="30" width="44" height="22" rx="3" fill="url(#mc)" stroke="#451a03" stroke-width="2"/><ellipse cx="32" cy="30" rx="20" ry="5" fill="#fde68a"/><circle cx="24" cy="28" r="4" fill="#fbbf24" stroke="#92400e"/><circle cx="33" cy="26" r="4" fill="#fbbf24" stroke="#92400e"/><circle cx="41" cy="28" r="4" fill="#fbbf24" stroke="#92400e"/><rect x="16" y="30" width="5" height="22" fill="#fbbf24"/><rect x="43" y="30" width="5" height="22" fill="#fbbf24"/></svg>'
  var TRAP = '<svg viewBox="0 0 64 64"><circle cx="30" cy="36" r="18" fill="#18181b" stroke="#000" stroke-width="2"/><circle cx="24" cy="30" r="5" fill="rgba(255,255,255,.25)"/><rect x="36" y="12" width="8" height="10" rx="2" transform="rotate(35 40 17)" fill="#3f3f46"/><path d="M44 12 q6 -6 10 -2" fill="none" stroke="#a16207" stroke-width="2.5"/><circle cx="55" cy="9" r="4" fill="#f97316"/><circle cx="55" cy="9" r="2" fill="#fde68a"/><path d="M22 40 l4 -4 m0 4 l-4 -4 M32 40 l4 -4 m0 4 l-4 -4" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/><path d="M24 47 q6 4 12 0" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/></svg>'

  var kit = window.GameKit
  var ui = null
  var game = null
  var busy = false
  var bet = null
  var mineCount = 5
  var drone = null // zumbido de tension que sube con cada cofre

  function el(tag, className, text) { return kit.el(tag, className, text) }

  // 0 al empezar, 1 con todos los cofres abiertos.
  function tension() {
    if (!game || game.status !== "active") return 0
    return Math.min(1, game.revealed.length / Math.max(1, SIZE - (game.mineCount || mineCount)))
  }

  function updateDrone() {
    var active = game && game.status === "active"
    if (!active) { if (drone) { drone.stop(); drone = null } ; return }
    if (!drone) drone = window.SoundKit.loop("drone")
    drone.set(tension())
    if (ui) ui.board.style.setProperty("--heat", tension().toFixed(2))
  }

  function tileNode(index) {
    var tile = el("button", "mn-tile")
    tile.type = "button"
    tile.setAttribute("aria-label", "Losa " + (index + 1))
    tile.style.setProperty("--i", String(index))
    var inner = el("span", "mn-inner")
    var top = el("span", "mn-top")
    top.appendChild(el("span", "mn-rune"))
    var under = el("span", "mn-under")
    inner.appendChild(top)
    inner.appendChild(under)
    tile.appendChild(inner)
    tile.addEventListener("click", function () { reveal(index) })
    return { node: tile, under: under }
  }

  function resetBoard() {
    ui.tiles.forEach(function (tile) {
      tile.node.className = "mn-tile"
      tile.under.textContent = ""
    })
    ui.board.classList.remove("is-lost", "is-cashed")
  }

  function showChest(index, quiet) {
    var tile = ui.tiles[index]
    tile.under.innerHTML = CHEST
    tile.node.classList.add("is-open", "is-chest")
    if (quiet) { tile.node.classList.add("is-quiet"); return }
    tile.node.appendChild(el("span", "mn-rays"))
    if (!kit.reducedMotion) {
      for (var i = 0; i < 7; i++) {
        var coin = el("span", "mn-coin")
        coin.style.setProperty("--dx", (Math.random() - 0.5) * 90 + "px")
        coin.style.setProperty("--dy", -40 - Math.random() * 60 + "px")
        coin.style.setProperty("--d", (0.5 + Math.random() * 0.4).toFixed(2) + "s")
        tile.node.appendChild(coin)
        setTimeout(function (node) { node.remove() }.bind(null, coin), 1100)
      }
    }
    var float = el("span", "mn-float", "x" + game.multiplier.toFixed(2))
    tile.node.appendChild(float)
    setTimeout(function () { float.remove() }, 1200)
  }

  function showTrap(index, hit, delay) {
    var tile = ui.tiles[index]
    setTimeout(function () {
      tile.under.innerHTML = TRAP
      tile.node.classList.add("is-open", "is-trap")
      if (hit) {
        tile.node.classList.add("is-hit")
        tile.node.appendChild(el("span", "mn-wave"))
      }
    }, delay || 0)
  }

  // Al terminar: trampas (escalonadas) y cofres que quedaban, apagados.
  function revealAll(skip) {
    var order = 0
    ;(game.mines || []).forEach(function (index) { if (index !== skip) showTrap(index, false, 180 + order++ * 110) })
    setTimeout(function () {
      for (var i = 0; i < SIZE; i++) {
        var tile = ui.tiles[i]
        if (!tile.node.classList.contains("is-open")) showChest(i, true)
      }
    }, 300 + order * 110)
  }

  function paint() {
    var info = kit.info()
    if (!ui || !info) return
    var active = game && game.status === "active"
    ui.betBox.hidden = !!active
    ui.minesBox.hidden = !!active
    ui.start.hidden = !!active
    ui.cashout.hidden = !active
    ui.start.disabled = busy || kit.points() < (bet ? bet.value() : 0)
    ui.start.textContent = busy ? "..." : "Empezar · " + kit.fmt(bet ? bet.value() : info.risk.min) + " pts"
    ui.board.classList.toggle("is-active", !!active)
    ui.tiles.forEach(function (tile) { tile.node.disabled = !active || busy || tile.node.classList.contains("is-open") })
    Array.prototype.forEach.call(ui.minesBox.querySelectorAll(".mn-choice"), function (button) {
      button.classList.toggle("is-selected", Number(button.getAttribute("data-mines")) === mineCount)
    })
    var lost = game && game.status === "lost"
    var multiplier = lost ? 0 : game ? game.multiplier : 1
    ui.mult.textContent = "x" + multiplier.toFixed(2)
    ui.mult.classList.toggle("is-lost", !!lost)
    ui.next.textContent = active && game.next ? "Siguiente cofre: x" + game.next.toFixed(2) : active ? "¡Todos abiertos!" : "Trampas: " + mineCount
    if (active) {
      ui.cashout.disabled = busy
      ui.cashout.textContent = game.revealed.length ? "Cobrar " + kit.fmt(game.cashout) + " pts" : "Retirar apuesta"
      ui.found.textContent = game.revealed.length + " cofres"
    } else ui.found.textContent = ""
    updateDrone()
  }

  function start() {
    if (busy) return
    busy = true
    paint()
    resetBoard()
    kit.post("/api/games/mines/start", { key: window.CanjeApp.randomKey(), bet: bet.value(), mines: mineCount }).then(function (result) {
      game = result.game
      if (typeof result.balance === "number") kit.countUp(ui.points, result.balance, 500)
      kit.restart(ui.board, "is-deal")
      kit.sound("deal")
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () { busy = false; paint() })
  }

  function reveal(index) {
    if (busy || !game || game.status !== "active") return
    busy = true
    ui.tiles[index].node.classList.add("is-flipping")
    kit.sound("tap")
    paint()
    kit.post("/api/games/mines/reveal", { id: game.id, cell: index }).then(function (result) {
      game = result.game
      ui.tiles[index].node.classList.remove("is-flipping")
      if (result.outcome === "trap") {
        showTrap(index, true)
        ui.board.classList.add("is-lost")
        kit.sound("boom")
        kit.sparks(kit.centerOf(ui.tiles[index].node), "#f97316", 26)
        kit.restart(ui.stageBox, "is-blast")
        kit.haptic([90, 40, 180])
        kit.flash("#e11d48", "lose")
        kit.shake(ui.stageBox)
        revealAll(index)
        window.CanjeApp.toast("¡Trampa! Perdiste " + kit.fmt(game.bet) + " pts.")
        kit.afterPlay(result)
        return
      }
      if (result.outcome === "chest") {
        showChest(index)
        kit.restart(ui.mult, "is-pop")
        kit.sound("chest", { step: game.revealed.length })
        kit.sparks(kit.centerOf(ui.tiles[index].node), "#fde68a", 16)
        kit.haptic(20)
        if (result.auto) finishCashed(result)
      }
    }).catch(function (error) {
      ui.tiles[index].node.classList.remove("is-flipping")
      window.CanjeApp.toast(error.message)
    }).then(function () { busy = false; paint() })
  }

  function finishCashed(result) {
    ui.board.classList.add("is-cashed")
    revealAll(null)
    var rect = ui.mult.getBoundingClientRect()
    kit.sound("cashout")
    kit.celebrate("coins", "#fbbf24", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true)
    if (game.payout >= game.bet * 5) kit.celebrate("big", "#a855f7")
    window.CanjeApp.toast("Cobraste " + kit.fmt(game.payout) + " pts.")
    kit.afterPlay(result)
  }

  function cashout() {
    if (busy || !game) return
    busy = true
    paint()
    kit.post("/api/games/mines/cashout", { id: game.id }).then(function (result) {
      game = result.game
      finishCashed(result)
    }).catch(function (error) { window.CanjeApp.toast(error.message) }).then(function () { busy = false; paint() })
  }

  // Partida a medias: vuelve a pintar los cofres ya abiertos.
  function resume(saved) {
    game = saved
    resetBoard()
    game.revealed.forEach(function (index) { showChest(index, true); ui.tiles[index].node.classList.remove("is-quiet") })
  }

  function build(section, info) {
    var parts = kit.layout(section, { id: "mines", title: "Buscaminas de cofres", hint: "Abre losas: cada cofre sube el multiplicador. Cobra cuando quieras; si abres una trampa, lo pierdes todo." })
    ui = { points: parts.points, stageBox: parts.stage }
    var hud = el("div", "mn-hud")
    var multBox = el("div", "mn-multbox")
    multBox.appendChild(el("span", "mn-hud-label", "Multiplicador"))
    var mult = el("strong", "mn-mult", "x1.00")
    multBox.appendChild(mult)
    hud.appendChild(multBox)
    var next = el("span", "mn-next", "")
    hud.appendChild(next)
    var found = el("span", "mn-found", "")
    hud.appendChild(found)
    parts.stage.appendChild(hud)
    var board = el("div", "mn-board")
    ui.tiles = []
    for (var i = 0; i < SIZE; i++) {
      var tile = tileNode(i)
      board.appendChild(tile.node)
      ui.tiles.push(tile)
    }
    parts.stage.appendChild(board)
    // Linterna: un circulo de luz sigue al puntero por el tablero.
    board.addEventListener("pointermove", function (event) {
      var rect = board.getBoundingClientRect()
      board.style.setProperty("--mx", (event.clientX - rect.left) + "px")
      board.style.setProperty("--my", (event.clientY - rect.top) + "px")
      board.classList.add("is-lit")
    })
    board.addEventListener("pointerleave", function () { board.classList.remove("is-lit") })
    parts.stage.appendChild(el("span", "mn-torch left"))
    parts.stage.appendChild(el("span", "mn-torch right"))
    ui.board = board
    ui.mult = mult
    ui.next = next
    ui.found = found

    bet = kit.betControl({ min: info.risk.min, max: info.risk.max, value: Math.max(info.risk.min, 500), onChange: paint })
    ui.betBox = bet.node
    parts.side.appendChild(bet.node)
    var minesBox = el("div", "mn-choices")
    minesBox.appendChild(el("span", "g-bet-label", "Trampas"))
    var chips = el("div", "mn-choice-row")
    info.risk.minesOptions.forEach(function (count, index) {
      var button = el("button", "mn-choice d-" + index, String(count))
      button.type = "button"
      button.setAttribute("data-mines", String(count))
      button.addEventListener("click", function () { mineCount = count; paint() })
      chips.appendChild(button)
    })
    minesBox.appendChild(chips)
    minesBox.appendChild(el("p", "hint", "Más trampas, más riesgo y el multiplicador sube más rápido."))
    parts.side.appendChild(minesBox)
    var startButton = el("button", "btn btn-buy plinko-play", "Empezar")
    startButton.type = "button"
    startButton.addEventListener("click", start)
    parts.side.appendChild(startButton)
    var cash = el("button", "btn hl-cashout", "Cobrar")
    cash.type = "button"
    cash.addEventListener("click", cashout)
    parts.side.appendChild(cash)
    ui.minesBox = minesBox
    ui.start = startButton
    ui.cashout = cash
    if (info.mines && info.mines.status === "active") { mineCount = info.mines.mineCount; resume(info.mines) }
    paint()
  }

  kit.register("mines", {
    build: build,
    show: paint,
    hide: function () { if (drone) { drone.stop(); drone = null } },
    onViewer: function () { if (ui) paint() },
    onInfo: function (info) {
      if (!ui || busy) return
      if (info.mines && info.mines.status === "active" && (!game || game.id !== info.mines.id)) { mineCount = info.mines.mineCount; resume(info.mines) }
      paint()
    },
  })
})()
