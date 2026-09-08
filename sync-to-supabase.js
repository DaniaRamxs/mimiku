// sync-to-supabase.js — migra viewers y economy_log de SQLite a Supabase
const Database = require("better-sqlite3")
const path = require("path")
const { createClient } = require("@supabase/supabase-js")

const SUPABASE_URL = process.env.MIMIKU_SUPABASE_URL
const SUPABASE_SERVICE = process.env.MIMIKU_SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE) {
  throw new Error("Configura MIMIKU_SUPABASE_URL y MIMIKU_SUPABASE_SERVICE_KEY para ejecutar esta herramienta de migración")
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const dbPath = path.join(__dirname, "mimiku-data.db")
const db     = new Database(dbPath)

async function sync() {
  // leer canal activo del settings
  const chRow = db.prepare("SELECT value FROM settings WHERE key = 'channel'").get()
  const channel = chRow?.value || ""
  console.log("Canal:", channel || "(no configurado)")

  // viewers
  const viewers = db.prepare("SELECT * FROM viewers").all()
  console.log(`Sincronizando ${viewers.length} viewers…`)

  for (const v of viewers) {
    const { error } = await sb.from("viewers").upsert({
      username:   v.username,
      display:    v.display || v.username,
      points:     v.points || 0,
      bank:       v.bank || 0,
      messages:   v.messages || 0,
      channel_id: channel,
      last_seen:  new Date().toISOString(),
    }, { onConflict: "username,channel_id" })
    if (error) console.error("Error viewer", v.username, error.message)
    else process.stdout.write(".")
  }

  console.log("\nViewers sincronizados.")

  // economy_log (últimos 500)
  const logs = db.prepare("SELECT * FROM economy_log ORDER BY id DESC LIMIT 500").all()
  console.log(`Sincronizando ${logs.length} logs…`)

  for (const l of logs) {
    await sb.from("economy_log").upsert({
      username:   l.username,
      delta:      l.delta,
      reason:     l.reason,
      channel_id: channel,
      created_at: l.created_at || new Date().toISOString(),
    })
  }

  console.log("Logs sincronizados.")
  console.log("\n✅ Sincronización completa!")
}

sync().catch(console.error)
