// Animaciones de la pagina de canje: comprar cofres (vuelan a "Cofres sin
// abrir"), abrir cofres (escena con el cofre que tiembla y se abre) y la forja
// del gachapon (las copias se funden en la carta nueva). Estilos en fx.css.
// Todo se salta si el viewer pidio menos movimiento.
// Expone window.CanjeFx y lo usan app.js y gacha-exchange.js.
(function () {
  "use strict"

  var RARITY_RANK = { comun: 0, raro: 1, epico: 2, legendario: 3 }
  var MAX_FLYERS = 6
  var FLY_MS = 780
  var MIN_SHAKE_MS = 900
  var BURST_MS = 1100
  var MIN_FUSE_MS = 1100
  var FLASH_MS = 420

  var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
  function center(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }
  function rarityOf(value) { return RARITY_RANK[value] === undefined ? "comun" : value }

  // Rareza mas alta de una lista de premios ({rarity}).
  function bestRarity(items) {
    return (items || []).reduce(function (best, item) {
      var rarity = rarityOf(item && item.rarity)
      return RARITY_RANK[rarity] > RARITY_RANK[best] ? rarity : best
    }, "comun")
  }

  // Chispas que salen disparadas desde (x, y) hacia fuera.
  function sparks(parent, x, y, count, spread) {
    for (var i = 0; i < count; i++) {
      var angle = (Math.PI * 2 * i) / count + Math.random() * 0.5
      var distance = spread * (0.55 + Math.random() * 0.6)
      var spark = el("span", "fx-spark")
      spark.style.left = x + "px"
      spark.style.top = y + "px"
      spark.style.setProperty("--dx", Math.cos(angle) * distance + "px")
      spark.style.setProperty("--dy", Math.sin(angle) * distance + "px")
      spark.style.setProperty("--d", (0.5 + Math.random() * 0.45).toFixed(2) + "s")
      parent.appendChild(spark)
    }
  }

  // Capa a pantalla completa. Si hay un <dialog> abierto va dentro de el: los
  // dialogos modales se pintan por encima de todo lo demas.
  function layer(className) {
    var node = el("div", "fx-layer " + (className || ""))
    node.setAttribute("aria-hidden", "true")
    var dialogs = document.querySelectorAll("dialog[open]")
    ;(dialogs.length ? dialogs[dialogs.length - 1] : document.body).appendChild(node)
    return node
  }

  // ── Comprar: los cofres vuelan de la tienda al contador ─────────────────────
  function purchase(fromEl, toEl, icon, count) {
    if (reducedMotion || !fromEl || !toEl || !fromEl.animate) return Promise.resolve()
    var from = center(fromEl.getBoundingClientRect())
    var to = center(toEl.getBoundingClientRect())
    var stage = layer()
    sparks(stage, from.x, from.y, 14, 70)
    var flyers = Math.max(1, Math.min(MAX_FLYERS, Number(count) || 1))
    var runs = []
    for (var i = 0; i < flyers; i++) {
      var token = el("span", "fx-token", icon || "")
      token.style.left = from.x + "px"
      token.style.top = from.y + "px"
      stage.appendChild(token)
      var lift = -120 - Math.random() * 60
      var dx = to.x - from.x
      var dy = to.y - from.y
      runs.push(token.animate([
        { transform: "translate(-50%, -50%) scale(.4)", opacity: 0 },
        { transform: "translate(calc(-50% + " + (dx * 0.35) + "px), calc(-50% + " + (dy * 0.35 + lift) + "px)) scale(1.25) rotate(-12deg)", opacity: 1, offset: 0.4 },
        { transform: "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px)) scale(.55) rotate(8deg)", opacity: 0.9 },
      ], { duration: FLY_MS, delay: i * 90, easing: "cubic-bezier(.45, 0, .25, 1)", fill: "both" }).finished)
    }
    return Promise.all(runs).catch(function () {}).then(function () {
      stage.remove()
      toEl.classList.remove("fx-bump")
      void toEl.offsetWidth
      toEl.classList.add("fx-bump")
      var plus = el("span", "fx-plus", "+" + (Number(count) || 1))
      var rect = toEl.getBoundingClientRect()
      plus.style.left = rect.left + rect.width / 2 + "px"
      plus.style.top = rect.top + "px"
      var over = layer()
      over.appendChild(plus)
      setTimeout(function () { over.remove(); toEl.classList.remove("fx-bump") }, 1200)
    })
  }

  // ── Abrir cofre: escena que dura lo que tarde el servidor ───────────────────
  // Devuelve { finish(rewards) -> Promise, cancel() }. `finish` abre la tapa
  // con el color de la mejor rareza y resuelve cuando conviene mostrar premios.
  function chest(icon, name) {
    var noop = { finish: function () { return Promise.resolve() }, cancel: function () {} }
    if (reducedMotion) return noop
    var started = Date.now()
    var stage = layer("fx-stage")
    var box = el("div", "fx-chest")
    var glow = el("span", "fx-chest-glow")
    var rays = el("span", "fx-rays")
    var lid = el("span", "fx-lid")
    var body = el("span", "fx-body")
    var lock = el("span", "fx-lock", icon || "")
    body.appendChild(lock)
    box.appendChild(rays)
    box.appendChild(glow)
    box.appendChild(body)
    box.appendChild(lid)
    stage.appendChild(box)
    stage.appendChild(el("p", "fx-caption", name ? "Abriendo " + name + "..." : "Abriendo..."))
    var skipped = false
    stage.addEventListener("click", function () { skipped = true })

    function cancel() { stage.remove() }

    function finish(rewards) {
      var rarity = bestRarity(rewards)
      var remaining = skipped ? 0 : Math.max(0, MIN_SHAKE_MS - (Date.now() - started))
      return wait(remaining).then(function () {
        stage.classList.add("is-open")
        stage.style.setProperty("--c", "var(--r-" + rarity + ")")
        var rect = box.getBoundingClientRect()
        sparks(stage, rect.left + rect.width / 2, rect.top + rect.height * 0.35, 26 + RARITY_RANK[rarity] * 8, 150 + RARITY_RANK[rarity] * 40)
        return wait(skipped ? 250 : BURST_MS)
      }).then(function () {
        stage.classList.add("is-leaving")
        setTimeout(cancel, 300)
      })
    }

    return { finish: finish, cancel: cancel }
  }

  // ── Forja: copias de la carta giran hacia el centro y estallan ──────────────
  // `slot` es donde esta la carta grande. Devuelve { finish(rarity), cancel() }.
  function forge(slot, count, sourceRarity) {
    var noop = { finish: function () { return Promise.resolve() }, cancel: function () {} }
    if (reducedMotion || !slot) return noop
    var started = Date.now()
    var card = slot.firstElementChild
    if (card) card.classList.add("fx-forging")
    var rect = slot.getBoundingClientRect()
    var mid = center(rect)
    var stage = layer("fx-forge r-" + rarityOf(sourceRarity))
    var copies = Math.min(10, Number(count) || 1)
    for (var i = 0; i < copies; i++) {
      var ghost = el("span", "fx-ghost")
      var angle = (Math.PI * 2 * i) / copies
      ghost.style.left = mid.x + "px"
      ghost.style.top = mid.y + "px"
      ghost.style.setProperty("--ox", Math.cos(angle) * rect.width * 0.85 + "px")
      ghost.style.setProperty("--oy", Math.sin(angle) * rect.height * 0.6 + "px")
      ghost.style.setProperty("--delay", (i * 60) + "ms")
      stage.appendChild(ghost)
    }
    var core = el("span", "fx-core")
    core.style.left = mid.x + "px"
    core.style.top = mid.y + "px"
    stage.appendChild(core)

    function cancel() {
      stage.remove()
      if (card) card.classList.remove("fx-forging")
    }

    function finish(rarity) {
      var remaining = Math.max(0, MIN_FUSE_MS - (Date.now() - started))
      return wait(remaining).then(function () {
        stage.className = "fx-layer fx-forge is-flash r-" + rarityOf(rarity)
        sparks(stage, mid.x, mid.y, 30 + RARITY_RANK[rarityOf(rarity)] * 8, 190)
        return wait(FLASH_MS)
      }).then(function () {
        setTimeout(function () { stage.remove() }, 700)
      })
    }

    return { finish: finish, cancel: cancel }
  }

  window.CanjeFx = { purchase: purchase, chest: chest, forge: forge, bestRarity: bestRarity }
})()
