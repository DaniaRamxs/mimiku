const fs = require('fs')
let c = fs.readFileSync('src/services/twitch.js', 'utf8')

// mensaje: 1 → 2
c = c.replace('const viewer = onMessage(username, display)', 'const viewer = onMessage(username, display, 2)')

// sub: 50 → 150
c = c.replace("addPoints(username, 50, \"sub\")", "addPoints(username, 150, \"sub\")")

// resub: 30 → 80
c = c.replace("addPoints(username, 30, \"resub\")", "addPoints(username, 80, \"resub\")")

// bits: floor(bits/10) → floor(bits/10)*3
c = c.replace(
  "addPoints(username, Math.floor(bits / 10), \"bits\")",
  "addPoints(username, Math.floor(bits / 10) * 3, \"bits\")"
)

// raid: agregar puntos por viewer
c = c.replace(
  "send(\"twitch:event\", { type:\"raid\", text:`⚡ ${username} raid con ${viewers} viewers!`, username, viewers })",
  "addPoints(username, Math.min(viewers, 500), \"raid\")\n  send(\"twitch:event\", { type:\"raid\", text:`⚡ ${username} raid con ${viewers} viewers!`, username, viewers })"
)

// follow: agregar evento
c = c.replace(
  "  client.on(\"connected\", () => {",
  `  client.on("follow", (ch, username, methods) => {
    const display = username
    addPoints(username, 20, "follow")
    send("twitch:event", { type:"follow", text:\`❤️ \${display} siguió el canal!\`, username, display })
    sendOverlay({ type:"alert", text:\`❤️ \${display} siguió el canal!\`, duration:4000 })
  })

  client.on("connected", () => {`
)

fs.writeFileSync('src/services/twitch.js', c)
console.log('msg x2:', c.includes('onMessage(username, display, 2)'))
console.log('sub 150:', c.includes('150, "sub"'))
console.log('resub 80:', c.includes('80, "resub"'))
console.log('bits x3:', c.includes('* 3, "bits"'))
console.log('raid pts:', c.includes('Math.min(viewers, 500)'))
console.log('follow:', c.includes('"follow"'))
