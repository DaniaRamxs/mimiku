// Efectos de la cinematica del gachapon: particulas en un <canvas> y los
// sonidos (via SoundKit). El bucle de dibujo solo corre mientras quedan
// particulas vivas. Lo usa gacha-cinematic.js.
(function () {
  "use strict"

  var GRAVITY = 900 // px/s²
  var MAX_PARTICLES = 700

  // ── Particulas ──────────────────────────────────────────────────────────────
  function createParticles(canvas) {
    var ctx = canvas.getContext("2d")
    var particles = []
    var running = false
    var last = 0
    var width = 0
    var height = 0

    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    function spawn(base) {
      if (particles.length >= MAX_PARTICLES) particles.shift()
      particles.push(base)
      if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick) }
    }

    function pick(list) { return list[Math.floor(Math.random() * list.length)] }

    // Explosion radial desde (x, y).
    function burst(x, y, options) {
      var o = options || {}
      var count = o.count || 60
      for (var i = 0; i < count; i++) {
        var angle = Math.random() * Math.PI * 2
        var speed = (o.speed || 520) * (0.35 + Math.random() * 0.75)
        spawn({
          x: x, y: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (o.lift || 120),
          life: 0, max: (o.life || 1.4) * (0.6 + Math.random() * 0.6), size: (o.size || 4) * (0.5 + Math.random()),
          color: pick(o.colors || ["#fff"]), shape: o.shape || pick(["dot", "star", "rect"]),
          spin: (Math.random() - 0.5) * 14, rot: Math.random() * 6, gravity: o.gravity === undefined ? 1 : o.gravity, drag: o.drag || 0.9,
        })
      }
    }

    // Lluvia desde arriba (confeti dorado del legendario).
    function rain(options) {
      var o = options || {}
      for (var i = 0; i < (o.count || 80); i++) {
        spawn({
          x: Math.random() * width, y: -20 - Math.random() * height * 0.6, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 140,
          life: 0, max: o.life || 3.6, size: (o.size || 5) * (0.6 + Math.random() * 0.8), color: pick(o.colors || ["#fde68a"]),
          shape: o.shape || "rect", spin: (Math.random() - 0.5) * 10, rot: Math.random() * 6, gravity: 0.12, drag: 0.99, sway: Math.random() * 6,
        })
      }
    }

    // Chispas que suben despacio alrededor de un punto (ambiente tras revelar).
    function embers(x, y, options) {
      var o = options || {}
      for (var i = 0; i < (o.count || 24); i++) {
        spawn({
          x: x + (Math.random() - 0.5) * (o.spread || 260), y: y + (Math.random() - 0.3) * (o.spread || 260) * 0.6,
          vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 70, life: 0, max: 1.6 + Math.random() * 1.6,
          size: 1.5 + Math.random() * 2.5, color: pick(o.colors || ["#fff"]), shape: "dot", spin: 0, rot: 0, gravity: -0.02, drag: 0.98,
        })
      }
    }

    function drawStar(p, r) {
      ctx.beginPath()
      for (var i = 0; i < 8; i++) {
        var radius = i % 2 ? r * 0.35 : r
        var a = p.rot + i * Math.PI / 4
        ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius)
      }
      ctx.closePath()
      ctx.fill()
    }

    function tick(time) {
      var dt = Math.min(0.05, (time - last) / 1000)
      last = time
      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = "lighter"
      particles = particles.filter(function (p) {
        p.life += dt
        if (p.life >= p.max) return false
        p.vx *= Math.pow(p.drag, dt * 60)
        p.vy = p.vy * Math.pow(p.drag, dt * 60) + GRAVITY * p.gravity * dt
        p.x += (p.vx + (p.sway ? Math.sin(p.life * 3 + p.sway) * 40 : 0)) * dt
        p.y += p.vy * dt
        p.rot += p.spin * dt
        var fade = 1 - p.life / p.max
        ctx.globalAlpha = Math.max(0, Math.min(1, fade * 1.6))
        ctx.fillStyle = p.color
        ctx.save()
        ctx.translate(p.x, p.y)
        if (p.shape === "star") drawStar(p, p.size * 1.8)
        else if (p.shape === "rect") { ctx.rotate(p.rot); ctx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9) }
        else { ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill() }
        ctx.restore()
        return p.y < height + 60
      })
      ctx.globalAlpha = 1
      if (particles.length) requestAnimationFrame(tick)
      else { running = false; ctx.clearRect(0, 0, width, height) }
    }

    function clear() { particles = []; ctx.clearRect(0, 0, width, height) }

    window.addEventListener("resize", resize)
    resize()
    return { burst: burst, rain: rain, embers: embers, clear: clear, resize: resize }
  }

  // ── Sonido ──────────────────────────────────────────────────────────────────
  // Los sonidos los sintetiza SoundKit (sound-kit.js), con el mismo volumen y
  // silencio que los minijuegos.
  function createAudio() {
    var kit = window.SoundKit
    function play(name, options) { return function () { kit.play(name, options) } }
    return {
      crank: play("crank"),
      drop: play("drop"),
      rattle: function (seconds) { kit.play("rattle", { dur: seconds }) },
      riser: function (seconds) { kit.play("riser", { dur: seconds }) },
      upgrade: play("upgrade"),
      burst: function () { kit.play("burst"); kit.haptic([40, 30, 80]) },
      chime: function (rarity) { kit.play("chime", { rarity: rarity }) },
      flip: play("flip"),
      isMuted: kit.isMuted,
      setMuted: kit.setMuted,
    }
  }

  window.GachaFx = { createParticles: createParticles, audio: createAudio() }
})()
