const fs = require('fs')
let c = fs.readFileSync('src/services/overlay-server.js', 'utf8')

// Insertar showGameEvent antes de removeWidget
const target = 'function removeWidget(id) {'
const idx = c.indexOf(target)
if (idx === -1) { console.log('target not found'); process.exit(1) }

const fn = `// ── Game events ──────────────────────────────────────────────────────────────
const gameBox = document.createElement('div')
gameBox.id = 'game-event-box'
gameBox.style.cssText = 'position:fixed;bottom:48px;left:50%;transform:translateX(-50%) translateY(20px);background:rgba(10,10,15,.92);border:1px solid rgba(124,110,245,.5);border-radius:12px;padding:12px 24px;font-size:16px;font-weight:600;color:#e8e8f0;opacity:0;transition:opacity .3s,transform .3s;pointer-events:none;white-space:nowrap;z-index:9997;text-align:center;'
document.body.appendChild(gameBox)
let gameTimer

function showGameEvent(m) {
  clearTimeout(gameTimer)
  let html = ''
  if (m.type === 'game_roulette') {
    const colorMap = { rojo:'#ef4444', negro:'#e8e8f0', verde:'#22c55e' }
    const bg = colorMap[m.color] || '#e8e8f0'
    const fg = m.color === 'negro' ? '#111' : '#fff'
    html = \`<span style="background:\${bg};color:\${fg};border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;margin-right:8px">\${m.number}</span>\${m.msg}\`
  } else if (m.type === 'game_bj') {
    const icons = { blackjack:'🃏', win:'🏆', lose:'💸', push:'🤝', bust:'💥' }
    html = \`\${icons[m.result] || '🃏'} \${m.msg}\`
  }
  gameBox.innerHTML = html
  gameBox.style.opacity = '1'
  gameBox.style.transform = 'translateX(-50%) translateY(0)'
  gameTimer = setTimeout(() => {
    gameBox.style.opacity = '0'
    gameBox.style.transform = 'translateX(-50%) translateY(20px)'
  }, 5000)
}

`

c = c.substring(0, idx) + fn + c.substring(idx)
fs.writeFileSync('src/services/overlay-server.js', c)
console.log('ok:', c.includes('showGameEvent'))
