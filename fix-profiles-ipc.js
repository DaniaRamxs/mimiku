const fs = require('fs')
let c = fs.readFileSync('main.cjs', 'utf8')

const profilesIPC = `
// ── IPC: perfiles y cartas ────────────────────────────────────────────────────
function profiles() { return require("./src/services/profiles.js") }

ipcMain.handle("profiles:getCards",      (_, ch)                    => profiles().getCards(ch))
ipcMain.handle("profiles:createCard",    (_, { ch, name, desc, img, rarity }) => profiles().createCard(ch, name, desc, img, rarity))
ipcMain.handle("profiles:deleteCard",    (_, id)                    => profiles().deleteCard(id))
ipcMain.handle("profiles:getPacks",      (_, ch)                    => profiles().getPacks(ch))
ipcMain.handle("profiles:createPack",    (_, { ch, name, desc, price, tier }) => profiles().createPack(ch, name, desc, price, tier))
ipcMain.handle("profiles:getCosmetics",  (_, ch)                    => profiles().getCosmetics(ch))
ipcMain.handle("profiles:createCosmetic",(_, { ch, name, type, img, color, price }) => profiles().createCosmetic(ch, name, type, img, color, price))
`

c = c.replace(
  'app.whenReady().then(() => {',
  profilesIPC + '\napp.whenReady().then(() => {'
)

fs.writeFileSync('main.cjs', c)
console.log('profiles IPC:', c.includes('profiles:getCards'))
