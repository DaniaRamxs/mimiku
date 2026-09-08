const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

// CSS para confeti y arcoíris
const visualCSS = `
/* ── Confeti ── */
#confetti-canvas {
  position:fixed;inset:0;z-index:9996;pointer-events:none;
  opacity:0;transition:opacity .3s;
}
#confetti-canvas.show { opacity:1; }

/* ── Arcoíris ── */
#rainbow-overlay {
  position:fixed;top:0;left:0;right:0;height:8px;z-index:9996;
  background:linear-gradient(90deg,#ff0000,#ff7700,#ffff00,#00ff00,#0000ff,#8b00ff);
  opacity:0;pointer-events:none;
  box-shadow:0 0 30px rgba(255,255,255,.3);
  transition:opacity .5s;
}
#rainbow-overlay.show { opacity:1; animation:rainbow-pulse 2s ease-in-out infinite; }
#rainbow-arc {
  position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
  width:800px;height:400px;z-index:9995;pointer-events:none;
  opacity:0;transition:opacity .5s;border-radius:400px 400px 0 0;
  border:12px solid transparent;
  border-image:linear-gradient(90deg,#ff0000,#ff7700,#ffff00,#00ff00,#0000ff,#8b00ff) 1;
}
@keyframes rainbow-pulse { 0%,100%{opacity:1} 50%{opacity:.7} }
`

c = c.replace('/* ── Rey del Chat ── */', visualCSS + '\n/* ── Rey del Chat ── */')

// HTML para confeti y arcoíris
const visualHTML = `
<!-- Confeti canvas -->
<canvas id="confetti-canvas"></canvas>
<!-- Arcoíris -->
<div id="rainbow-overlay"></div>

`
c = c.replace('<!-- Rey del Chat -->', visualHTML + '<!-- Rey del Chat -->')

// Handlers en ws.onmessage
c = c.replace(
  '  if (m.type === "king_toggle")     toggleKing(m.visible);',
  `  if (m.type === "king_toggle")     toggleKing(m.visible);
  if (m.type === "confetti")         launchConfetti(m.duration || 5000);
  if (m.type === "rainbow")          showRainbow(m.duration || 5000);`
)

// Funciones JS
const visualJS = `
// ── Confeti ───────────────────────────────────────────────────────────────────
var confettiCanvas  = document.getElementById("confetti-canvas")
var confettiCtx     = confettiCanvas.getContext("2d")
var confettiPieces  = []
var confettiTimer   = null
var confettiRunning = false

confettiCanvas.width  = window.innerWidth
confettiCanvas.height = window.innerHeight
window.addEventListener("resize", function() {
  confettiCanvas.width  = window.innerWidth
  confettiCanvas.height = window.innerHeight
})

var CONFETTI_COLORS = ["#ff4d6d","#ffd166","#06d6a0","#118ab2","#7c6ef5","#ff6b6b","#ffa62b","#c77dff"]

function createConfettiPiece() {
  return {
    x:      Math.random() * confettiCanvas.width,
    y:      -10,
    w:      Math.random() * 10 + 5,
    h:      Math.random() * 6 + 4,
    color:  CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    speed:  Math.random() * 3 + 2,
    angle:  Math.random() * Math.PI * 2,
    spin:   (Math.random() - 0.5) * 0.2,
    drift:  (Math.random() - 0.5) * 1.5,
  }
}

function drawConfetti() {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height)
  confettiPieces.forEach(function(p) {
    confettiCtx.save()
    confettiCtx.translate(p.x, p.y)
    confettiCtx.rotate(p.angle)
    confettiCtx.fillStyle = p.color
    confettiCtx.fillRect(-p.w/2, -p.h/2, p.w, p.h)
    confettiCtx.restore()
    p.y     += p.speed
    p.x     += p.drift
    p.angle += p.spin
    if (p.y > confettiCanvas.height + 20) {
      p.y = -10
      p.x = Math.random() * confettiCanvas.width
    }
  })
  if (confettiRunning) requestAnimationFrame(drawConfetti)
}

function launchConfetti(duration) {
  confettiCanvas.classList.add("show")
  confettiRunning = true
  confettiPieces = []
  for (var i = 0; i < 120; i++) confettiPieces.push(createConfettiPiece())
  drawConfetti()
  clearTimeout(confettiTimer)
  confettiTimer = setTimeout(function() {
    confettiRunning = false
    confettiCanvas.classList.remove("show")
    confettiPieces = []
  }, duration)
}

// ── Arcoíris ──────────────────────────────────────────────────────────────────
var rainbowTimer = null
function showRainbow(duration) {
  var el = document.getElementById("rainbow-overlay")
  el.classList.add("show")
  clearTimeout(rainbowTimer)
  rainbowTimer = setTimeout(function() { el.classList.remove("show") }, duration)
}

`

c = c.replace('// ── Cara o Cruz ────────────────────────────────────────────────────────────────', visualJS + '// ── Cara o Cruz ────────────────────────────────────────────────────────────────')

fs.writeFileSync('src/services/overlay.html', c)
console.log('confetti:', c.includes('launchConfetti'))
console.log('rainbow:', c.includes('showRainbow'))
