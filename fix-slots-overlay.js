const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

// Agregar CSS de slots
const slotsCSS = `
/* ── Slots overlay ── */
#slots-overlay{
  position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
  z-index:9993;opacity:0;pointer-events:none;
  transition:opacity .3s;text-align:center;
}
#slots-overlay.show{opacity:1;}
#slots-reels{
  display:flex;gap:8px;justify-content:center;margin-bottom:16px;
}
.slots-reel{
  width:90px;height:90px;background:rgba(10,10,15,.95);
  border:2px solid rgba(124,110,245,.5);border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  font-size:48px;
  animation:reel-spin .6s ease-out both;
}
.slots-reel:nth-child(2){animation-delay:.15s;}
.slots-reel:nth-child(3){animation-delay:.3s;}
@keyframes reel-spin{
  0%  {transform:translateY(-40px);opacity:0}
  60% {transform:translateY(6px)}
  100%{transform:translateY(0);opacity:1}
}
#slots-result-label{
  font-size:42px;font-weight:900;letter-spacing:-.02em;
  animation:bj-pop .4s .5s cubic-bezier(.17,.67,.35,1.4) both;
}
#slots-result-msg{
  font-size:16px;color:rgba(232,232,240,.7);margin-top:8px;
  animation:bj-pop .3s .6s ease both;
}
`

c = c.replace('/* ── BJ overlay ── */', slotsCSS + '\n/* ── BJ overlay ── */')

// Agregar HTML de slots antes del bj-overlay
const slotsHTML = `
<!-- Slots overlay -->
<div id="slots-overlay">
  <div id="slots-reels">
    <div class="slots-reel" id="slots-r1"></div>
    <div class="slots-reel" id="slots-r2"></div>
    <div class="slots-reel" id="slots-r3"></div>
  </div>
  <div id="slots-result-label"></div>
  <div id="slots-result-msg"></div>
</div>

`
c = c.replace('<!-- BJ overlay -->', slotsHTML + '<!-- BJ overlay -->')

// Agregar handler en ws.onmessage
c = c.replace(
  '  if (m.type === "game_bj")       showBjResult(m);',
  '  if (m.type === "game_bj")       showBjResult(m);\n  if (m.type === "game_slots")    showSlotsResult(m);'
)

// Agregar función showSlotsResult antes de showBjResult
const slotsFn = `
// ── Slots ─────────────────────────────────────────────────────────────────────
var slotsTimer;
function showSlotsResult(m) {
  var overlay  = document.getElementById("slots-overlay");
  var r1 = document.getElementById("slots-r1");
  var r2 = document.getElementById("slots-r2");
  var r3 = document.getElementById("slots-r3");
  var labelEl  = document.getElementById("slots-result-label");
  var msgEl    = document.getElementById("slots-result-msg");

  // reset animaciones
  r1.style.animation = "none"; r2.style.animation = "none"; r3.style.animation = "none";
  labelEl.style.animation = "none"; msgEl.style.animation = "none";
  void overlay.offsetWidth;

  r1.textContent = m.s1; r2.textContent = m.s2; r3.textContent = m.s3;
  r1.style.animation = "reel-spin .6s ease-out both";
  r2.style.animation = "reel-spin .6s .15s ease-out both";
  r3.style.animation = "reel-spin .6s .3s ease-out both";

  var colors = { jackpot:"#7c6ef5", par:"#22c55e", miss:"#ef4444" };
  labelEl.style.color = colors[m.result] || "#e8e8f0";
  labelEl.style.animation = "bj-pop .4s .5s cubic-bezier(.17,.67,.35,1.4) both";
  msgEl.style.animation   = "bj-pop .3s .6s ease both";

  if (m.result === "jackpot") {
    labelEl.textContent = "🎰 JACKPOT! " + m.multiplier + "x";
  } else if (m.result === "par") {
    labelEl.textContent = "¡PAR! 2x";
  } else {
    labelEl.textContent = "Sin suerte...";
  }
  msgEl.textContent = m.username + " — " + (m.result !== "miss" ? "+" + m.payout + " pts" : "-" + m.bet + " pts");

  overlay.classList.add("show");
  clearTimeout(slotsTimer);
  slotsTimer = setTimeout(function() { overlay.classList.remove("show"); }, 4000);
}

`
c = c.replace('// ── Blackjack ────', slotsFn + '// ── Blackjack ────')

fs.writeFileSync('src/services/overlay.html', c)
console.log('slots overlay:', c.includes('showSlotsResult'))
console.log('slots css:',     c.includes('reel-spin'))
console.log('slots html:',    c.includes('slots-r1'))
