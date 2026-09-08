const fs = require('fs')
let c = fs.readFileSync('src/services/overlay-server.js', 'utf8')

// Encontrar donde está el bloque de game events y reemplazarlo
const gameStart = c.indexOf('// ── Game events')
const gameEnd   = c.indexOf('\nfunction removeWidget', gameStart)

if (gameStart === -1) { console.log('game block not found'); process.exit(1) }

// El bloque actual está en el scope de Node (fuera del template literal)
// Necesitamos moverlo DENTRO del template literal del HTML
// Primero lo quitamos de donde está
const gameBlock = c.substring(gameStart, gameEnd)
console.log('found game block, length:', gameBlock.length)

// Quitarlo del sitio actual
c = c.substring(0, gameStart) + c.substring(gameEnd)

// Insertarlo ANTES del cierre </script> del overlay HTML
// Buscamos el cierre </script> dentro del template literal
const scriptClose = c.lastIndexOf('</script>')
const insertPoint = scriptClose

const gameJS = `
// ── Game events ──────────────────────────────────────────────────────────────
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
    const numSpan = '<span style="background:' + bg + ';color:' + fg + ';border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;margin-right:8px">' + m.number + '</span>'
    html = numSpan + m.msg
  } else if (m.type === 'game_bj') {
    const icons = { blackjack:'🃏', win:'🏆', lose:'💸', push:'🤝', bust:'💥' }
    html = (icons[m.result] || '🃏') + ' ' + m.msg
  }
  if (!html) return
  gameBox.innerHTML = html
  gameBox.style.opacity = '1'
  gameBox.style.transform = 'translateX(-50%) translateY(0)'
  gameTimer = setTimeout(function() {
    gameBox.style.opacity = '0'
    gameBox.style.transform = 'translateX(-50%) translateY(20px)'
  }, 5000)
}

`

c = c.substring(0, insertPoint) + gameJS + c.substring(insertPoint)

// También asegurarnos que los handlers están dentro del ws.onmessage
// Verificar que game_roulette llama showGameEvent
if (!c.includes("showGameEvent(m)")) {
  console.log('ERROR: showGameEvent call not found in ws.onmessage')
} else {
  console.log('showGameEvent call found OK')
}

fs.writeFileSync('src/services/overlay-server.js', c)
console.log('done, file size:', c.length)
