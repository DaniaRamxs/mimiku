const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

// Reemplazar showRainbow con versión más simple y robusta
c = c.replace(
  `function showRainbow(duration) {
  var el = document.getElementById("rainbow-overlay")
  if (!el) return
  el.style.opacity = "1"
  el.style.animation = "rainbow-pulse 2s ease-in-out infinite"
  clearTimeout(rainbowTimer)
  rainbowTimer = setTimeout(function() {
    el.style.opacity = "0"
    el.style.animation = ""
  }, duration || 5000)
}`,
  `function showRainbow(duration) {
  // crear arco dinámicamente si no existe
  var existing = document.getElementById("rainbow-arc-dynamic")
  if (existing) existing.remove()

  var arc = document.createElement("div")
  arc.id = "rainbow-arc-dynamic"
  arc.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "height:16px",
    "z-index:9996",
    "pointer-events:none",
    "background:linear-gradient(90deg,#ff0000,#ff7700,#ffff00,#00ff00,#00bfff,#8b00ff)",
    "opacity:1",
    "box-shadow:0 0 40px 8px rgba(255,255,255,0.4)",
    "transition:opacity 0.5s"
  ].join(";")

  document.body.appendChild(arc)

  // también arco curvo en el centro
  var arc2 = document.createElement("div")
  arc2.id = "rainbow-arc-dynamic2"
  arc2.style.cssText = [
    "position:fixed",
    "top:30%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "width:700px",
    "height:350px",
    "border-radius:350px 350px 0 0",
    "border-top:16px solid transparent",
    "border-left:16px solid transparent",
    "border-right:16px solid transparent",
    "z-index:9995",
    "pointer-events:none",
    "opacity:0.7",
    "background:transparent",
    "box-shadow:0 -8px 0 8px violet,0 -24px 0 16px indigo,0 -40px 0 24px blue,0 -56px 0 32px green,0 -72px 0 40px yellow,0 -88px 0 48px orange,0 -104px 0 56px red"
  ].join(";")
  document.body.appendChild(arc2)

  clearTimeout(rainbowTimer)
  rainbowTimer = setTimeout(function() {
    var a = document.getElementById("rainbow-arc-dynamic")
    var b = document.getElementById("rainbow-arc-dynamic2")
    if (a) { a.style.opacity = "0"; setTimeout(function(){ a.remove() }, 500) }
    if (b) { b.style.opacity = "0"; setTimeout(function(){ b.remove() }, 500) }
  }, duration || 5000)
}`
)

fs.writeFileSync('src/services/overlay.html', c)
console.log('rainbow fixed:', c.includes('rainbow-arc-dynamic'))
