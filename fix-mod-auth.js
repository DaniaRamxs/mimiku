const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Reemplazar la función verifyAndEnterMod para quitar la verificación de mod
const oldVerify = `async function verifyAndEnterMod() {
  try {
    const res = await fetch("https://api.twitch.tv/helix/users", {
      headers: { "Authorization": \`Bearer \${state.twitchToken}\`, "Client-Id": TWITCH_CLIENT_ID }
    })
    if (!res.ok) throw new Error()
    const { data } = await res.json()
    const user = data[0]
    const isBroadcaster = user.login.toLowerCase() === state.currentChannel.toLowerCase()
    let isMod = isBroadcaster

    if (!isBroadcaster) {
      try {
        const br = await fetch(\`https://api.twitch.tv/helix/users?login=\${state.currentChannel}\`,
          { headers: { "Authorization": \`Bearer \${state.twitchToken}\`, "Client-Id": TWITCH_CLIENT_ID } })
        const bd = await br.json()
        const bid = bd.data?.[0]?.id
        if (bid) {
          const mr = await fetch(\`https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=\${bid}&user_id=\${user.id}\`,
            { headers: { "Authorization": \`Bearer \${state.twitchToken}\`, "Client-Id": TWITCH_CLIENT_ID } })
          const md = await mr.json()
          isMod = md.data?.length > 0
        }
      } catch {}
    }

    if (!isMod) {
      localStorage.removeItem("mimiku_twitch_token")
      state.twitchToken = null
      document.getElementById("mod-login-error").textContent = "No sos mod de este canal."
      return
    }

    state.twitchUser = user

    // Mostrar canal si venimos de redirect
    if (!document.getElementById("channel-screen").style.display || document.getElementById("channel-screen").style.display === "none") {
      await openChannel(state.currentChannel, "mod")
    } else {
      showModPanel()
    }
  } catch {
    localStorage.removeItem("mimiku_twitch_token")
    state.twitchToken = null
    document.getElementById("mod-login-error").textContent = "Sesión expirada. Intentá de nuevo."
  }
}`

const newVerify = `async function verifyAndEnterMod() {
  try {
    const res = await fetch("https://api.twitch.tv/helix/users", {
      headers: { "Authorization": \`Bearer \${state.twitchToken}\`, "Client-Id": TWITCH_CLIENT_ID }
    })
    if (!res.ok) throw new Error("Token inválido")
    const { data } = await res.json()
    if (!data?.[0]) throw new Error("Usuario no encontrado")

    state.twitchUser = data[0]

    // Mostrar canal si venimos de redirect OAuth
    if (!document.getElementById("channel-screen").style.display ||
        document.getElementById("channel-screen").style.display === "none") {
      await openChannel(state.currentChannel, "mod")
    } else {
      showModPanel()
    }
  } catch (e) {
    localStorage.removeItem("mimiku_twitch_token")
    state.twitchToken = null
    const errEl = document.getElementById("mod-login-error")
    if (errEl) errEl.textContent = "Sesión expirada. Intentá de nuevo."
  }
}`

c = c.replace(oldVerify, newVerify)
fs.writeFileSync('mod-panel/app.js', c)
console.log('fixed:', c.includes('Token inválido'))
