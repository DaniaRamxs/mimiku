// Cinematica de una tirada del gachapon, a pantalla completa (<dialog>).
//
// Tirada x1: la capsula cae, tiembla y su brillo va subiendo de color rareza
// a rareza hasta la que toca (comun -> raro -> epico -> legendario), estalla
// y la carta gira desde el dorso. Tirada x10: caen diez capsulas, se abren de
// menor a mayor rareza y los legendarios esperan al final con su propio flash.
//
// Todo lo marcan clases CSS (gacha-machine.css) puestas en un calendario de
// setTimeout; "Saltar" (o Esc, o tocar el fondo) cancela el calendario y deja
// todo en su estado final. Con movimiento reducido se va directo al final.
(function () {
  "use strict"

  var ORDER = { comun: 0, raro: 1, epico: 2, legendario: 3 }
  var LADDER = ["comun", "raro", "epico", "legendario"]
  var LABELS = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario" }
  var COLORS = {
    comun: ["#f4f4f5", "#a1a1aa", "#ffffff"],
    raro: ["#93c5fd", "#3b82f6", "#dbeafe", "#60a5fa"],
    epico: ["#d8b4fe", "#a855f7", "#f0abfc", "#c084fc"],
    legendario: ["#fde68a", "#f59e0b", "#fff7ed", "#fbbf24", "#fef3c7"],
  }
  var BURST_COUNT = { comun: 40, raro: 80, epico: 130, legendario: 200 }
  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  var root = null
  var fx = null
  var audio = window.GachaFx.audio
  var timers = []
  var ambient = null
  var finalizers = []
  var animating = false
  var options = {}

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function $(selector) { return root.querySelector(selector) }
  function rarityOf(value) { return ORDER[value] === undefined ? "comun" : value }

  function at(ms, fn) { timers.push(setTimeout(fn, reducedMotion ? 0 : ms)) }
  function cancelTimeline() {
    timers.forEach(clearTimeout)
    timers = []
    if (ambient) { clearInterval(ambient); ambient = null }
  }

  function build() {
    root = el("dialog", "gc")
    root.setAttribute("aria-label", "Tirada del gachapon")
    root.innerHTML = '<canvas class="gc-fx" aria-hidden="true"></canvas><div class="gc-aura" aria-hidden="true"></div><div class="gc-rays" aria-hidden="true"></div>' +
      '<div class="gc-stage"></div><p class="gc-title" aria-hidden="true"></p><div class="gc-info"></div><div class="gc-actions"></div>' +
      '<button class="gc-skip" type="button">Saltar</button><div class="gc-flash" aria-hidden="true"></div><p class="gc-live" aria-live="polite"></p>'
    document.body.appendChild(root)
    fx = window.GachaFx.createParticles($(".gc-fx"))
    $(".gc-skip").addEventListener("click", skip)
    root.addEventListener("cancel", function (event) { event.preventDefault(); if (animating) skip(); else close() })
    root.addEventListener("click", function (event) {
      if (animating && !event.target.closest("button")) skip()
    })
  }

  function reset(mode, rarity) {
    cancelTimeline()
    finalizers = []
    fx.clear()
    root.className = "gc is-" + mode + " best-" + rarity
    $(".gc-stage").textContent = ""
    $(".gc-title").textContent = ""
    $(".gc-title").className = "gc-title"
    $(".gc-info").textContent = ""
    $(".gc-actions").textContent = ""
    $(".gc-live").textContent = ""
    root.style.setProperty("--tc", COLORS.comun[1])
  }

  function open() {
    if (!root.open) root.showModal()
    fx.resize()
    animating = true
  }

  function close() {
    cancelTimeline()
    fx.clear()
    animating = false
    if (root.open) root.close()
    if (options.onClose) options.onClose()
  }

  // Deja todo como al final de la cinematica.
  function skip() {
    if (!animating) return
    cancelTimeline()
    root.classList.add("is-final")
    $(".gc-flash").className = "gc-flash"
    finalizers.forEach(function (fn) { fn() })
    finalizers = []
  }

  function flash(rarity) {
    var node = $(".gc-flash")
    node.className = "gc-flash is-on f-" + rarity
    at(900, function () { node.className = "gc-flash" })
  }

  function quake() {
    root.classList.remove("is-quake")
    void root.offsetWidth
    root.classList.add("is-quake")
  }

  function centerOf(node) {
    var box = node.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }

  function titleSlam(rarity) {
    if (ORDER[rarity] < 2) return
    var title = $(".gc-title")
    title.textContent = LABELS[rarity].toUpperCase()
    title.className = "gc-title is-on t-" + rarity
  }

  // Carta con dorso: .gc-flip gira de espaldas a de frente.
  function flipCard(result, large) {
    var flip = el("div", "gc-flip r-" + rarityOf(result.card.rarity))
    var back = el("div", "gc-back")
    back.appendChild(el("span", "gc-back-mark", "G"))
    var front = el("div", "gc-front")
    var card = window.GachaCards.buildCard(result.card, "div", options.total)
    if (large) card.classList.add("tcard-lg")
    front.appendChild(card)
    if (result.isNew) front.appendChild(el("span", "gc-badge is-new", "Nuevo"))
    if (result.guaranteed) front.appendChild(el("span", "gc-badge is-pity", "Garantía"))
    flip.appendChild(back)
    flip.appendChild(front)
    return flip
  }

  function showActions(count) {
    var box = $(".gc-actions")
    box.textContent = ""
    var again = el("button", "btn btn-buy gc-again", options.againLabel ? options.againLabel(count) : "Otra vez")
    again.type = "button"
    again.addEventListener("click", function () { again.disabled = swap.disabled = true; options.onAgain && options.onAgain(count) })
    var other = count === 10 ? 1 : 10
    var swap = el("button", "btn btn-quiet", options.againLabel ? options.againLabel(other) : "Tirar x" + other)
    swap.type = "button"
    swap.addEventListener("click", function () { again.disabled = swap.disabled = true; options.onAgain && options.onAgain(other) })
    var done = el("button", "btn btn-quiet", "Cerrar")
    done.type = "button"
    done.addEventListener("click", close)
    box.appendChild(again)
    box.appendChild(swap)
    box.appendChild(done)
    box.classList.add("is-on")
    animating = false
    root.classList.add("is-done")
    again.focus({ preventScroll: true })
  }

  function startAmbient(rarity, node) {
    if (reducedMotion || ORDER[rarity] < 2) return
    ambient = setInterval(function () {
      if (!root.open) return
      var c = centerOf(node)
      fx.embers(c.x, c.y, { colors: COLORS[rarity], count: rarity === "legendario" ? 14 : 8, spread: 320 })
    }, 900)
  }

  // ── Tirada x1 ───────────────────────────────────────────────────────────────
  function playSingle(result) {
    var rarity = rarityOf(result.card.rarity)
    reset("single", rarity)
    var stage = $(".gc-stage")
    var capsule = el("div", "gc-capsule")
    capsule.innerHTML = '<i class="gc-cap-glow"></i><i class="gc-cap-top"></i><i class="gc-cap-bottom"></i><i class="gc-cap-band"></i><i class="gc-cap-shine"></i>'
    var flip = flipCard(result, true)
    stage.appendChild(capsule)
    stage.appendChild(flip)
    open()

    var steps = LADDER.slice(0, ORDER[rarity] + 1)
    var revealAt = 1500 + steps.length * 380

    function finalState() {
      capsule.className = "gc-capsule is-open"
      flip.classList.add("is-shown", "is-revealed")
      root.style.setProperty("--tc", COLORS[rarity][1])
      root.classList.add("rays-on")
      titleSlam(rarity)
      info(result)
      showActions(1)
      startAmbient(rarity, flip)
    }
    finalizers.push(finalState)
    if (reducedMotion) { skip(); return }

    capsule.classList.add("is-drop")
    at(420, function () { audio.drop() })
    at(700, function () { capsule.classList.add("is-shake"); audio.rattle(revealAt / 1000 - 0.8); audio.riser(revealAt / 1000 - 0.7) })
    steps.forEach(function (tier, index) {
      at(800 + index * 380, function () {
        root.style.setProperty("--tc", COLORS[tier][1])
        capsule.className = "gc-capsule is-shake tier-" + tier + (index ? " is-upgrade" : "")
        if (index) {
          audio.upgrade()
          var c = centerOf(capsule)
          fx.burst(c.x, c.y, { colors: COLORS[tier], count: 18 + index * 10, speed: 260, life: 0.8, gravity: 0.2, shape: "star" })
        }
      })
    })
    at(revealAt, function () {
      var c = centerOf(capsule)
      capsule.className = "gc-capsule is-open tier-" + rarity
      root.classList.add("rays-on")
      flash(rarity)
      if (ORDER[rarity] >= 2) quake()
      audio.burst()
      fx.burst(c.x, c.y, { colors: COLORS[rarity], count: BURST_COUNT[rarity], speed: 420 + ORDER[rarity] * 140, life: 1.6 })
      flip.classList.add("is-shown")
      $(".gc-live").textContent = "Te salió " + result.card.name + ", " + LABELS[rarity]
    })
    at(revealAt + 150, function () { flip.classList.add("is-revealed"); audio.flip() })
    at(revealAt + 650, function () { audio.chime(rarity); titleSlam(rarity) })
    if (rarity === "legendario") {
      at(revealAt + 300, function () { fx.rain({ colors: COLORS.legendario, count: 140 }) })
      at(revealAt + 1700, function () { fx.rain({ colors: COLORS.legendario, count: 90 }) })
    }
    at(revealAt + (rarity === "legendario" ? 1500 : 1100), function () {
      finalizers = []
      info(result)
      showActions(1)
      startAmbient(rarity, flip)
    })
  }

  function info(result) {
    var box = $(".gc-info")
    box.textContent = ""
    var rarity = rarityOf(result.card.rarity)
    box.appendChild(el("span", "gc-info-rarity t-" + rarity, LABELS[rarity]))
    box.appendChild(el("strong", "gc-info-name", result.card.name))
    var notes = []
    if (result.isNew) notes.push("Nuevo en tu colección")
    if (result.guaranteed) notes.push("Te tocó por la garantía")
    if (notes.length) box.appendChild(el("span", "gc-info-note", notes.join(" · ")))
    box.classList.add("is-on")
  }

  // ── Tirada x10 ──────────────────────────────────────────────────────────────
  function playMulti(results) {
    var sorted = results.slice().sort(function (a, b) { return ORDER[rarityOf(a.card.rarity)] - ORDER[rarityOf(b.card.rarity)] })
    var best = rarityOf(sorted[sorted.length - 1].card.rarity)
    reset("multi", best)
    var grid = el("div", "gc-grid")
    var slots = sorted.map(function (result, index) {
      var rarity = rarityOf(result.card.rarity)
      var slot = el("div", "gc-slot r-" + rarity)
      slot.style.setProperty("--i", index)
      var capsule = el("div", "gc-mini-cap tier-" + rarity)
      capsule.innerHTML = '<i class="gc-cap-glow"></i><i class="gc-cap-top"></i><i class="gc-cap-bottom"></i><i class="gc-cap-band"></i>'
      slot.appendChild(capsule)
      slot.appendChild(flipCard(result, false))
      grid.appendChild(slot)
      return slot
    })
    $(".gc-stage").appendChild(grid)
    open()

    function revealSlot(slot) {
      slot.classList.add("is-open")
      slot.querySelector(".gc-flip").classList.add("is-shown", "is-revealed")
    }
    function finalState() {
      slots.forEach(revealSlot)
      root.style.setProperty("--tc", COLORS[best][1])
      root.classList.add("rays-on", "is-dropped")
      summary(results, best)
      showActions(10)
    }
    finalizers.push(finalState)
    if (reducedMotion) { skip(); return }

    root.classList.add("is-dropped")
    at(500, function () { audio.drop() })
    at(1000, function () { audio.rattle(1) })
    var cursor = 1700
    if (ORDER[best] >= 2) {
      at(1200, function () { root.style.setProperty("--tc", COLORS[best][1]); root.classList.add("is-charged"); audio.riser(0.9) })
      cursor = 2200
    }
    slots.forEach(function (slot, index) {
      var rarity = rarityOf(sorted[index].card.rarity)
      if (rarity === "legendario") cursor += 500
      var when = cursor
      at(when, function () {
        revealSlot(slot)
        var c = centerOf(slot)
        audio.flip()
        if (ORDER[rarity] >= 1) audio.chime(rarity)
        fx.burst(c.x, c.y, { colors: COLORS[rarity], count: 14 + ORDER[rarity] * 22, speed: 220 + ORDER[rarity] * 90, life: 1 })
        if (rarity === "legendario") {
          flash("legendario")
          quake()
          root.classList.add("rays-on")
          fx.rain({ colors: COLORS.legendario, count: 70 })
        }
      })
      cursor += ORDER[rarity] >= 2 ? 360 : 200
    })
    at(cursor + 300, function () {
      finalizers = []
      root.style.setProperty("--tc", COLORS[best][1])
      titleSlam(best)
      summary(results, best)
      showActions(10)
    })
  }

  function summary(results, best) {
    var box = $(".gc-info")
    box.textContent = ""
    var fresh = results.filter(function (item) { return item.isNew }).length
    box.appendChild(el("span", "gc-info-rarity t-" + best, "Mejor: " + LABELS[best]))
    box.appendChild(el("strong", "gc-info-name", fresh ? fresh + (fresh === 1 ? " personaje nuevo" : " personajes nuevos") : "Sin personajes nuevos"))
    if (results.some(function (item) { return item.guaranteed })) box.appendChild(el("span", "gc-info-note", "Uno te tocó por la garantía"))
    box.classList.add("is-on")
    $(".gc-live").textContent = results.length + " tiradas. Mejor rareza: " + LABELS[best]
  }

  window.GachaCinematic = {
    // `results`: [{card, isNew, guaranteed}]; `opts`: {total, onAgain(count), againLabel(count), onClose}.
    play: function (results, opts) {
      if (!root) build()
      options = opts || {}
      if (results.length > 1) playMulti(results)
      else playSingle(results[0])
    },
    close: function () { if (root) close() },
    // Error al volver a tirar desde la cinematica (un toast quedaria debajo del dialogo).
    notice: function (message) {
      if (!root || !root.open) return false
      var box = $(".gc-actions")
      var old = box.querySelector(".gc-error")
      if (old) old.remove()
      box.insertBefore(el("p", "gc-error", message), box.firstChild)
      Array.prototype.forEach.call(box.querySelectorAll("button"), function (button) { button.disabled = false })
      $(".gc-live").textContent = message
      return true
    },
    isOpen: function () { return !!(root && root.open) },
  }
})()
