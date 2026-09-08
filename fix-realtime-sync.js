const fs = require('fs')
let c = fs.readFileSync('main.cjs', 'utf8')

const realtimeSync = `
  // Escuchar compras desde el panel web y descontar en SQLite
  const { supabase } = require("./src/services/supabase.js")
  supabase.channel("web_purchases_" + channel)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "economy_log", filter: \`channel_id=eq.\${channel}\` },
      ({ new: log }) => {
        if (!log || !log.username || !log.delta) return
        // solo aplicar si viene del panel web (delta negativo = compra)
        if (log.delta >= 0) return
        const eco = require("./src/services/economy.js")
        const viewer = eco.getViewer(log.username)
        if (!viewer) return
        // verificar que no se haya aplicado ya (evitar doble descuento)
        // comparar con el último log local
        const localLogs = eco.getLog(5)
        const alreadyApplied = localLogs.some(l => l.reason === log.reason && l.delta === log.delta && l.username === log.username && Math.abs(new Date(l.created_at) - new Date(log.created_at)) < 5000)
        if (alreadyApplied) return
        eco.addPoints(log.username, log.delta, log.reason + "-web")
        console.log("[sync] Descuento web aplicado en SQLite:", log.username, log.delta, log.reason)
      })
    .subscribe()
`

c = c.replace(
  "  overlay().broadcast({ type: \"set_channel\", channel: channel.toLowerCase() })",
  `  overlay().broadcast({ type: "set_channel", channel: channel.toLowerCase() })
${realtimeSync}`
)

fs.writeFileSync('main.cjs', c)
console.log('realtime sync added:', c.includes('web_purchases_'))
