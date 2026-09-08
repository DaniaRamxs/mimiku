const fs = require('fs')
let c = fs.readFileSync('src/services/economy.js', 'utf8')

// Agregar import de supabase al inicio
c = c.replace(
  '// services/economy.js — puntos, ranking, historial, daily, work\nconst { getDb } = require("./db.js")',
  '// services/economy.js — puntos, ranking, historial, daily, work\nconst { getDb } = require("./db.js")\nconst { supabase } = require("./supabase.js")\n\n// Sincroniza viewer a Supabase en background (no bloquea)\nfunction syncViewerToSupabase(username, display, points, messages) {\n  supabase.from("viewers").upsert({\n    username: username.toLowerCase(),\n    display: display || username,\n    points,\n    messages,\n    channel_id: require("./currentChannel.js").get() || ""\n  }, { onConflict: "username,channel_id" }).then(({ error }) => {\n    if (error) console.error("[economy] sync error:", error.message)\n  })\n}'
)

// Sincronizar después de addPoints
c = c.replace(
  `  db.prepare(\`INSERT INTO economy_log (username, delta, reason) VALUES (?, ?, ?)\`)
    .run(username.toLowerCase(), delta, reason)
  return getViewer(username)
}`,
  `  db.prepare(\`INSERT INTO economy_log (username, delta, reason) VALUES (?, ?, ?)\`)
    .run(username.toLowerCase(), delta, reason)
  const v = getViewer(username)
  if (v) syncViewerToSupabase(v.username, v.display, v.points, v.messages)
  return v
}`
)

// También sincronizar economy_log a Supabase
c = c.replace(
  `  db.prepare(\`INSERT INTO economy_log (username, delta, reason) VALUES (?, ?, ?)\`)
    .run(username.toLowerCase(), delta, reason)
  const v = getViewer(username)`,
  `  db.prepare(\`INSERT INTO economy_log (username, delta, reason) VALUES (?, ?, ?)\`)
    .run(username.toLowerCase(), delta, reason)
  // sync log a Supabase
  const ch = require("./currentChannel.js").get()
  if (ch) supabase.from("economy_log").insert({ username: username.toLowerCase(), delta, reason, channel_id: ch }).then()
  const v = getViewer(username)`
)

fs.writeFileSync('src/services/economy.js', c)
console.log('sync added:', c.includes('syncViewerToSupabase'))
