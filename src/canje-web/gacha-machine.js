// Gachapon > Maquina: la maquina de capsulas para tirar desde la web, la
// barra de garantia y las probabilidades reales. Al tirar, la manivela gira,
// la cupula se agita y, cuando el servidor responde, empieza la cinematica
// (gacha-cinematic.js). Datos: /api/gacha/machine y /api/gacha/pull.
(function () {
  "use strict"

  var DOME_CAPSULES = 18
  var CRANK_MS = 950
  var CAPSULE_COLORS = ["#f472b6", "#60a5fa", "#a855f7", "#fbbf24", "#34d399", "#f87171", "#e5e7eb", "#22d3ee"]
  var RARITY_ORDER = ["comun", "raro", "epico", "legendario"]

  var info = null
  var busy = false
  var built = false
  var loading = null
  var visible = false
  var hasViewer = false // ya hay sesion y estado (app.js llamo a onViewer)

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

  // Coste de `count` tiradas contando las gratis del Pase Sub.
  function costOf(count) {
    if (!info) return 0
    return info.price * Math.max(0, count - (info.freePulls || 0))
  }

  function costLabel(count) {
    var cost = costOf(count)
    if (!cost) return "Gratis"
    return app().formatNumber(cost) + " pts"
  }

  // ── Maquina (dibujo) ────────────────────────────────────────────────────────
  function buildMachine() {
    var stage = $("gm-stage")
    stage.textContent = ""
    stage.appendChild(el("div", "gm-spot"))
    var machine = el("div", "gm-machine")
    var crown = el("div", "gm-crown")
    crown.appendChild(el("span", "gm-neon", "GACHA"))
    machine.appendChild(crown)
    var dome = el("div", "gm-dome")
    for (var i = 0; i < DOME_CAPSULES; i++) {
      var cap = el("i", "gm-cap")
      // Capsulas apiladas en el fondo de la cupula, en filas que se estrechan hacia arriba.
      var row = i < 7 ? 0 : i < 13 ? 1 : 2
      var inRow = row === 0 ? i : row === 1 ? i - 7 : i - 13
      var perRow = row === 0 ? 7 : row === 1 ? 6 : 5
      cap.style.setProperty("--x", (8 + (inRow + (row % 2) * 0.5) * (84 / perRow)) + "%")
      cap.style.setProperty("--y", (70 - row * 17 + (inRow % 2) * 4) + "%")
      cap.style.setProperty("--c", CAPSULE_COLORS[i % CAPSULE_COLORS.length])
      cap.style.setProperty("--r", Math.round(Math.random() * 360) + "deg")
      cap.style.setProperty("--d", (Math.random() * -3).toFixed(2) + "s")
      dome.appendChild(cap)
    }
    dome.appendChild(el("span", "gm-glass"))
    machine.appendChild(dome)
    var body = el("div", "gm-body")
    var plate = el("div", "gm-plate")
    plate.appendChild(el("span", "gm-plate-label", "Tirada"))
    plate.appendChild(el("strong", "gm-plate-price"))
    body.appendChild(plate)
    var crank = el("button", "gm-crank")
    crank.type = "button"
    crank.setAttribute("aria-label", "Girar la manivela (tirar una vez)")
    crank.appendChild(el("span", "gm-crank-arm"))
    crank.addEventListener("click", function () { pull(1) })
    body.appendChild(crank)
    var chute = el("div", "gm-chute")
    chute.appendChild(el("i", "gm-out"))
    body.appendChild(chute)
    machine.appendChild(body)
    machine.appendChild(el("div", "gm-base"))
    stage.appendChild(machine)
    stage.appendChild(el("div", "gm-floor"))
    built = true
  }

  // ── Panel ───────────────────────────────────────────────────────────────────
  function render() {
    if (!info) return
    if (!built) buildMachine()
    document.querySelector(".gm-plate-price").textContent = info.price ? app().formatNumber(info.price) + " pts" : "Gratis"
    $("gm-points").textContent = app().formatNumber(info.points)
    $("gm-free").hidden = !info.freePulls
    $("gm-free").textContent = info.freePulls === 1 ? "Tienes 1 tirada gratis" : "Tienes " + info.freePulls + " tiradas gratis"
    renderPity()
    renderOdds()
    renderButtons()
  }

  function renderPity() {
    var pity = info.pity
    var ratio = pity.count / pity.limit
    var box = $("gm-pity")
    box.classList.toggle("is-close", pity.left <= 10)
    $("gm-pity-text").textContent = pity.left === 1 ? "¡La próxima tirada es legendaria!" : "Legendario asegurado en " + pity.left + " tiradas"
    $("gm-pity-count").textContent = pity.count + " / " + pity.limit
    $("gm-pity-fill").style.setProperty("--p", ratio.toFixed(3))
    box.setAttribute("aria-valuenow", String(pity.count))
    box.setAttribute("aria-valuemax", String(pity.limit))
  }

  function renderOdds() {
    var list = $("gm-odds-list")
    list.textContent = ""
    RARITY_ORDER.slice().reverse().forEach(function (rarity) {
      var row = (info.odds || []).filter(function (item) { return item.rarity === rarity })[0]
      if (!row) return
      var item = el("li", "gm-odd r-" + rarity + (row.count ? "" : " is-empty"))
      item.appendChild(el("span", "gm-odd-name", row.label))
      var bar = el("span", "gm-odd-bar")
      var fill = el("span", "gm-odd-fill")
      fill.style.setProperty("--p", String(Math.min(1, row.percent / 60)))
      bar.appendChild(fill)
      item.appendChild(bar)
      item.appendChild(el("strong", "gm-odd-pct", row.count ? String(row.percent).replace(".", ",") + " %" : "—"))
      item.appendChild(el("span", "gm-odd-count", row.count === 1 ? "1 personaje" : row.count + " personajes"))
      list.appendChild(item)
    })
    $("gm-odds-note").textContent = "Solo cuentan las rarezas que tienen personajes. Si llevas " + (info.pity.limit - 1) +
      " tiradas seguidas sin legendario, la siguiente lo es. La garantía cuenta igual desde el chat (!gachapon) y desde aquí."
  }

  function renderButtons() {
    ;[1, info.maxPulls || 10].forEach(function (count) {
      var button = $(count === 1 ? "gm-pull-1" : "gm-pull-10")
      button.querySelector(".gm-btn-cost").textContent = costLabel(count)
      button.disabled = busy || costOf(count) > info.points
    })
  }

  // ── Tirar ───────────────────────────────────────────────────────────────────
  function pull(count, fromCinematic) {
    if (busy || !info) return
    if (costOf(count) > info.points) {
      var message = "No te alcanzan los puntos para esa tirada."
      if (!window.GachaCinematic.notice(message)) app().toast(message)
      return
    }
    busy = true
    renderButtons()
    var stage = $("gm-stage")
    var request = app().api("/api/gacha/pull", { method: "POST", body: { count: count, key: app().randomKey() } })
    var show = Promise.resolve()
    if (!fromCinematic) {
      stage.classList.remove("is-pulling", "is-dropping")
      void stage.offsetWidth
      stage.classList.add("is-pulling")
      window.GachaFx.audio.crank()
      show = wait(CRANK_MS)
    }
    Promise.all([request, show]).then(function (values) {
      var result = values[0]
      if (fromCinematic) return result
      stage.classList.add("is-dropping")
      var best = bestRarity(result.results)
      stage.style.setProperty("--out", { comun: "#e5e7eb", raro: "#60a5fa", epico: "#a855f7", legendario: "#fbbf24" }[best])
      return wait(420).then(function () { return result })
    }).then(function (result) {
      stage.classList.remove("is-pulling", "is-dropping")
      info.points = result.points
      info.pity = result.pity
      info.freePulls = Math.max(0, (info.freePulls || 0) - result.results.filter(function (item) { return item.free }).length)
      busy = false
      render()
      window.LiveFeed.nudge()
      window.GachaCinematic.play(result.results, {
        total: result.total,
        againLabel: function (n) { return (n === 1 ? "Otra vez" : "Tirar x" + n) + " · " + costLabel(n) },
        onAgain: function (n) { pull(n, true) },
        onClose: function () { app().reload() },
      })
    }).catch(function (error) {
      busy = false
      stage.classList.remove("is-pulling", "is-dropping")
      renderButtons()
      if (!window.GachaCinematic.notice(error.message)) app().toast(error.message)
    })
  }

  function bestRarity(results) {
    return results.reduce(function (top, item) {
      return RARITY_ORDER.indexOf(item.card.rarity) > RARITY_ORDER.indexOf(top) ? item.card.rarity : top
    }, "comun")
  }

  function load() {
    if (loading) return loading
    loading = app().api("/api/gacha/machine").then(function (result) {
      info = result
      render()
      $("sub-machine").classList.add("is-ready")
    }).catch(function (error) { app().toast(error.message) }).then(function () { loading = null })
    return loading
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("gm-pull-1").addEventListener("click", function () { pull(1) })
    $("gm-pull-10").addEventListener("click", function () { pull(10) })
    window.LiveFeed.list($("gm-live"), { games: ["gacha"], max: 7 })
    // Sonido: el mismo control (y volumen) que los minijuegos.
    $("gm-mute").replaceWith(window.SoundKit.control("gm-sound"))
  })

  window.GachaMachine = {
    // Si la pagina abre directamente en Gachapon todavia no hay sesion: se
    // recuerda que esta visible y la primera carga la hace onViewer.
    setVisible: function (value) {
      visible = value
      window.LiveFeed.setActive("gacha", value)
      if (visible && hasViewer && !busy && !window.GachaCinematic.isOpen()) load()
    },
    // app.js en cada refresco: el saldo al dia sin pedir otra vez la maquina.
    onViewer: function (viewer) {
      hasViewer = true
      if (!info) { if (visible && !busy) load(); return }
      if (busy) return
      info.points = viewer.points
      renderButtons()
      $("gm-points").textContent = app().formatNumber(info.points)
    },
  }
})()
