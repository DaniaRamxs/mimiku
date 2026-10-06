// Trabajo: Lavaplatos (Minijuegos > Trabajos). Gratis y sin espera.
// Llega un plato sucio (manchas de comida dibujadas al azar en un canvas) y
// se frota con la esponja, con el raton o el dedo (con el teclado: mantener
// Espacio). Al frotar sale espuma y burbujas, y el agua del grifo suena de
// fondo. Cuando esta limpio brilla, se levanta y va al escurridor: entonces el
// servidor decide si se resbala y se rompe (quita puntos) o si se cobra.
// Cada entrega ya trae el plato siguiente (una peticion por plato).
(function () {
  "use strict"

  var CLEAN_AT = 0.9 // parte limpia para darlo por terminado
  var MIN_SCRUB_MS = 2100 // nunca se entrega antes (el servidor pide 2 s)
  var BRUSH = 0.13 // radio de la esponja, en partes del plato
  var SAMPLE_EVERY = 6
  var DIRTY_ALPHA = 70 // por encima, el pixel cuenta como mancha (la pelicula de grasa no cuenta)
  var PATTERNS = 5
  var FOODS = [
    { color: [178, 52, 26], name: "tomate" },
    { color: [214, 150, 32], name: "curry" },
    { color: [92, 52, 26], name: "chocolate" },
    { color: [104, 128, 38], name: "pesto" },
    { color: [160, 96, 40], name: "salsa" },
  ]

  var kit = window.GameKit
  var job = window.JobKit
  var ui = null
  var task = null
  var plate = null // { pattern, grimeTotal, cleaned, startedAt, done }
  var info = null
  var stats = { clean: 0, broken: 0, net: 0, streak: 0 }
  var scrubbing = false
  var last = null
  var lastMove = 0
  var moves = 0
  var scrubSound = null
  var water = null
  var keyTimer = null
  var busy = false
  var visible = false
  var foamFrame = 0
  var foamUntil = 0
  var lastBubble = 0

  function el(tag, className, text) { return kit.el(tag, className, text) }
  function fmt(n) { return kit.fmt(n) }

  // ── Dibujo del plato sucio ──────────────────────────────────────────────────
  // Tamaño de maquetacion (offsetWidth): no cambia mientras el plato se anima.
  function sizeCanvas(canvas) {
    var width = canvas.offsetWidth
    var ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(canvas.offsetHeight * ratio))
    var ctx = canvas.getContext("2d", { willReadFrequently: true })
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    return { ctx: ctx, size: width }
  }

  // Mancha irregular: un poligono con radios al azar y bordes suaves.
  function stain(ctx, cx, cy, radius, rgb, alpha) {
    var points = 14
    var grad = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius)
    grad.addColorStop(0, "rgba(" + rgb.join(",") + "," + alpha + ")")
    grad.addColorStop(0.7, "rgba(" + rgb.join(",") + "," + alpha * 0.8 + ")")
    grad.addColorStop(1, "rgba(" + rgb.join(",") + ",0)")
    ctx.fillStyle = grad
    ctx.beginPath()
    for (var i = 0; i <= points; i++) {
      var angle = (i / points) * Math.PI * 2
      var r = radius * (0.65 + Math.random() * 0.45)
      var x = cx + Math.cos(angle) * r
      var y = cy + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }

  function paintGrime() {
    var canvas = ui.grime
    var fit = sizeCanvas(canvas)
    var ctx = fit.ctx
    var size = fit.size
    var c = size / 2
    ctx.globalCompositeOperation = "source-over"
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.beginPath()
    ctx.arc(c, c, c * 0.96, 0, Math.PI * 2)
    ctx.clip()
    // Pelicula de grasa por todo el plato
    ctx.fillStyle = "rgba(120, 96, 52, .22)"
    ctx.fillRect(0, 0, size, size)
    var foods = FOODS.slice().sort(function () { return Math.random() - 0.5 }).slice(0, 2 + Math.floor(Math.random() * 2))
    foods.forEach(function (food) {
      var blobs = 3 + Math.floor(Math.random() * 4)
      for (var i = 0; i < blobs; i++) {
        var angle = Math.random() * Math.PI * 2
        var dist = Math.random() * c * 0.62
        stain(ctx, c + Math.cos(angle) * dist, c + Math.sin(angle) * dist, c * (0.14 + Math.random() * 0.24), food.color, 0.72 + Math.random() * 0.22)
      }
      // Restregones (como si alguien hubiera rebañado con el pan)
      ctx.strokeStyle = "rgba(" + food.color.join(",") + ",.55)"
      ctx.lineCap = "round"
      for (var s = 0; s < 2; s++) {
        ctx.lineWidth = c * (0.04 + Math.random() * 0.05)
        ctx.beginPath()
        var a = Math.random() * Math.PI * 2
        var r0 = c * (0.2 + Math.random() * 0.4)
        ctx.arc(c, c, r0, a, a + 0.6 + Math.random() * 1.2)
        ctx.stroke()
      }
    })
    // Migas
    for (var m = 0; m < 26; m++) {
      var ang = Math.random() * Math.PI * 2
      var d = Math.random() * c * 0.85
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(70, 42, 20, .85)" : "rgba(196, 160, 96, .9)"
      ctx.beginPath()
      ctx.ellipse(c + Math.cos(ang) * d, c + Math.sin(ang) * d, 1.2 + Math.random() * 2.6, 1 + Math.random() * 1.8, Math.random() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    plate.grimeTotal = dirtyCount()
    plate.cleaned = 0
    ui.grime.classList.remove("is-gone")
  }

  // Pixeles con mancha (muestreando la transparencia del canvas).
  function dirtyCount() {
    var canvas = ui.grime
    var data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data
    var dirty = 0
    for (var i = 3; i < data.length; i += 4 * 29) if (data[i] > DIRTY_ALPHA) dirty += 1
    return dirty
  }

  // ── Frotar ──────────────────────────────────────────────────────────────────
  function erase(x, y) {
    var canvas = ui.grime
    var ctx = canvas.getContext("2d")
    var size = canvas.offsetWidth
    var radius = size * BRUSH
    ctx.globalCompositeOperation = "destination-out"
    var steps = last ? Math.max(1, Math.ceil(Math.hypot(x - last.x, y - last.y) / (radius * 0.35))) : 1
    for (var i = 1; i <= steps; i++) {
      var px = last ? last.x + (x - last.x) * (i / steps) : x
      var py = last ? last.y + (y - last.y) * (i / steps) : y
      var grad = ctx.createRadialGradient(px, py, radius * 0.15, px, py, radius)
      grad.addColorStop(0, "rgba(0,0,0,.85)")
      grad.addColorStop(0.55, "rgba(0,0,0,.55)")
      grad.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(px, py, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  function scrubAt(x, y) {
    if (!plate || plate.done || !task) return
    var now = performance.now()
    var speed = last ? Math.hypot(x - last.x, y - last.y) / Math.max(8, now - lastMove) : 0
    erase(x, y)
    foam(x, y)
    if (scrubSound) scrubSound.set(Math.min(1, speed / 1.2))
    moveSponge(x, y, speed)
    if (now - lastBubble > 70 && speed > 0.15) { lastBubble = now; bubble(x, y, speed) }
    last = { x: x, y: y }
    lastMove = now
    moves += 1
    if (moves % SAMPLE_EVERY === 0) measure()
  }

  function measure() {
    if (!plate || plate.done) return
    var left = dirtyCount()
    plate.cleaned = plate.grimeTotal ? 1 - left / plate.grimeTotal : 1
    ui.ring.style.setProperty("--p", Math.min(1, plate.cleaned / CLEAN_AT).toFixed(3))
    ui.percent.textContent = Math.min(100, Math.round((plate.cleaned / CLEAN_AT) * 100)) + "%"
    if (plate.cleaned >= CLEAN_AT) plateClean()
  }

  // Espuma blanca encima del plato que se va deshaciendo sola.
  function foam(x, y) {
    if (kit.reducedMotion) return
    var ctx = ui.foam.getContext("2d")
    var size = ui.foam.offsetWidth
    for (var i = 0; i < 3; i++) {
      var r = size * (0.012 + Math.random() * 0.03)
      var fx = x + (Math.random() - 0.5) * size * 0.12
      var fy = y + (Math.random() - 0.5) * size * 0.12
      var grad = ctx.createRadialGradient(fx - r * 0.3, fy - r * 0.3, r * 0.1, fx, fy, r)
      grad.addColorStop(0, "rgba(255,255,255,.95)")
      grad.addColorStop(0.75, "rgba(236,246,255,.75)")
      grad.addColorStop(1, "rgba(200,225,255,0)")
      ctx.globalCompositeOperation = "source-over"
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(fx, fy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    foamUntil = performance.now() + 2600
    if (!foamFrame) foamFrame = requestAnimationFrame(fadeFoam)
  }

  function fadeFoam() {
    var canvas = ui.foam
    var ctx = canvas.getContext("2d")
    ctx.globalCompositeOperation = "destination-out"
    ctx.fillStyle = "rgba(0,0,0,.035)"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (performance.now() < foamUntil) foamFrame = requestAnimationFrame(fadeFoam)
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); foamFrame = 0 }
  }

  // Burbuja de jabon que sube desde la esponja y explota.
  function bubble(x, y, speed) {
    if (kit.reducedMotion) return
    var node = el("span", "jd-bubble")
    var rect = ui.work.getBoundingClientRect()
    var plateRect = ui.plate.getBoundingClientRect()
    node.style.left = (plateRect.left - rect.left + x) + "px"
    node.style.top = (plateRect.top - rect.top + y) + "px"
    node.style.setProperty("--s", (8 + Math.random() * 18).toFixed(0) + "px")
    node.style.setProperty("--dx", ((Math.random() - 0.5) * 80).toFixed(0) + "px")
    node.style.setProperty("--dy", (-60 - Math.random() * 90).toFixed(0) + "px")
    node.style.setProperty("--t", (0.9 + Math.random() * 0.8).toFixed(2) + "s")
    ui.work.appendChild(node)
    if (Math.random() < 0.35 + speed * 0.2) setTimeout(function () { kit.sound("bubble", { pan: (x / plateRect.width - 0.5) }) }, 500 + Math.random() * 500)
    setTimeout(function () { node.remove() }, 1800)
  }

  function moveSponge(x, y, speed) {
    var plateRect = ui.plate.getBoundingClientRect()
    var rect = ui.work.getBoundingClientRect()
    var tilt = Math.max(-18, Math.min(18, (last ? x - last.x : 0) * 0.9))
    ui.sponge.style.setProperty("--x", (plateRect.left - rect.left + x) + "px")
    ui.sponge.style.setProperty("--y", (plateRect.top - rect.top + y) + "px")
    ui.sponge.style.setProperty("--tilt", tilt.toFixed(1) + "deg")
    ui.sponge.style.setProperty("--squash", (1 - Math.min(0.18, speed * 0.08)).toFixed(3))
  }

  function startScrub() {
    if (!plate || plate.done || !task || busy) return false
    scrubbing = true
    last = null
    ui.sponge.classList.add("is-down")
    if (!scrubSound) scrubSound = window.SoundKit.loop("scrub")
    return true
  }

  function stopScrub() {
    if (!scrubbing) return
    scrubbing = false
    last = null
    ui.sponge.classList.remove("is-down")
    if (scrubSound) { scrubSound.stop(); scrubSound = null }
    measure()
  }

  // Con el teclado: la esponja da vueltas en espiral mientras se mantiene Espacio.
  function keyScrub(on) {
    if (on && !keyTimer) {
      if (!startScrub()) return
      var size = ui.plate.offsetWidth
      var t = Math.random() * 10
      keyTimer = setInterval(function () {
        t += 0.22
        var r = size * (0.12 + 0.3 * Math.abs(Math.sin(t * 0.21)))
        scrubAt(size / 2 + Math.cos(t) * r, size / 2 + Math.sin(t * 1.3) * r)
      }, 24)
    } else if (!on && keyTimer) {
      clearInterval(keyTimer)
      keyTimer = null
      stopScrub()
    }
  }

  // ── Plato terminado ─────────────────────────────────────────────────────────
  function plateClean() {
    if (plate.done) return
    plate.done = true
    keyScrub(false)
    stopScrub()
    ui.plate.classList.add("is-clean")
    ui.sponge.classList.remove("is-on")
    ui.grime.classList.add("is-gone")
    ui.ring.style.setProperty("--p", "1")
    ui.percent.textContent = "100%"
    kit.restart(ui.glint, "is-on")
    kit.sound("shine")
    kit.sparks(kit.centerOf(ui.plate), "#e0f2fe", 14)
    var wait = Math.max(0, MIN_SCRUB_MS - (Date.now() - plate.startedAt))
    setTimeout(deliver, Math.max(450, wait))
  }

  function deliver() {
    if (!task) return
    busy = true
    ui.plate.classList.add("is-lift")
    kit.sound("whoosh")
    var sent = task
    job.finish(sent, true).then(function (result) {
      task = result.next || null
      if (result.outcome.broken) breakPlate(result)
      else rackPlate(result)
      kit.afterPlay(result, { quiet: true })
    }).catch(function (error) {
      busy = false
      ui.plate.classList.remove("is-lift")
      if (error.reason === "no-task") { task = null; return ensureTask().then(function () { plate.startedAt = Date.now(); setTimeout(deliver, MIN_SCRUB_MS) }) }
      window.CanjeApp.toast(error.message)
      setTimeout(function () { if (plate && plate.done && !busy) deliver() }, 2500)
    })
  }

  function rackPlate(result) {
    stats.clean += 1
    stats.streak += 1
    stats.net += result.delta
    var from = ui.plate.getBoundingClientRect()
    var to = ui.rack.getBoundingClientRect()
    var dx = to.left + to.width / 2 - (from.left + from.width / 2)
    var dy = to.top + to.height * 0.45 - (from.top + from.height / 2)
    kit.floatText(kit.centerOf(ui.plate), job.money(result.delta), "#86efac")
    var flight = kit.reducedMotion ? null : ui.plate.animate([
      { transform: "translate(0, -14px) scale(1.06)" },
      { transform: "translate(" + dx * 0.5 + "px, " + (dy * 0.5 - 70) + "px) scale(.7) rotateY(50deg)", offset: 0.55 },
      { transform: "translate(" + dx + "px, " + dy + "px) scale(.34) rotateY(76deg)", opacity: 0.2 },
    ], { duration: 620, easing: "cubic-bezier(.5, 0, .3, 1)" })
    setTimeout(function () {
      addToRack(result)
      kit.sound("clink", { pan: 0.6 })
      kit.haptic(18)
      if (stats.streak && stats.streak % 5 === 0) streakBadge()
      paintStats()
      ui.history.add("Plato limpio · " + job.money(result.delta), "win")
      nextPlate()
    }, flight ? 600 : 50)
  }

  function addToRack(result) {
    var slot = el("span", "jd-racked p-" + plate.pattern)
    ui.rackPlates.appendChild(slot)
    while (ui.rackPlates.children.length > 7) ui.rackPlates.removeChild(ui.rackPlates.firstChild)
    kit.restart(ui.rack, "is-bump")
    ui.rackCount.textContent = fmt(stats.clean)
    return result
  }

  function streakBadge() {
    var badge = el("span", "jd-streak", "Racha x" + stats.streak)
    ui.work.appendChild(badge)
    kit.celebrate("small", "#38bdf8", kit.centerOf(badge), true)
    kit.sound("win-small")
    setTimeout(function () { badge.remove() }, 1800)
  }

  // Se resbala, cae y se hace añicos.
  function breakPlate(result) {
    stats.broken += 1
    stats.streak = 0
    stats.net += result.delta
    ui.plate.classList.add("is-slip")
    kit.sound("whoosh")
    setTimeout(function () {
      var origin = kit.centerOf(ui.plate)
      ui.plate.classList.add("is-hidden")
      shards()
      kit.sound("shatter")
      kit.haptic([40, 30, 90])
      kit.restart(ui.stage, "fx-shake")
      kit.floatText(origin, result.delta ? job.money(result.delta) : "¡Roto!", "#fda4af")
      ui.result.className = "g-result is-lose"
      ui.result.textContent = ""
      ui.result.appendChild(el("strong", "", "¡Se te rompió!"))
      ui.result.appendChild(el("span", "", result.delta ? "Te descontaron " + fmt(-result.delta) + " pts. Al siguiente." : "Sin puntos que descontar. Al siguiente."))
      paintStats()
      ui.history.add("Plato roto · " + job.money(result.delta), "lose")
      setTimeout(nextPlate, 1100)
    }, kit.reducedMotion ? 50 : 520)
  }

  // Trozos del plato: cuñas con el mismo dibujo que salen volando.
  function shards() {
    var rect = ui.plate.getBoundingClientRect()
    var box = ui.work.getBoundingClientRect()
    var count = 9
    for (var i = 0; i < count; i++) {
      var a0 = (i / count) * 360 + (Math.random() - 0.5) * 12
      var a1 = ((i + 1) / count) * 360 + (Math.random() - 0.5) * 12
      var piece = el("span", "jd-shard jd-face p-" + plate.pattern)
      piece.style.left = (rect.left - box.left) + "px"
      piece.style.top = (rect.top - box.top) + "px"
      piece.style.width = rect.width + "px"
      piece.style.height = rect.height + "px"
      var mid = (a0 + a1) / 2
      var jag = 50 + (Math.random() - 0.5) * 18
      piece.style.clipPath = "polygon(50% 50%, " + polar(a0, 52) + ", " + polar(mid, jag + 6) + ", " + polar(a1, 52) + ")"
      ui.work.appendChild(piece)
      var rad = (mid - 90) * Math.PI / 180
      var push = 70 + Math.random() * 110
      var spin = (Math.random() - 0.5) * 540
      // Salen hacia fuera y hacia arriba, y despues caen.
      if (!kit.reducedMotion) piece.animate([
        { transform: "translate(0, 0) rotate(0deg) scale(1)", opacity: 1 },
        { transform: "translate(" + Math.cos(rad) * push * 0.6 + "px, " + (Math.sin(rad) * push * 0.4 - 50 - Math.random() * 40) + "px) rotate(" + spin * 0.4 + "deg) scale(.96)", opacity: 1, offset: 0.35 },
        { transform: "translate(" + Math.cos(rad) * push + "px, " + (150 + Math.random() * 60) + "px) rotate(" + spin + "deg) scale(.9)", opacity: 0 },
      ], { duration: 1100 + Math.random() * 300, easing: "cubic-bezier(.3, .5, .6, 1)", fill: "forwards" })
      setTimeout(function (node) { return function () { node.remove() } }(piece), 1500)
    }
  }

  function polar(deg, radius) {
    var rad = (deg - 90) * Math.PI / 180
    return (50 + Math.cos(rad) * radius).toFixed(1) + "% " + (50 + Math.sin(rad) * radius).toFixed(1) + "%"
  }

  // ── Plato nuevo ─────────────────────────────────────────────────────────────
  function freshPlate() {
    plate = { pattern: Math.floor(Math.random() * PATTERNS), grimeTotal: 0, cleaned: 0, startedAt: Date.now(), done: false }
    ui.plate.className = "jd-plate"
    ui.face.className = "jd-face p-" + plate.pattern
    ui.ring.style.setProperty("--p", "0")
    ui.percent.textContent = "0%"
    paintGrime()
  }

  function nextPlate() {
    busy = false
    freshPlate()
    if (!kit.reducedMotion) {
      ui.plate.animate([
        { transform: "translate(-260px, 30px) rotate(-30deg) scale(.6)", opacity: 0 },
        { transform: "translate(12px, 0) rotate(4deg) scale(1.02)", opacity: 1, offset: 0.75 },
        { transform: "none", opacity: 1 },
      ], { duration: 520, easing: "cubic-bezier(.2, .9, .3, 1.1)" })
      kit.sound("whoosh")
    }
    kit.restart(ui.pile, "is-take")
    if (!task) ensureTask()
    else plate.startedAt = Date.now()
  }

  function ensureTask() {
    if (task) return Promise.resolve(task)
    ui.hint.textContent = "Preparando el fregadero…"
    return job.start("dishes").then(function (next) {
      task = next
      if (plate) plate.startedAt = Date.now()
      ui.hint.textContent = "Frota el plato con la esponja hasta que brille."
      return task
    }).catch(function (error) {
      ui.hint.textContent = error.message
      throw error
    })
  }

  function paintStats() {
    ui.stats.set("clean", stats.clean)
    ui.stats.set("broken", stats.broken, stats.broken ? "lose" : "")
    ui.stats.set("net", stats.net, stats.net < 0 ? "lose" : "win")
    ui.stats.set("streak", stats.streak)
  }

  function paintInfo() {
    if (!info) return
    ui.rules.textContent = ""
    ;[["Plato limpio", "+" + fmt(info.pay) + " pts", "win"], ["Plato roto", info.penalty ? "-" + fmt(info.penalty) + " pts" : "Nada", "lose"], ["Se rompe", info.breakPct + "% de las veces", ""]].forEach(function (row) {
      var item = el("li", row[2] ? "is-" + row[2] : "")
      item.appendChild(el("span", "", row[0]))
      item.appendChild(el("b", "", row[1]))
      ui.rules.appendChild(item)
    })
  }

  // ── Construccion ────────────────────────────────────────────────────────────
  function build(section) {
    var parts = kit.layout(section, { id: "dishes", kicker: "Trabajo", feed: "trabajo", title: "Lavaplatos", hint: "Gratis y sin esperas. Frota cada plato hasta que brille: si llega al escurridor, cobras. Ojo, que alguno se resbala." })
    ui = { stage: parts.stage }
    var scene = el("div", "jd-scene")
    scene.appendChild(el("div", "jd-tiles"))
    var faucet = el("div", "jd-faucet")
    faucet.appendChild(el("span", "jd-stream"))
    scene.appendChild(faucet)
    var pile = el("div", "jd-pile")
    for (var i = 0; i < 4; i++) pile.appendChild(el("span", "jd-dirty p-" + (i % PATTERNS)))
    pile.appendChild(el("span", "jd-label", "Sucios"))
    scene.appendChild(pile)
    var work = el("div", "jd-work")
    var basin = el("div", "jd-basin")
    basin.appendChild(el("span", "jd-water"))
    work.appendChild(basin)
    var ring = el("div", "jd-ring")
    work.appendChild(ring)
    var plateNode = el("div", "jd-plate")
    plateNode.tabIndex = 0
    plateNode.setAttribute("role", "button")
    plateNode.setAttribute("aria-label", "Plato sucio. Frótalo con el ratón o el dedo, o mantén pulsado Espacio.")
    var face = el("div", "jd-face p-0")
    plateNode.appendChild(face)
    var grime = document.createElement("canvas")
    grime.className = "jd-grime"
    plateNode.appendChild(grime)
    var foamCanvas = document.createElement("canvas")
    foamCanvas.className = "jd-foam"
    plateNode.appendChild(foamCanvas)
    var glint = el("span", "jd-glint")
    plateNode.appendChild(glint)
    work.appendChild(plateNode)
    var percent = el("span", "jd-percent", "0%")
    work.appendChild(percent)
    var sponge = el("div", "jd-sponge")
    sponge.appendChild(el("span", "jd-sponge-pad"))
    sponge.appendChild(el("span", "jd-sponge-foam"))
    work.appendChild(sponge)
    scene.appendChild(work)
    var rack = el("div", "jd-rack")
    var rackPlates = el("div", "jd-rack-plates")
    rack.appendChild(rackPlates)
    rack.appendChild(el("span", "jd-rack-bars"))
    var rackCount = el("span", "jd-rack-count", "0")
    rack.appendChild(rackCount)
    rack.appendChild(el("span", "jd-label", "Limpios"))
    scene.appendChild(rack)
    parts.stage.appendChild(scene)
    var hint = el("p", "jd-hint", "Frota el plato con la esponja hasta que brille.")
    parts.stage.appendChild(hint)

    Object.assign(ui, { plate: plateNode, face: face, grime: grime, foam: foamCanvas, glint: glint, ring: ring, percent: percent, sponge: sponge, work: work, rack: rack, rackPlates: rackPlates, rackCount: rackCount, pile: pile, hint: hint })

    function point(event) {
      var rect = plateNode.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }
    plateNode.addEventListener("pointerdown", function (event) {
      if (!startScrub()) return
      plateNode.setPointerCapture(event.pointerId)
      var p = point(event)
      scrubAt(p.x, p.y)
    })
    plateNode.addEventListener("pointermove", function (event) {
      var p = point(event)
      if (scrubbing) scrubAt(p.x, p.y)
      else { moveSponge(p.x, p.y, 0); last = null }
    })
    plateNode.addEventListener("pointerenter", function () { sponge.classList.add("is-on") })
    plateNode.addEventListener("pointerleave", function () { if (!scrubbing) sponge.classList.remove("is-on") })
    plateNode.addEventListener("pointerup", stopScrub)
    plateNode.addEventListener("pointercancel", stopScrub)
    plateNode.addEventListener("keydown", function (event) {
      if (event.key !== " " && event.key !== "Enter") return
      event.preventDefault()
      sponge.classList.add("is-on")
      keyScrub(true)
    })
    plateNode.addEventListener("keyup", function (event) { if (event.key === " " || event.key === "Enter") keyScrub(false) })
    plateNode.addEventListener("blur", function () { keyScrub(false) })

    ui.result = el("div", "g-result is-hidden")
    parts.side.appendChild(ui.result)
    ui.stats = job.panel(parts.side, [{ id: "clean", label: "Limpios" }, { id: "broken", label: "Rotos" }, { id: "net", label: "Ganado" }, { id: "streak", label: "Racha" }])
    parts.side.appendChild(el("h3", "mini-title", "Paga"))
    ui.rules = el("ul", "jb-pays")
    parts.side.appendChild(ui.rules)
    ui.history = job.history(parts.side, "Tus últimos platos", "Todavía no has lavado ningún plato.")
    kit.jobsInfo().then(function (all) { info = all.dishes; paintInfo() }).catch(function () {})
    requestAnimationFrame(function () {
      sizeCanvas(foamCanvas)
      freshPlate()
    })
    window.addEventListener("resize", function () { if (visible && plate && !plate.done && !scrubbing) { sizeCanvas(foamCanvas); paintGrime() } })
  }

  function show() {
    visible = true
    if (!water) { water = window.SoundKit.loop("water"); water.set(0.7) }
    ensureTask().catch(function () {})
    if (ui && plate && !plate.grimeTotal) requestAnimationFrame(function () { sizeCanvas(ui.foam); paintGrime() })
  }

  function hide() {
    visible = false
    keyScrub(false)
    stopScrub()
    if (water) { water.stop(); water = null }
  }

  kit.register("dishes", { build: build, show: show, hide: hide })
})()
