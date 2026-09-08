const fs = require('fs')

// Agregar IPC handler en main.cjs
let m = fs.readFileSync('main.cjs', 'utf8')
m = m.replace(
  'ipcMain.handle("games:bj:open"',
  `ipcMain.handle("sync:toSupabase", async () => {
  const { supabaseAdmin } = require("./src/services/supabase.js")
  const eco = require("./src/services/economy.js")
  const channel = require("./src/services/currentChannel.js").get() || ""
  const viewers = eco.getRanking(9999)
  let synced = 0
  for (const v of viewers) {
    const { error } = await supabaseAdmin.from("viewers").upsert({
      username: v.username, display: v.display || v.username,
      points: v.points || 0, bank: v.bank || 0, messages: v.messages || 0,
      channel_id: channel, last_seen: new Date().toISOString(),
    }, { onConflict: "username,channel_id" })
    if (!error) synced++
  }
  // sync últimos 500 logs
  const logs = eco.getLog(500)
  for (const l of logs) {
    await supabaseAdmin.from("economy_log").upsert({
      username: l.username, delta: l.delta, reason: l.reason,
      channel_id: channel, created_at: l.created_at || new Date().toISOString(),
    })
  }
  return { synced, total: viewers.length }
})

ipcMain.handle("games:bj:open"`
)
fs.writeFileSync('main.cjs', m)
console.log('sync IPC added:', m.includes('sync:toSupabase'))

// Agregar botón en settings page
let h = fs.readFileSync('src/index.html', 'utf8')
h = h.replace(
  '          <div class="btn-row">\n            <button class="btn-primary" onclick="window.settingsPage.saveSettings()">Guardar y conectar</button>\n            <button class="btn-ghost" onclick="window.settingsPage.disconnectTwitch()">Desconectar</button>\n          </div>',
  `          <div class="btn-row">
            <button class="btn-primary" onclick="window.settingsPage.saveSettings()">Guardar y conectar</button>
            <button class="btn-ghost" onclick="window.settingsPage.disconnectTwitch()">Desconectar</button>
          </div>
        </div>
      </div>

      <div class="panel" style="max-width:480px;margin-top:1rem">
        <div class="panel-header"><span class="panel-title">Sincronización</span></div>
        <p class="desc">Sincroniza los puntos y datos de viewers a la nube para que se vean en el panel web.</p>
        <button class="btn-primary" onclick="window.settingsPage.syncToSupabase()" id="btn-sync">↑ Sincronizar ahora</button>`
)
fs.writeFileSync('src/index.html', h)
console.log('sync button added:', h.includes('syncToSupabase'))
