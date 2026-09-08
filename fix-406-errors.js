const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Fix: viewer_profiles — usar maybeSingle en vez de single
c = c.replaceAll(
  '.eq("channel_id", ch).eq("username", usr).single()',
  '.eq("channel_id", ch).eq("username", usr).maybeSingle()'
)

// Fix: loadShop — envolver en try/catch para que no rompa si falla
c = c.replace(
  'async function loadShop() {',
  `async function loadShop() {
  try {`
)

// Cerrar el try/catch al final de loadShop
const shopEnd = `  cosmEl.innerHTML = cosm.length ? cosm.map(c => \``
const shopEndReplacement = `  } catch(e) { console.error("loadShop error:", e.message) }

  cosmEl.innerHTML = cosm.length ? cosm.map(c => \``
c = c.replace(shopEnd, shopEndReplacement)

// Fix: loadCollection — envolver en try/catch
c = c.replace(
  'async function loadCollection() {',
  `async function loadCollection() {
  try {`
)

// Fix: loadProfile — envolver en try/catch
c = c.replace(
  'async function loadProfile() {',
  `async function loadProfile() {
  try {`
)

// Fix: loadOverview — envolver en try/catch
c = c.replace(
  'async function loadOverview() {',
  `async function loadOverview() {
  try {`
)

// Fix: loadEconomy — envolver en try/catch  
c = c.replace(
  'async function loadEconomy() {',
  `async function loadEconomy() {
  try {`
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('maybeSingle fixed:', c.includes('maybeSingle'))
console.log('try/catch in loadShop:', c.includes('loadShop error'))
