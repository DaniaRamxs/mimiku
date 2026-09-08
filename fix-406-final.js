const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Agregar try/catch global en switchChTab para que ninguna tab rompa la página
c = c.replace(
  `  if (tab === "overview")    loadOverview()
  if (tab === "economy")     loadEconomy()
  if (tab === "profile")     loadProfile()
  if (tab === "collection")  loadCollection()
  if (tab === "shop")        loadShop()
  if (tab === "mod")         initModTab()`,
  `  if (tab === "overview")    loadOverview().catch(e => console.error("overview error:", e.message))
  if (tab === "economy")     loadEconomy().catch(e => console.error("economy error:", e.message))
  if (tab === "profile")     loadProfile().catch(e => console.error("profile error:", e.message))
  if (tab === "collection")  loadCollection().catch(e => console.error("collection error:", e.message))
  if (tab === "shop")        loadShop().catch(e => console.error("shop error:", e.message))
  if (tab === "mod")         initModTab()`
)

// Fix: viewer_profiles query — usar maybeSingle
c = c.replaceAll(
  `await sb.from("viewer_profiles").select("*").eq("channel_id", ch).eq("username", usr).single()`,
  `await sb.from("viewer_profiles").select("*").eq("channel_id", ch).eq("username", usr).maybeSingle()`
)

// Fix: viewers query en loadProfile — usar maybeSingle
c = c.replaceAll(
  `await sb.from("viewers").select("*").eq("username", usr).single()`,
  `await sb.from("viewers").select("*").eq("username", usr).maybeSingle()`
)

// Fix: viewers query en buyPack y buyCosmetic — usar maybeSingle
c = c.replaceAll(
  `await sb.from("viewers").select("points").eq("username", u.login.toLowerCase()).single()`,
  `await sb.from("viewers").select("points").eq("username", u.login.toLowerCase()).maybeSingle()`
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('all fixes applied')
console.log('maybeSingle count:', (c.match(/maybeSingle/g)||[]).length)
