// Trabajo: Mina (Minijuegos > Trabajos). Gratis y sin espera.
// Una roca en una cueva iluminada por antorchas: cada clic (o Espacio) es un
// golpe de pico que suelta chispas, polvo y esquirlas y abre grietas. Al
// partirse, las dos mitades caen y aparece lo que habia dentro, que decide
// el servidor (de piedra a diamante). Cada entrega ya trae la roca siguiente.
(function () {
  "use strict"

  var HITS = [7, 10] // golpes para partir una roca
  var SWING_MS = 120
  var MIN_WORK_MS = 1500 // nunca se entrega antes (el servidor pide 1,4 s)
  var NEXT_ROCK_MS = 1500
  var CRACKS = [
    "M100 18 L92 52 L104 70 L96 100",
    "M40 70 L66 80 L78 104 L98 110",
    "M162 64 L138 82 L128 108 L104 116",
    "M70 160 L84 134 L96 120",
    "M140 156 L126 136 L108 124",
    "M30 118 L58 116 L80 124",
    "M176 112 L150 116 L120 122",
  ]
  // Dibujos de lo que sale (SVG fijo, sin datos del usuario).
  var FIND_ART = {
    piedra: '<svg viewBox="0 0 64 64"><path d="M10 42 18 22l16-8 16 6 6 18-8 14-22 4z" fill="#78716c" stroke="#292524" stroke-width="2"/><path d="M18 22l10 10 22-12M28 32l-6 24" fill="none" stroke="#a8a29e" stroke-width="2"/></svg>',
    cobre: '<svg viewBox="0 0 64 64"><defs><linearGradient id="jm-cu" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdba74"/><stop offset=".5" stop-color="#c2410c"/><stop offset="1" stop-color="#7c2d12"/></linearGradient></defs><path d="M12 40 20 20l18-6 14 10 2 18-12 12-24-2z" fill="url(#jm-cu)" stroke="#431407" stroke-width="2"/><path d="M22 24l6 4M40 22l4 6" stroke="#ffedd5" stroke-width="2.5" stroke-linecap="round"/></svg>',
    plata: '<svg viewBox="0 0 64 64"><defs><linearGradient id="jm-ag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fafc"/><stop offset=".5" stop-color="#94a3b8"/><stop offset="1" stop-color="#475569"/></linearGradient></defs><path d="M10 38 18 18l20-4 16 12-2 18-14 10-22-4z" fill="url(#jm-ag)" stroke="#1e293b" stroke-width="2"/><path d="M20 22l8 2M38 20l6 8" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg>',
    oro: '<svg viewBox="0 0 64 64"><defs><radialGradient id="jm-au" cx="35%" cy="30%"><stop offset="0" stop-color="#fffbeb"/><stop offset=".45" stop-color="#fbbf24"/><stop offset="1" stop-color="#92400e"/></radialGradient></defs><path d="M8 36c2-12 10-20 22-22 12-1 22 6 26 16 2 10-6 20-18 22-14 2-30-4-30-16z" fill="url(#jm-au)" stroke="#78350f" stroke-width="2"/><path d="M20 24c4-4 8-5 12-4" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/></svg>',
    esmeralda: '<svg viewBox="0 0 64 64"><defs><linearGradient id="jm-em" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bbf7d0"/><stop offset=".5" stop-color="#10b981"/><stop offset="1" stop-color="#065f46"/></linearGradient></defs><path d="M22 6h20l14 14v24L42 58H22L8 44V20z" fill="url(#jm-em)" stroke="#022c22" stroke-width="2"/><path d="M26 16h12l8 8v16l-8 8H26l-8-8V24z" fill="none" stroke="#d1fae5" stroke-width="1.5"/><path d="M24 20l4-2" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
    diamante: '<svg viewBox="0 0 64 64"><path d="M12 24L22 10h20l10 14L32 56z" fill="#67e8f9" stroke="#0e7490" stroke-width="2" stroke-linejoin="round"/><path d="M22 10l6 14h8l6-14M12 24h40M28 24l4 32 4-32" fill="none" stroke="#ecfeff" stroke-width="1.5"/><path d="M22 10l6 14H12z" fill="#cffafe"/></svg>',
  }
  var FIND_COLORS = { piedra: "#a8a29e", cobre: "#fb923c", plata: "#e2e8f0", oro: "#fbbf24", esmeralda: "#34d399", diamante: "#67e8f9" }

  var kit = window.GameKit
  var job = window.JobKit
  var ui = null
  var task = null
  var rock = null // { hp, max, startedAt, done }
  var lastSwing = 0
  var busy = false
  var stats = { rocks: 0, net: 0, best: null }
  var info = null

  function el(tag, className, text) { return kit.el(tag, className, text) }
  function fmt(n) { return kit.fmt(n) }

  function rockSvg() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 200 180")
    svg.setAttribute("class", "jm-rock-art")
    // Roca facetada con vetas que brillan (decorativas: no dicen lo que hay dentro).
    svg.innerHTML = '<defs><linearGradient id="jm-stone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b8178"/><stop offset=".55" stop-color="#57514b"/><stop offset="1" stop-color="#2a2622"/></linearGradient></defs>' +
      '<path d="M20 120 34 58 78 20h52l42 30 16 58-22 52-62 14-58-16z" fill="url(#jm-stone)" stroke="#1c1917" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M78 20 92 64 34 58M92 64l38-44M92 64l80-14M92 64l-4 56-68 0M88 120l100-12M88 120l20 54M88 120 46 166" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>' +
      '<path d="M50 96l22 6M134 74l18 12M118 136l26-8" stroke-width="3" stroke-linecap="round" class="jm-vein"/>' +
      '<g class="jm-cracks" fill="none" stroke="#0c0a09" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">' +
      CRACKS.map(function (d) { return '<path d="' + d + '" pathLength="1"/>' }).join("") + "</g>"
    return svg
  }

  function newRock(animated) {
    var max = HITS[0] + Math.floor(Math.random() * (HITS[1] - HITS[0] + 1))
    rock = { hp: max, max: max, startedAt: Date.now(), done: false }
    ui.rockBox.textContent = ""
    var node = el("div", "jm-rock")
    node.appendChild(rockSvg())
    node.style.setProperty("--vein", ["#fbbf24", "#67e8f9", "#34d399", "#e2e8f0"][Math.floor(Math.random() * 4)])
    node.tabIndex = 0
    node.setAttribute("role", "button")
    node.setAttribute("aria-label", "Roca. Haz clic o pulsa Espacio para picar.")
    node.addEventListener("pointerdown", function (event) { event.preventDefault(); hit(event) })
    node.addEventListener("keydown", function (event) {
      if (event.key === " " || event.key === "Enter") { event.preventDefault(); hit(null) }
    })
    ui.rockBox.appendChild(node)
    ui.rock = node
    paintHp()
    if (animated && !kit.reducedMotion) {
      node.animate([
        { transform: "translateY(-420px) rotate(-8deg)" },
        { transform: "translateY(0) rotate(0deg)", offset: 0.6 },
        { transform: "translateY(-26px) rotate(2deg)", offset: 0.78 },
        { transform: "translateY(0) rotate(0deg)" },
      ], { duration: 640, easing: "cubic-bezier(.5, 0, .5, 1)" })
      setTimeout(function () { kit.sound("thud"); kit.restart(ui.stage, "fx-shake"); dust(kit.centerOf(node), 10, true) }, 380)
    }
    if (document.activeElement === document.body || ui.stage.contains(document.activeElement)) node.focus({ preventScroll: true })
    if (!task) ensureTask()
  }

  function paintHp() {
    ui.pips.textContent = ""
    for (var i = 0; i < rock.max; i++) ui.pips.appendChild(el("span", "jm-pip" + (i < rock.max - rock.hp ? " is-done" : "")))
    var broken = 1 - rock.hp / rock.max
    Array.prototype.forEach.call(ui.rock.querySelectorAll(".jm-cracks path"), function (path, i) {
      var reveal = Math.max(0, Math.min(1, broken * CRACKS.length * 1.15 - i))
      path.style.strokeDashoffset = String(1 - reveal)
    })
  }

  // ── Golpe ───────────────────────────────────────────────────────────────────
  function hit(event) {
    if (!rock || rock.done || busy) return
    var now = performance.now()
    if (now - lastSwing < SWING_MS) return
    lastSwing = now
    var rect = ui.rock.getBoundingClientRect()
    var point = event && event.clientX ? { x: event.clientX, y: event.clientY } : { x: rect.left + rect.width * (0.3 + Math.random() * 0.4), y: rect.top + rect.height * (0.3 + Math.random() * 0.4) }
    rock.hp -= 1
    var power = 1 - rock.hp / rock.max
    swing(point)
    kit.sound("pick", { power: power })
    kit.haptic(14 + Math.round(power * 20))
    kit.sparks(point, Math.random() < 0.5 ? "#fde68a" : "#fff7cc", 8 + Math.round(power * 10))
    dust(point, 4, false)
    chips(point, 3 + Math.round(power * 3))
    kit.restart(ui.rock, "is-hit")
    paintHp()
    if (rock.hp <= 0) split()
  }

  // El pico baja hasta el punto del golpe.
  function swing(point) {
    var box = ui.scene.getBoundingClientRect()
    ui.pick.style.setProperty("--hx", (point.x - box.left) + "px")
    ui.pick.style.setProperty("--hy", (point.y - box.top) + "px")
    kit.restart(ui.pick, "is-swing")
  }

  function dust(point, count, wide) {
    if (kit.reducedMotion || !point) return
    var box = ui.scene.getBoundingClientRect()
    for (var i = 0; i < count; i++) {
      var puff = el("span", "jm-dust")
      puff.style.left = (point.x - box.left) + "px"
      puff.style.top = (point.y - box.top) + "px"
      puff.style.setProperty("--dx", ((Math.random() - 0.5) * (wide ? 260 : 90)).toFixed(0) + "px")
      puff.style.setProperty("--dy", (-20 - Math.random() * 50).toFixed(0) + "px")
      puff.style.setProperty("--s", (16 + Math.random() * 26).toFixed(0) + "px")
      ui.scene.appendChild(puff)
      setTimeout(function (node) { return function () { node.remove() } }(puff), 1200)
    }
  }

  function chips(point, count) {
    if (kit.reducedMotion) return
    var box = ui.scene.getBoundingClientRect()
    for (var i = 0; i < count; i++) {
      var chip = el("span", "jm-chip")
      chip.style.left = (point.x - box.left) + "px"
      chip.style.top = (point.y - box.top) + "px"
      ui.scene.appendChild(chip)
      var angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4
      var speed = 60 + Math.random() * 90
      chip.animate([
        { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
        { transform: "translate(" + Math.cos(angle) * speed + "px, " + (Math.sin(angle) * speed * 0.6 - 30) + "px) rotate(" + (Math.random() * 360) + "deg)", opacity: 1, offset: 0.45 },
        { transform: "translate(" + Math.cos(angle) * speed * 1.5 + "px, " + (120 + Math.random() * 40) + "px) rotate(" + (Math.random() * 720) + "deg)", opacity: 0 },
      ], { duration: 700 + Math.random() * 300, easing: "cubic-bezier(.25, .6, .5, 1)", fill: "forwards" })
      setTimeout(function (node) { return function () { node.remove() } }(chip), 1100)
    }
  }

  // ── La roca se parte ────────────────────────────────────────────────────────
  function split() {
    rock.done = true
    busy = true
    var origin = kit.centerOf(ui.rock)
    var halves = ["is-left", "is-right"].map(function (side) {
      var half = ui.rock.cloneNode(true)
      half.className = "jm-rock jm-half " + side
      half.removeAttribute("tabindex")
      half.removeAttribute("role")
      half.setAttribute("aria-hidden", "true")
      ui.rockBox.appendChild(half)
      return half
    })
    ui.rock.classList.add("is-gone")
    kit.sound("crumble")
    kit.restart(ui.stage, "fx-shake")
    dust(origin, 14, true)
    chips(origin, 10)
    kit.haptic([30, 20, 60])
    ui.glow.className = "jm-glow is-on"
    ui.pips.textContent = ""
    var wait = Math.max(0, MIN_WORK_MS - (Date.now() - rock.startedAt))
    setTimeout(function () { deliver(halves) }, wait)
  }

  function deliver(halves) {
    if (!task) { ensureTask().then(function () { setTimeout(function () { deliver(halves) }, MIN_WORK_MS) }).catch(function () { busy = false }); return }
    job.finish(task, true).then(function (result) {
      task = result.next || null
      reveal(result)
      kit.afterPlay(result, { quiet: true })
      setTimeout(function () {
        halves.forEach(function (half) { half.remove() })
        busy = false
        newRock(true)
      }, NEXT_ROCK_MS + (result.outcome.big ? 900 : 0))
    }).catch(function (error) {
      if (error.reason === "no-task") { task = null; return deliver(halves) }
      window.CanjeApp.toast(error.message)
      setTimeout(function () { deliver(halves) }, 2500)
    })
  }

  function reveal(result) {
    var id = result.outcome.id
    var color = FIND_COLORS[id] || "#fde68a"
    var gem = el("div", "jm-find is-" + id + (result.outcome.big ? " is-big" : ""))
    gem.style.setProperty("--c", color)
    gem.appendChild(el("span", "jm-rays"))
    var art = el("span", "jm-find-art")
    art.innerHTML = FIND_ART[id] || FIND_ART.piedra
    gem.appendChild(art)
    gem.appendChild(el("strong", "jm-find-name", result.outcome.label))
    gem.appendChild(el("span", "jm-find-pay", job.money(result.delta)))
    ui.rockBox.appendChild(gem)
    var origin = kit.centerOf(gem)
    stats.rocks += 1
    stats.net += result.delta
    if (!stats.best || result.delta > stats.best.pay) stats.best = { label: result.outcome.label, pay: result.delta }
    ui.stats.set("rocks", stats.rocks)
    ui.stats.set("net", stats.net, "win")
    ui.stats.set("best", stats.best.label)
    ui.history.add(result.outcome.label + " · " + job.money(result.delta), result.delta >= 2000 ? "win" : "")
    if (id === "diamante") { kit.celebrate("jackpot", color, origin); kit.flash(color) }
    else if (result.outcome.big) kit.celebrate("big", color, origin)
    else if (result.delta >= 1000) { kit.sound("chime", { rarity: id === "oro" ? "epico" : "raro" }); kit.sparks(origin, color, 16) }
    else kit.sound("chime", { rarity: "comun" })
    kit.floatText(origin, job.money(result.delta), color)
    ui.result.className = "g-result" + (result.delta >= 2000 ? " is-win" : "")
    ui.result.textContent = ""
    ui.result.appendChild(el("strong", "", result.outcome.label))
    ui.result.appendChild(el("span", "", "Has ganado " + fmt(result.delta) + " pts."))
    setTimeout(function () { ui.glow.className = "jm-glow" }, 900)
  }

  function ensureTask() {
    if (task) return Promise.resolve(task)
    return job.start("mine").then(function (next) {
      task = next
      if (rock) rock.startedAt = Date.now()
      return task
    }).catch(function (error) { window.CanjeApp.toast(error.message); throw error })
  }

  function paintPays() {
    if (!info || !ui) return
    if (ui.pays) ui.pays.remove()
    ui.pays = job.payTable(ui.side, "Qué puede salir", info.finds)
  }

  // ── Construccion ────────────────────────────────────────────────────────────
  function build(section) {
    var parts = kit.layout(section, { id: "mine", kicker: "Trabajo", feed: "trabajo", title: "Mina", hint: "Gratis y sin esperas. Pica la roca hasta partirla y quédate con lo que haya dentro: piedra, metales o, con suerte, un diamante." })
    ui = { stage: parts.stage, side: parts.side }
    var scene = el("div", "jm-scene")
    scene.appendChild(el("span", "jm-wall"))
    ;["is-left", "is-right"].forEach(function (side) {
      var torch = el("span", "jm-torch " + side)
      torch.appendChild(el("span", "jm-flame"))
      scene.appendChild(torch)
    })
    scene.appendChild(el("span", "jm-floor"))
    var glow = el("span", "jm-glow")
    scene.appendChild(glow)
    var rockBox = el("div", "jm-rockbox")
    scene.appendChild(rockBox)
    var pick = el("span", "jm-pick")
    pick.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M60 52 104 112" stroke="#7c4a1e" stroke-width="9" stroke-linecap="round"/><path d="M60 52 104 112" stroke="#a16207" stroke-width="3" stroke-linecap="round" opacity=".6"/><path d="M14 30C34 12 70 8 98 22 74 22 52 30 36 46z" fill="#cbd5e1" stroke="#334155" stroke-width="3" stroke-linejoin="round"/><path d="M24 30C40 20 62 16 82 20" stroke="#fff" stroke-width="2" fill="none" opacity=".7"/></svg>'
    scene.appendChild(pick)
    var pips = el("div", "jm-pips")
    scene.appendChild(pips)
    parts.stage.appendChild(scene)
    parts.stage.appendChild(el("p", "jd-hint", "Haz clic en la roca (o pulsa Espacio) para picar."))
    Object.assign(ui, { scene: scene, rockBox: rockBox, pick: pick, pips: pips, glow: glow })
    ui.result = el("div", "g-result is-hidden")
    parts.side.appendChild(ui.result)
    ui.stats = job.panel(parts.side, [{ id: "rocks", label: "Rocas" }, { id: "net", label: "Ganado" }, { id: "best", label: "Lo mejor" }])
    ui.stats.set("best", "-")
    ui.history = job.history(parts.side, "Tus últimos hallazgos", "Todavía no has partido ninguna roca.")
    kit.jobsInfo().then(function (all) { info = all.mine; paintPays() }).catch(function () {})
    newRock(false)
  }

  kit.register("mine", {
    build: build,
    show: function () { ensureTask().catch(function () {}) },
    hide: function () {},
  })
})()
