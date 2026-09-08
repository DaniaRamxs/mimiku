const fs = require('fs')
let c = fs.readFileSync('C:\\Users\\USUARIO\\Downloads\\mimiku\\mod-panel\\app.js', 'utf8')

c = c.replace(
  `const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }`,
  `const ICE_SERVERS = { iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  ]}`
)

fs.writeFileSync('C:\\Users\\USUARIO\\Downloads\\mimiku\\mod-panel\\app.js', c)
console.log('TURN added in mod panel:', c.includes('openrelay'))
