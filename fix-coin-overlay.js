const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

// Handler en ws.onmessage
c = c.replace(
  '  if (m.type === "king_toggle")     toggleKing(m.visible);',
  '  if (m.type === "king_toggle")     toggleKing(m.visible);\n  if (m.type === "game_coin")       showCoinResult(m);'
)

// Función showCoinResult
const coinFn = `
// ── Cara o Cruz ───────────────────────────────────────────────────────────────
var coinTimer
function showCoinResult(m) {
  clearTimeout(gameTimer)
  var icon = m.win ? "🪙" : "🟤"
  var label = m.win ? "¡CARA! GANASTE" : "CRUZ. Perdiste"
  var color = m.win ? "#22c55e" : "#ef4444"
  gameEl.innerHTML =
    "<span style='font-size:22px'>" + icon + "</span>" +
    "<span style='color:" + color + ";font-weight:700'>" + label + "</span>" +
    "<span style='color:#a1a1aa;font-size:13px'>@" + m.username + " " + (m.win ? "+" : "-") + m.amount + " pts</span>"
  gameEl.classList.add("show")
  gameTimer = setTimeout(function() { gameEl.classList.remove("show") }, 4000)
}

`

c = c.replace('// ── Rey del Chat ──────────────────────────────────────────────────────────────', coinFn + '// ── Rey del Chat ──────────────────────────────────────────────────────────────')

fs.writeFileSync('src/services/overlay.html', c)
console.log('coin overlay:', c.includes('showCoinResult'))
