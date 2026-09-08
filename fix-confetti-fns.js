const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

const confettiRainbowFns = `
// ── Confeti ───────────────────────────────────────────────────────────────────
var confettiCanvas  = document.getElementById("confetti-canvas")
var confettiCtx     = confettiCanvas ? confettiCanvas.getContext("2d") : null
var confettiPieces  = []
var confettiTimer   = null
var confettiRunning = false
var CONFETTI_COLORS = ["#ff4d6d","#ffd166","#06d6a0","#118ab2","#7c6ef5","#ff6b6b","#ffa62b","#c77dff"]

if (confettiCanvas) {
  confettiCanvas.width  = window.innerWidth
  confettiCanvas.height = window.innerHeight
  window.addEventListener("resize", function() {
    confettiCanvas.width  = window.innerWidth
    confettiCanvas.height = window.innerHeight
  })
}

function createConfettiPiece() {
  return {
    x: Math.random() * (confettiCanvas ? confettiCanvas.width : 1920),
    y: -10,
    w: Math.random() * 10 + 5,
    h: Math.random() * 6 + 4,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    speed: Math.random() * 3 + 2,
    angle: Math.random() * Math.PI * 2,
    spin:  (Math.random() - 0.5) * 0.2,
    drift: (Math.random() - 0.5) * 1.5,
  }
}

function drawConfetti() {
  if (!confettiCtx || !confettiCanvas) return
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height)
  confettiPieces.forEach(function(p) {
    confettiCtx.save()
    confettiCtx.translate(p.x, p.y)
    confettiCtx.rotate(p.angle)
    confettiCtx.fillStyle = p.color
    confettiCtx.fillRect(-p.w/2, -p.h/2, p.w, p.h)
    confettiCtx.restore()
    p.y += p.speed; p.x += p.drift; p.angle += p.spin
    if (p.y > (confettiCanvas.height + 20)) {
      p.y = -10
      p.x = Math.random() * confettiCanvas.width
    }
  })
  if (confettiRunning) requestAnimationFrame(drawConfetti)
}

function launchConfetti(duration) {
  if (!confettiCanvas) return
  confettiCanvas.style.opacity = "1"
  confettiCanvas.style.pointerEvents = "none"
  confettiRunning = true
  confettiPieces = []
  for (var i = 0; i < 120; i++) confettiPieces.push(createConfettiPiece())
  drawConfetti()
  clearTimeout(confettiTimer)
  confettiTimer = setTimeout(function() {
    confettiRunning = false
    if (confettiCanvas) confettiCanvas.style.opacity = "0"
    confettiPieces = []
  }, duration || 6000)
}

// ── Arcoíris ──────────────────────────────────────────────────────────────────
var rainbowTimer = null
function showRainbow(duration) {
  var el = document.getElementById("rainbow-overlay")
  if (!el) return
  el.style.opacity = "1"
  el.style.animation = "rainbow-pulse 2s ease-in-out infinite"
  clearTimeout(rainbowTimer)
  rainbowTimer = setTimeout(function() {
    el.style.opacity = "0"
    el.style.animation = ""
  }, duration || 5000)
}

`

// Insertar antes de </script>
c = c.replace('</script>\n</body>', confettiRainbowFns + '</script>\n</body>')

// Asegurar que el canvas y rainbow div existen en el HTML
if (!c.includes('confetti-canvas')) {
  c = c.replace('<div id="widgets-layer">', `<canvas id="confetti-canvas" style="position:fixed;inset:0;z-index:9996;pointer-events:none;opacity:0;transition:opacity .3s"></canvas>
<div id="rainbow-overlay" style="position:fixed;top:0;left:0;right:0;height:10px;z-index:9996;background:linear-gradient(90deg,#ff0000,#ff7700,#ffff00,#00ff00,#0000ff,#8b00ff);opacity:0;pointer-events:none;box-shadow:0 0 30px rgba(255,255,255,.3)"></div>
<div id="widgets-layer">`)
  console.log('canvas and rainbow div added')
}

fs.writeFileSync('src/services/overlay.html', c)
console.log('launchConfetti function added:', c.includes('function launchConfetti'))
console.log('showRainbow function added:', c.includes('function showRainbow'))
