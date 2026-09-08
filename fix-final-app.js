const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Agregar .catch() en switchChTab
c = c.replace(
  `  if (tab === "overview")    loadOverview()
  if (tab === "economy")     loadEconomy()
  if (tab === "profile")     loadProfile()
  if (tab === "collection")  loadCollection()
  if (tab === "shop")        loadShop()
  if (tab === "mod")         initModTab()`,
  `  if (tab === "overview")    loadOverview().catch(e => console.error("overview:", e.message))
  if (tab === "economy")     loadEconomy().catch(e => console.error("economy:", e.message))
  if (tab === "profile")     loadProfile().catch(e => console.error("profile:", e.message))
  if (tab === "collection")  loadCollection().catch(e => console.error("collection:", e.message))
  if (tab === "shop")        loadShop().catch(e => console.error("shop:", e.message))
  if (tab === "mod")         initModTab()`
)

// Fix maybeSingle en todas las queries que usan single()
c = c.replaceAll('.eq("channel_id", ch).eq("username", usr).single()', '.eq("channel_id", ch).eq("username", usr).maybeSingle()')
c = c.replaceAll('.eq("username", usr).single()', '.eq("username", usr).maybeSingle()')
c = c.replaceAll('.eq("username", u.login.toLowerCase()).single()', '.eq("username", u.login.toLowerCase()).maybeSingle()')

fs.writeFileSync('mod-panel/app.js', c)

// verificar sintaxis
const tries   = (c.match(/try\s*{/g)||[]).length
const catches = (c.match(/}\s*catch/g)||[]).length
console.log('try:', tries, 'catch:', catches, 'ok:', tries === catches)
console.log('maybeSingle count:', (c.match(/maybeSingle/g)||[]).length)
