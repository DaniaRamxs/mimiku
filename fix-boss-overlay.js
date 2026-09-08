const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

// Agregar CSS del boss overlay
const bossCSS = `
/* ── Boss overlay ── */
#boss-overlay{
  position:fixed;top:60px;left:50%;transform:translateX(-50%);
  z-index:9992;opacity:0;pointer-events:none;
  transition:opacity .4s;width:520px;
}
#boss-overlay.show{opacity:1;}
.boss-card{
  background:rgba(10,10,15,.95);border:2px solid #ef4444;
  border-radius:16px;padding:20px 24px;
  box-shadow:0 0 40px rgba(239,68,68,.3);
}
.boss-header{display:flex;align-items:center;gap:12px;margin-bottom:14px;}
.boss-sprite{font-size:48px;animation:boss-float 2s ease-in-out infinite;}
@keyframes boss-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.boss-title{font-size:20px;font-weight:900;color:#ef4444;text-shadow:0 0 20px rgba(239,68,68,.5);}
.boss-subtitle{font-size:12px;color:#a1a1aa;margin-top:2px;}
.boss-hp-wrap{margin-bottom:10px;}
.boss-hp-label{display:flex;justify-content:space-between;font-size:12px;color:#a1a1aa;margin-bottom:6px;}
.boss-hp-bar{height:20px;background:rgba(255,255,255,.1);border-radius:10px;overflow:hidden;border:1px solid rgba(239,68,68,.3);}
.boss-hp-fill{height:100%;background:linear-gradient(90deg,#ef4444,#f97316);border-radius:10px;transition:width .5s ease;position:relative;}
.boss-hp-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.3) 0%,transparent 100%);border-radius:10px;}
.boss-participants{font-size:11px;color:#52525b;text-align:right;}
.boss-hit{animation:boss-hit .3s ease;}
@keyframes boss-hit{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
`

c = c.replace('/* ── Slots overlay ── */', bossCSS + '\n/* ── Slots overlay ── */')

// Agregar HTML del boss overlay
const bossHTML = `
<!-- Boss overlay -->
<div id="boss-overlay">
  <div class="boss-card">
    <div class="boss-header">
      <span class="boss-sprite" id="boss-sprite">👾</span>
      <div>
        <div class="boss-title">¡¡BOSS INVOCADO!!</div>
        <div class="boss-subtitle">Usa !atacar [cantidad] para atacar</div>
      </div>
    </div>
    <div class="boss-hp-wrap">
      <div class="boss-hp-label">
        <span>❤️ HP</span>
        <span id="boss-hp-text">5000 / 5000</span>
      </div>
      <div class="boss-hp-bar">
        <div id="boss-hp-fill" class="boss-hp-fill" style="width:100%"></div>
      </div>
    </div>
    <div class="boss-participants" id="boss-participants">0 héroes atacando</div>
  </div>
</div>

`

c = c.replace('<!-- Slots overlay -->', bossHTML + '<!-- Slots overlay -->')

// Agregar handler de boss en ws.onmessage
c = c.replace(
  '  if (m.type === "game_slots")    showSlotsResult(m);',
  '  if (m.type === "game_slots")    showSlotsResult(m);\n  if (m.type === "game_event")     handleGameEvent(m);'
)

// Agregar función handleGameEvent antes de showSlotsResult
const bossJS = `
// ── Game events ───────────────────────────────────────────────────────────────
function handleGameEvent(m) {
  if (m.event === "boss_spawn") showBossOverlay(m.hp, m.hp, 0)
  if (m.event === "boss_hit")   updateBossOverlay(m.hp, m.maxHp, m.participants)
  if (m.event === "boss_defeat") hideBossOverlay()
  if (m.event === "boss_attack") updateBossOverlay(m.bossHp, m.maxHp, m.participants)
}

var bossHideTimer = null

function showBossOverlay(hp, maxHp, participants) {
  var overlay = document.getElementById("boss-overlay")
  var fill    = document.getElementById("boss-hp-fill")
  var text    = document.getElementById("boss-hp-text")
  var parts   = document.getElementById("boss-participants")
  if (!overlay) return
  fill.style.width = "100%"
  text.textContent = maxHp + " / " + maxHp
  parts.textContent = "0 héroes atacando"
  overlay.classList.add("show")
  clearTimeout(bossHideTimer)
}

function updateBossOverlay(hp, maxHp, participants) {
  var fill  = document.getElementById("boss-hp-fill")
  var text  = document.getElementById("boss-hp-text")
  var parts = document.getElementById("boss-participants")
  var card  = document.querySelector(".boss-card")
  if (!fill) return
  var pct = Math.max(0, Math.round((hp / maxHp) * 100))
  fill.style.width = pct + "%"
  // cambiar color según HP
  if (pct > 60)      fill.style.background = "linear-gradient(90deg,#22c55e,#16a34a)"
  else if (pct > 30) fill.style.background = "linear-gradient(90deg,#f59e0b,#d97706)"
  else               fill.style.background = "linear-gradient(90deg,#ef4444,#dc2626)"
  text.textContent  = hp.toLocaleString() + " / " + maxHp.toLocaleString()
  parts.textContent = participants + " héroe" + (participants !== 1 ? "s" : "") + " atacando"
  // shake
  if (card) { card.classList.add("boss-hit"); setTimeout(function(){ card.classList.remove("boss-hit") }, 300) }
  if (hp <= 0) {
    bossHideTimer = setTimeout(hideBossOverlay, 4000)
    document.querySelector(".boss-title").textContent = "¡¡BOSS DERROTADO!!"
    document.getElementById("boss-sprite").textContent = "💀"
  }
}

function hideBossOverlay() {
  var overlay = document.getElementById("boss-overlay")
  if (overlay) overlay.classList.remove("show")
}

`

c = c.replace('// ── Slots ────────────────────────────────────────────────────────────────────', bossJS + '// ── Slots ────────────────────────────────────────────────────────────────────')

fs.writeFileSync('src/services/overlay.html', c)
console.log('boss overlay added:', c.includes('showBossOverlay'))
