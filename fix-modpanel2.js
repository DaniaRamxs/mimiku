const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// verificar si falta SUPABASE_URL
if (!c.startsWith('const SUPABASE_URL')) {
  c = 'const SUPABASE_URL     = process.env.MIMIKU_SUPABASE_URL || ""\n' + c
}

// corregir ICE_SERVERS — buscar y reemplazar por posición exacta
const iceStart = c.indexOf('const ICE_SERVERS')
const iceEnd   = c.indexOf('\n}', iceStart) + 2
console.log('ICE found at:', iceStart, 'to', iceEnd)
console.log('ICE block:', c.substring(iceStart, iceEnd))

const newICE = `const ICE_SERVERS = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "turn:relay1.expressturn.com:3478", username: "efQWIDL8PJBCPPSF2U", credential: "hFc3mMfWDCqYQHdq" },
  { urls: "turns:relay1.expressturn.com:443", username: "efQWIDL8PJBCPPSF2U", credential: "hFc3mMfWDCqYQHdq" }
] }`

if (iceStart > -1 && iceEnd > iceStart) {
  c = c.substring(0, iceStart) + newICE + c.substring(iceEnd)
}

fs.writeFileSync('mod-panel/app.js', c)
console.log('SUPABASE_URL:', c.includes('const SUPABASE_URL'))
console.log('expressturn:', c.includes('expressturn'))
console.log('checkChannel:', c.includes('checkChannel'))
