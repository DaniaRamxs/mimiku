const fs = require('fs')
let c = fs.readFileSync('src/services/twitch.js', 'utf8')

// Agregar contador de sesión al inicio
c = c.replace(
  'let client   = null\nlet _win     = null\nlet _channel = null\nlet _broadcast = null',
  `let client   = null
let _win     = null
let _channel = null
let _broadcast = null

// Contador de mensajes en sesión (se resetea al conectar)
const sessionMsgs = {}  // username → { display, count }
let kingUpdateTimer = null

function addSessionMsg(username, display) {
  if (!sessionMsgs[username]) sessionMsgs[username] = { display: display || username, count: 0 }
  sessionMsgs[username].count++
  sessionMsgs[username].display = display || username

  // actualizar rey del chat cada 5 mensajes o 10 segundos
  clearTimeout(kingUpdateTimer)
  kingUpdateTimer = setTimeout(broadcastKing, 500)
}

function broadcastKing() {
  const entries = Object.entries(sessionMsgs)
  if (!entries.length) return
  const [username, data] = entries.sort((a, b) => b[1].count - a[1].count)[0]
  if (_broadcast) _broadcast({ type: "king_update", username, display: data.display, messages: data.count })
}

function resetSessionMsgs() {
  Object.keys(sessionMsgs).forEach(k => delete sessionMsgs[k])
}`
)

// Llamar addSessionMsg en cada mensaje de chat
c = c.replace(
  `    if (message.startsWith("!")) { handleCommand(ch, tags, message); return }`,
  `    if (message.startsWith("!")) { handleCommand(ch, tags, message); return }
    addSessionMsg(username, display)`
)

// Resetear al conectar
c = c.replace(
  '  client.on("connected", () => {',
  `  // resetear contador de sesión al conectar
  resetSessionMsgs()

  client.on("connected", () => {`
)

fs.writeFileSync('src/services/twitch.js', c)
console.log('king tracker added:', c.includes('sessionMsgs'))
