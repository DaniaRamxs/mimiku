const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Encontrar funciones con try sin catch
// Las funciones afectadas son: loadOverview, loadProfile, loadCollection, loadEconomy
// Cada una tiene 'try {' agregado al inicio pero sin cierre

// Eliminar los try { agregados incorrectamente (los que están justo después de la apertura de función async)
c = c.replace(/^(async function \w+\(\) \{\n  try \{)$/gm, (match) => {
  return match
})

// Más específico: reemplazar el patrón incorrecto
const badPatterns = [
  { fn: 'async function loadOverview() {\n  try {', fix: 'async function loadOverview() {' },
  { fn: 'async function loadProfile() {\n  try {', fix: 'async function loadProfile() {' },
  { fn: 'async function loadCollection() {\n  try {', fix: 'async function loadCollection() {' },
  { fn: 'async function loadEconomy() {\n  try {', fix: 'async function loadEconomy() {' },
  { fn: 'async function loadShop() {\n  try {', fix: 'async function loadShop() {' },
]

for (const p of badPatterns) {
  if (c.includes(p.fn)) {
    c = c.replace(p.fn, p.fix)
    console.log('removed try from:', p.fix.split('function ')[1].split('(')[0])
  }
}

// También quitar el try que se agregó en loadShop con su error handler
c = c.replace('  } catch(e) { console.error("loadShop error:", e.message) }\n\n  cosmEl.innerHTML', '  cosmEl.innerHTML')

fs.writeFileSync('mod-panel/app.js', c)

// verificar
const tries   = (c.match(/try\s*{/g)||[]).length
const catches = (c.match(/}\s*catch/g)||[]).length
console.log('try:', tries, 'catch:', catches, 'diff:', tries-catches)
