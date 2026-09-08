const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

// CSS del Rey del Chat
const kingCSS = `
/* ── Rey del Chat ── */
#king-overlay{
  position:fixed;bottom:52px;right:16px;
  z-index:9991;opacity:0;pointer-events:none;
  transition:opacity .4s,transform .4s;
  transform:translateX(20px);
}
#king-overlay.show{opacity:1;transform:translateX(0);}
.king-card{
  background:rgba(10,10,15,.92);border:1px solid rgba(245,158,11,.4);
  border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:10px;
  box-shadow:0 0 20px rgba(245,158,11,.15);min-width:200px;
}
.king-crown{font-size:20px;animation:crown-bounce .8s ease-in-out infinite;}
@keyframes crown-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.king-info{flex:1;min-width:0;}
.king-label{font-size:9px;font-weight:700;color:rgba(245,158,11,.8);text-transform:uppercase;letter-spacing:.08em;}
.king-name{font-size:14px;font-weight:700;color:#fafafa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.king-msgs{font-size:11px;color:#a1a1aa;margin-top:1px;}
.king-badge{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;flex-shrink:0;}
`

c = c.replace('/* ── Boss overlay ── */', kingCSS + '\n/* ── Boss overlay ── */')

// HTML del Rey del Chat
const kingHTML = `
<!-- Rey del Chat -->
<div id="king-overlay">
  <div class="king-card">
    <span class="king-crown">👑</span>
    <div class="king-info">
      <div class="king-label">Rey del Chat</div>
      <div class="king-name" id="king-name">—</div>
      <div class="king-msgs" id="king-msgs">0 mensajes</div>
    </div>
    <div class="king-badge" id="king-badge">#1</div>
  </div>
</div>

`

c = c.replace('<!-- Boss overlay -->', kingHTML + '<!-- Boss overlay -->')

// Handler en ws.onmessage
c = c.replace(
  '  if (m.type === "game_event")     handleGameEvent(m);',
  '  if (m.type === "game_event")     handleGameEvent(m);\n  if (m.type === "king_update")     updateKing(m);\n  if (m.type === "king_toggle")     toggleKing(m.visible);'
)

// Función updateKing y toggleKing
const kingJS = `
// ── Rey del Chat ──────────────────────────────────────────────────────────────
function updateKing(m) {
  if (!m.username) return
  document.getElementById("king-name").textContent = m.display || m.username
  document.getElementById("king-msgs").textContent = m.messages + " mensajes en stream"
  document.getElementById("king-overlay").classList.add("show")
}

function toggleKing(visible) {
  var overlay = document.getElementById("king-overlay")
  if (visible) overlay.classList.add("show")
  else overlay.classList.remove("show")
}

`

c = c.replace('// ── Game events ─────────────────────────────────────────────────────────────', kingJS + '// ── Game events ─────────────────────────────────────────────────────────────')

fs.writeFileSync('src/services/overlay.html', c)
console.log('king overlay added:', c.includes('updateKing'))
