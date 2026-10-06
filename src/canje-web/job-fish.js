// Trabajo: Pesca (Minijuegos > Trabajos). Gratis y sin espera.
// Un lago de noche: se lanza el anzuelo (clic en el agua o "Lanzar"), el
// flotador se mece y da algun falso aviso, y cuando pica de verdad se hunde
// con un "!": hay poco tiempo para engancharlo. Despues toca recoger: se
// mantiene pulsado para tensar el sedal y hay que dejar la marca dentro de la
// zona verde mientras el pez tira; si se tensa del todo se rompe y si se
// afloja demasiado se escapa. Lo que se pesca lo decide el servidor al
// entregar, y salta fuera del agua antes de enseñarlo.
(function () {
  "use strict"

  var BITE_WINDOW_MS = 1400
  var CAST_MS = 720
  var ZONE = 0.28 // ancho de la zona verde
  var TENSION_UP = 0.95 // por segundo, manteniendo pulsado
  var TENSION_DOWN = 0.75
  var PROGRESS_IN = 0.38
  var PROGRESS_OUT = 0.22
  var PROGRESS_START = 0.3
  var CATCH_SHOW_MS = 2200
  var COLORS = {
    bota: null, sardina: ["#cbd5e1", "#f8fafc", "#64748b"], trucha: ["#65a30d", "#fef9c3", "#3f6212", "#1c1917"],
    salmon: ["#fb7185", "#ffe4e6", "#be123c"], globo: null, atun: ["#1e3a8a", "#bfdbfe", "#172554"], dorado: ["#fbbf24", "#fff7cc", "#b45309"],
  }
  var CATCH_GLOW = { bota: "#a8a29e", sardina: "#cbd5e1", trucha: "#86efac", salmon: "#fda4af", globo: "#fde047", atun: "#60a5fa", dorado: "#fbbf24" }

  var kit = window.GameKit
  var job = window.JobKit
  var ui = null
  var state = "idle" // idle | casting | waiting | bite | reel | landing
  var task = null
  var size = { w: 0, h: 0 }
  var bob = { x: 0, y: 0 } // posicion del flotador (px en la escena)
  var cast = null // { from, to, at }
  var reel = null // { tension, progress, holding, zoneT, phase, pull, from }
  var timers = []
  var frame = 0
  var lastTime = 0
  var ratchet = null
  var stats = { caught: 0, lost: 0, net: 0 }
  var info = null
  var reeledIn = false

  function el(tag, className, text) { return kit.el(tag, className, text) }
  function fmt(n) { return kit.fmt(n) }
  function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id }
  function clearTimers() { timers.forEach(clearTimeout); timers = [] }

  // ── Geometria ───────────────────────────────────────────────────────────────
  function measure() {
    var rect = ui.scene.getBoundingClientRect()
    size = { w: rect.width, h: rect.height }
    ui.svg.setAttribute("viewBox", "0 0 " + size.w + " " + size.h)
  }

  function rodBase() { return { x: size.w * 1.02, y: size.h * 1.02 } }
  function rodTip() {
    var bend = reel ? reel.tension : 0
    return { x: size.w * 0.84 - bend * 10, y: size.h * 0.3 + bend * size.h * 0.12 }
  }
  function restPos() { var tip = rodTip(); return { x: tip.x - 6, y: tip.y + size.h * 0.16 } }
  function waterTop() { return size.h * 0.46 }

  // ── Dibujo continuo (sedal, caña, flotador) ─────────────────────────────────
  function loop(time) {
    var dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 0
    lastTime = time
    if (state === "casting") stepCast(time)
    if (state === "reel") stepReel(dt, time)
    var rest = restPos()
    if (state === "idle") { bob.x = rest.x + Math.sin(time / 700) * 4; bob.y = rest.y }
    // Pez fuera: el flotador vuelve solo a la caña mientras se enseña la captura.
    if (state === "landing" && reeledIn) { bob.x += (rest.x - bob.x) * 0.08; bob.y += (rest.y - bob.y) * 0.08 }
    draw()
    frame = requestAnimationFrame(loop)
  }

  function draw() {
    var tip = rodTip()
    var base = rodBase()
    ui.rod.setAttribute("d", "M" + base.x + " " + base.y + " Q" + (base.x - size.w * 0.06) + " " + (tip.y + (base.y - tip.y) * 0.45) + " " + tip.x + " " + tip.y)
    var slack = state === "reel" ? (1 - reel.tension) * 40 : state === "idle" ? 4 : 60
    var mx = (tip.x + bob.x) / 2
    var my = Math.max(tip.y, bob.y) + slack
    ui.line.setAttribute("d", "M" + tip.x + " " + tip.y + " Q" + mx + " " + my + " " + bob.x + " " + bob.y)
    ui.bobber.style.setProperty("--x", bob.x.toFixed(1) + "px")
    ui.bobber.style.setProperty("--y", bob.y.toFixed(1) + "px")
  }

  // ── Lanzar ──────────────────────────────────────────────────────────────────
  function castTo(x, y) {
    if (state !== "idle") return
    measure()
    var to = {
      x: Math.max(size.w * 0.12, Math.min(size.w * 0.72, x)),
      y: Math.max(waterTop() + size.h * 0.08, Math.min(size.h * 0.86, y)),
    }
    state = "casting"
    setButton("Lanzando…", true)
    hint("Esperando a que pique…")
    ui.result.className = "g-result is-hidden"
    kit.sound("cast")
    job.start("fish").then(function (next) {
      task = next
      cast = { from: { x: bob.x, y: bob.y }, to: to, at: performance.now() }
      scheduleBite(next.biteMs)
    }).catch(function (error) {
      state = "idle"
      setButton("Lanzar", false)
      hint(error.message)
    })
  }

  function stepCast(time) {
    if (!cast) return
    var s = Math.min(1, (time - cast.at) / CAST_MS)
    var ease = 1 - Math.pow(1 - s, 2)
    bob.x = cast.from.x + (cast.to.x - cast.from.x) * ease
    bob.y = cast.from.y + (cast.to.y - cast.from.y) * ease - Math.sin(s * Math.PI) * size.h * 0.28
    if (s >= 1) land()
  }

  function land() {
    cast = null
    if (state !== "casting") return
    state = "waiting"
    ui.bobber.className = "jf-bobber is-floating"
    kit.sound("plop")
    ripple(bob, 3)
    setButton("Esperando…", true)
  }

  // Avisos falsos antes del bueno (y el bueno a los biteMs).
  function scheduleBite(biteMs) {
    var nibbles = Math.floor(Math.random() * 3)
    for (var i = 0; i < nibbles; i++) {
      var at = CAST_MS + 300 + Math.random() * Math.max(0, biteMs - CAST_MS - 900)
      later(nibble, at)
    }
    later(bite, Math.max(CAST_MS + 200, biteMs))
  }

  function nibble() {
    if (state !== "waiting") return
    kit.restart(ui.bobber, "is-nibble")
    ripple(bob, 1)
    kit.sound("bubble")
  }

  function bite() {
    if (state !== "waiting") return
    state = "bite"
    ui.bobber.className = "jf-bobber is-bite"
    ui.alert.className = "jf-alert is-on"
    kit.sound("bite")
    kit.haptic([40, 30, 40])
    ripple(bob, 3)
    setButton("¡Engancha!", false)
    hint("¡Ha picado! Rápido: clic, Espacio o el botón.")
    later(function () {
      if (state === "bite") escape("Se escapó: tardaste demasiado en engancharlo.")
    }, BITE_WINDOW_MS)
  }

  // ── Recoger ─────────────────────────────────────────────────────────────────
  function hook() {
    state = "reel"
    ui.alert.className = "jf-alert"
    ui.bobber.className = "jf-bobber is-hooked"
    reel = { tension: 0.3, progress: PROGRESS_START, holding: true, phase: Math.random() * 6, pull: 0, from: { x: bob.x, y: bob.y }, start: performance.now(), jerkAt: performance.now() + 700 }
    ui.meter.hidden = false
    kit.sound("splash")
    kit.restart(ui.stage, "fx-shake")
    ratchet = window.SoundKit.ratchet()
    setButton("Mantén para recoger", false)
    hint("Mantén pulsado para tensar y suelta para aflojar. Deja la marca en la zona verde.")
  }

  function zoneCenter(time) {
    var t = (time - reel.start) / 1000
    return 0.5 + Math.sin(t * 0.9 + reel.phase) * 0.22 + Math.sin(t * 2.3 + reel.phase * 2) * 0.08
  }

  function stepReel(dt, time) {
    // Tirones del pez: suben la tension de golpe.
    if (time > reel.jerkAt) {
      reel.tension = Math.min(1, reel.tension + 0.12 + Math.random() * 0.1)
      reel.pull = 1
      reel.jerkAt = time + 900 + Math.random() * 1400
      kit.sound("splash")
      ripple(bob, 1)
    }
    reel.pull = Math.max(0, reel.pull - dt * 3)
    reel.tension = Math.max(0, Math.min(1, reel.tension + (reel.holding ? TENSION_UP : -TENSION_DOWN) * dt))
    var center = zoneCenter(time)
    var inZone = Math.abs(reel.tension - center) <= ZONE / 2
    reel.progress = Math.max(0, Math.min(1, reel.progress + (inZone ? PROGRESS_IN : -PROGRESS_OUT) * dt))
    ui.meter.style.setProperty("--zone", (center - ZONE / 2).toFixed(3))
    ui.meter.style.setProperty("--t", reel.tension.toFixed(3))
    ui.meter.style.setProperty("--p", reel.progress.toFixed(3))
    ui.meter.classList.toggle("is-in", inZone)
    ui.meter.classList.toggle("is-danger", reel.tension > 0.9)
    if (ratchet) ratchet.set(reel.holding ? 0.35 + reel.tension * 0.65 : 0)
    // El flotador se acerca a la orilla segun se recoge y se agita con el pez.
    var shore = { x: size.w * 0.74, y: size.h * 0.6 }
    bob.x = reel.from.x + (shore.x - reel.from.x) * reel.progress * 0.75 + Math.sin(time / 90) * (3 + reel.pull * 8)
    bob.y = reel.from.y + (shore.y - reel.from.y) * reel.progress * 0.75 + Math.cos(time / 120) * (2 + reel.pull * 5)
    if (reel.tension >= 1) snap()
    else if (reel.progress >= 1) landFish()
    else if (reel.progress <= 0) escape("Se escapó: aflojaste demasiado.")
  }

  function setHolding(on) { if (reel) reel.holding = on }

  function snap() {
    kit.sound("snap")
    kit.haptic(80)
    escape("¡Se rompió el sedal! Tensaste demasiado.")
  }

  function stopReel() {
    reel = null
    ui.meter.hidden = true
    if (ratchet) { ratchet.stop(); ratchet = null }
  }

  function escape(message) {
    clearTimers()
    stopReel()
    state = "idle"
    task = null
    stats.lost += 1
    ui.stats.set("lost", stats.lost, "lose")
    ui.alert.className = "jf-alert"
    ui.bobber.className = "jf-bobber"
    ui.history.add("Se escapó", "lose")
    kit.sound("lose")
    ui.result.className = "g-result is-lose"
    ui.result.textContent = ""
    ui.result.appendChild(el("strong", "", "¡Se escapó!"))
    ui.result.appendChild(el("span", "", message))
    setButton("Lanzar otra vez", false)
    hint("Haz clic en el agua para lanzar.")
  }

  // ── Pez fuera ───────────────────────────────────────────────────────────────
  function landFish() {
    state = "landing"
    stopReel()
    setButton("Sacándolo…", true)
    hint("¡Ya casi!")
    var sent = task
    task = null
    job.finish(sent, false).then(function (result) {
      showCatch(result)
      kit.afterPlay(result, { quiet: true })
    }).catch(function (error) {
      state = "idle"
      ui.bobber.className = "jf-bobber"
      setButton("Lanzar", false)
      hint(error.reason === "no-task" ? "El pez se cansó de esperar. Lanza otra vez." : error.message)
    })
  }

  function showCatch(result) {
    var id = result.outcome.id
    var glow = CATCH_GLOW[id] || "#e0f2fe"
    var from = { x: bob.x, y: bob.y }
    ui.bobber.className = "jf-bobber"
    reeledIn = true
    setButton("¡Pescado!", true)
    kit.sound("splash", { big: true })
    ripple(from, 4)
    // El pez salta en arco hacia el centro.
    var fish = el("span", "jf-leap")
    fish.innerHTML = artOf(id)
    fish.style.left = from.x + "px"
    fish.style.top = from.y + "px"
    ui.scene.appendChild(fish)
    var dx = size.w * 0.45 - from.x
    if (!kit.reducedMotion) fish.animate([
      { transform: "translate(-50%, -50%) translate(0, 0) rotate(-40deg) scale(.5)", opacity: 1 },
      { transform: "translate(-50%, -50%) translate(" + dx * 0.5 + "px, " + (-size.h * 0.32) + "px) rotate(20deg) scale(1)", offset: 0.5 },
      { transform: "translate(-50%, -50%) translate(" + dx + "px, " + (-size.h * 0.12) + "px) rotate(80deg) scale(.9)", opacity: 0 },
    ], { duration: 900, easing: "cubic-bezier(.3, .7, .4, 1)", fill: "forwards" })
    later(function () { fish.remove() }, 950)
    later(function () { card(result, glow) }, kit.reducedMotion ? 0 : 650)
  }

  function card(result, glow) {
    var id = result.outcome.id
    var box = el("div", "jf-catch is-" + id + (result.outcome.big ? " is-big" : ""))
    box.style.setProperty("--c", glow)
    box.appendChild(el("span", "jm-rays"))
    var art = el("span", "jf-catch-art")
    art.innerHTML = artOf(id)
    box.appendChild(art)
    box.appendChild(el("strong", "", result.outcome.label))
    box.appendChild(el("span", "jf-catch-pay", job.money(result.delta)))
    ui.scene.appendChild(box)
    var origin = kit.centerOf(box)
    if (id === "dorado") { kit.celebrate("jackpot", glow, origin); kit.flash(glow) }
    else if (result.outcome.big) kit.celebrate("big", glow, origin)
    else if (id === "bota") kit.sound("lose")
    else { kit.sound("win-small"); kit.sparks(origin, glow, 14) }
    stats.caught += 1
    stats.net += result.delta
    ui.stats.set("caught", stats.caught)
    ui.stats.set("net", stats.net, "win")
    ui.history.add(result.outcome.label + " · " + job.money(result.delta), result.delta >= 1800 ? "win" : id === "bota" ? "lose" : "")
    ui.result.className = "g-result" + (result.delta >= 1800 ? " is-win" : "")
    ui.result.textContent = ""
    ui.result.appendChild(el("strong", "", id === "bota" ? "Vaya, una bota" : "¡" + result.outcome.label + "!"))
    ui.result.appendChild(el("span", "", result.delta ? "Has ganado " + fmt(result.delta) + " pts." : "Esta vez no vale nada. ¡Otra!"))
    later(function () {
      box.classList.add("is-out")
      later(function () { box.remove() }, 400)
      state = "idle"
      reeledIn = false
      setButton("Lanzar otra vez", false)
      hint("Haz clic en el agua para lanzar.")
    }, CATCH_SHOW_MS)
  }

  // ── Dibujos ─────────────────────────────────────────────────────────────────
  function artOf(id) {
    if (id === "bota") return '<svg viewBox="0 0 80 64"><path d="M18 6h22v30l26 6c6 2 8 8 6 14H14z" fill="#78350f" stroke="#2a1606" stroke-width="2.5" stroke-linejoin="round"/><path d="M14 56h58" stroke="#2a1606" stroke-width="5" stroke-linecap="round"/><path d="M22 14h14M22 22h14" stroke="#d6a76c" stroke-width="2"/><path d="M60 30c4-6 10-6 12-2" stroke="#4ade80" stroke-width="3" fill="none" stroke-linecap="round"/></svg>'
    if (id === "globo") return '<svg viewBox="0 0 80 64"><g stroke="#a16207" stroke-width="2"><path d="M32 6v6M48 6v6M20 14l4 5M60 14l-4 5M14 30h6M66 30h-6M20 48l4-4M60 48l-4-4M32 58v-5M48 58v-5"/></g><circle cx="40" cy="32" r="22" fill="#fde047" stroke="#a16207" stroke-width="2.5"/><path d="M22 38c8 10 28 10 36 0" fill="#fef9c3"/><circle cx="50" cy="26" r="4" fill="#1c1917"/><circle cx="51" cy="25" r="1.4" fill="#fff"/><path d="M60 34c4 0 6 2 6 4" stroke="#a16207" stroke-width="2" fill="none"/><path d="M18 32 6 24v16z" fill="#facc15" stroke="#a16207" stroke-width="2"/></svg>'
    var c = COLORS[id] || COLORS.sardina
    var spots = c[3] ? '<g fill="' + c[3] + '" opacity=".75"><circle cx="30" cy="26" r="2"/><circle cx="40" cy="22" r="2"/><circle cx="46" cy="30" r="1.8"/><circle cx="34" cy="34" r="1.6"/><circle cx="24" cy="30" r="1.6"/></g>' : ""
    return '<svg viewBox="0 0 80 64"><path d="M14 32 2 18v28z" fill="' + c[2] + '" stroke="rgba(0,0,0,.45)" stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M12 32C22 14 50 8 68 26c3 3 3 9 0 12C50 56 22 50 12 32z" fill="' + c[0] + '" stroke="rgba(0,0,0,.45)" stroke-width="2"/>' +
      '<path d="M18 36c12 10 34 12 48 2-14 4-34 4-48-2z" fill="' + c[1] + '" opacity=".85"/>' +
      '<path d="M36 12c6-6 16-6 20 2" fill="' + c[2] + '" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>' + spots +
      '<circle cx="58" cy="27" r="4" fill="#0f172a"/><circle cx="59" cy="26" r="1.4" fill="#fff"/><path d="M48 22c2 6 2 14 0 20" stroke="rgba(0,0,0,.3)" stroke-width="2" fill="none"/></svg>'
  }

  function ripple(at, count) {
    if (kit.reducedMotion) return
    for (var i = 0; i < count; i++) {
      var ring = el("span", "jf-ripple")
      ring.style.left = at.x + "px"
      ring.style.top = at.y + "px"
      ring.style.setProperty("--d", (i * 0.22).toFixed(2) + "s")
      ui.scene.appendChild(ring)
      later(function (node) { return function () { node.remove() } }(ring), 1600 + i * 220)
    }
  }

  // ── Controles ───────────────────────────────────────────────────────────────
  function setButton(text, disabled) { ui.button.textContent = text; ui.button.disabled = !!disabled }
  function hint(text) { ui.hint.textContent = text }

  // Accion principal (clic en la escena, Espacio o el boton). `point`: donde lanzar.
  function press(point) {
    if (state === "idle") {
      var at = point || { x: size.w * (0.2 + Math.random() * 0.45), y: size.h * (0.6 + Math.random() * 0.22) }
      castTo(at.x, at.y)
    } else if (state === "bite") {
      hook()
    } else if (state === "waiting") {
      hint("Aún no ha picado… paciencia.")
      kit.restart(ui.bobber, "is-nibble")
    } else if (state === "reel") {
      setHolding(true)
    }
  }

  function release() { if (state === "reel") setHolding(false) }

  function scenePoint(event) {
    var rect = ui.scene.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  // ── Construccion ────────────────────────────────────────────────────────────
  function build(section) {
    var parts = kit.layout(section, { id: "fish", kicker: "Trabajo", feed: "trabajo", title: "Pesca", hint: "Gratis y sin esperas. Lanza, espera a que se hunda el flotador y engancha rápido. Para recoger, deja la marca en la zona verde." })
    ui = { stage: parts.stage }
    var scene = el("div", "jf-scene")
    scene.tabIndex = 0
    scene.setAttribute("role", "application")
    scene.setAttribute("aria-label", "Lago. Clic o Espacio para lanzar, enganchar y recoger.")
    scene.appendChild(el("span", "jf-sky"))
    var stars = el("span", "jf-stars")
    for (var i = 0; i < 26; i++) {
      var star = el("i", "")
      star.style.setProperty("--x", (Math.random() * 100).toFixed(1) + "%")
      star.style.setProperty("--y", (Math.random() * 40).toFixed(1) + "%")
      star.style.setProperty("--d", (Math.random() * -4).toFixed(2) + "s")
      stars.appendChild(star)
    }
    scene.appendChild(stars)
    scene.appendChild(el("span", "jf-moon"))
    scene.appendChild(el("span", "jf-hills"))
    var water = el("span", "jf-water")
    water.appendChild(el("span", "jf-waves"))
    water.appendChild(el("span", "jf-waves is-back"))
    water.appendChild(el("span", "jf-moonpath"))
    scene.appendChild(water)
    scene.appendChild(el("span", "jf-dock"))
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("class", "jf-lines")
    svg.setAttribute("aria-hidden", "true")
    var rod = document.createElementNS(svg.namespaceURI, "path")
    rod.setAttribute("class", "jf-rod")
    var line = document.createElementNS(svg.namespaceURI, "path")
    line.setAttribute("class", "jf-line")
    svg.appendChild(line)
    svg.appendChild(rod)
    scene.appendChild(svg)
    var bobber = el("span", "jf-bobber")
    bobber.appendChild(el("span", "jf-bob"))
    scene.appendChild(bobber)
    var alert = el("span", "jf-alert", "!")
    bobber.appendChild(alert)
    var meter = el("div", "jf-meter")
    meter.hidden = true
    var track = el("div", "jf-track")
    track.appendChild(el("span", "jf-zone"))
    track.appendChild(el("span", "jf-marker"))
    meter.appendChild(track)
    var progress = el("div", "jf-progress")
    progress.appendChild(el("span", ""))
    meter.appendChild(progress)
    meter.appendChild(el("span", "jf-meter-label", "Tensión"))
    scene.appendChild(meter)
    parts.stage.appendChild(scene)
    var hintNode = el("p", "jd-hint", "Haz clic en el agua para lanzar.")
    parts.stage.appendChild(hintNode)
    Object.assign(ui, { scene: scene, svg: svg, rod: rod, line: line, bobber: bobber, alert: alert, meter: meter, hint: hintNode })

    scene.addEventListener("pointerdown", function (event) {
      if (event.button && event.button !== 0) return
      scene.focus({ preventScroll: true })
      press(scenePoint(event))
    })
    window.addEventListener("pointerup", release)
    window.addEventListener("pointercancel", release)
    scene.addEventListener("keydown", function (event) {
      if (event.key !== " " && event.key !== "Enter") return
      event.preventDefault()
      if (!event.repeat) press(null)
    })
    scene.addEventListener("keyup", function (event) { if (event.key === " " || event.key === "Enter") release() })
    scene.addEventListener("blur", release)

    var button = el("button", "btn btn-buy plinko-play", "Lanzar")
    button.type = "button"
    button.addEventListener("pointerdown", function (event) { event.preventDefault(); press(null) })
    button.addEventListener("keydown", function (event) { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); press(null) } })
    button.addEventListener("keyup", function (event) { if (event.key === " " || event.key === "Enter") release() })
    parts.side.appendChild(button)
    ui.button = button
    ui.result = el("div", "g-result is-hidden")
    parts.side.appendChild(ui.result)
    ui.stats = job.panel(parts.side, [{ id: "caught", label: "Pescados" }, { id: "lost", label: "Escapados" }, { id: "net", label: "Ganado" }])
    ui.history = job.history(parts.side, "Tus últimas capturas", "Todavía no has pescado nada.")
    kit.jobsInfo().then(function (all) { info = all.fish; job.payTable(parts.side, "Qué puede picar", info.catches) }).catch(function () {})
    window.addEventListener("resize", function () { if (ui.scene.offsetParent) measure() })
  }

  function show() {
    measure()
    var rest = restPos()
    bob.x = rest.x
    bob.y = rest.y
    if (!frame) { lastTime = 0; frame = requestAnimationFrame(loop) }
  }

  // Al salir se suelta todo: un pez a medias se pierde (no cuesta nada).
  function hide() {
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    if (state !== "idle" && state !== "landing") {
      clearTimers()
      stopReel()
      state = "idle"
      task = null
      cast = null
      if (ui) { ui.bobber.className = "jf-bobber"; ui.alert.className = "jf-alert"; setButton("Lanzar", false); hint("Haz clic en el agua para lanzar.") }
    }
  }

  kit.register("fish", { build: build, show: show, hide: hide })
})()
