const fs = require('fs')

const newICE = `const ICE_SERVERS = { iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "turn:relay1.expressturn.com:3478", username: "efQWIDL8PJBCPPSF2U", credential: "hFc3mMfWDCqYQHdq" },
    { urls: "turns:relay1.expressturn.com:443", username: "efQWIDL8PJBCPPSF2U", credential: "hFc3mMfWDCqYQHdq" }
  ]}`

// Fix overlay
let c = fs.readFileSync('src/services/overlay-server.js', 'utf8')
c = c.replace(/const ICE_SERVERS\s*=\s*\{[\s\S]*?\}(\s*\})?/, newICE)
fs.writeFileSync('src/services/overlay-server.js', c)
console.log('overlay TURN:', c.includes('expressturn'))

// Fix mod panel
let m = fs.readFileSync('mod-panel/app.js', 'utf8')
m = m.replace(/const ICE_SERVERS\s*=\s*\{[\s\S]*?\}(\s*\})?/, newICE)
fs.writeFileSync('mod-panel/app.js', m)
console.log('modpanel TURN:', m.includes('expressturn'))
