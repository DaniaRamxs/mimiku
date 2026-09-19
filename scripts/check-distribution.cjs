const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const forbiddenNames = new Set([
  "background.js",
  "dock.html",
  "renderer.js",
  "source-observation-service.js",
  "overlay-patch.txt",
])
const violations = []

for (const directory of [root, path.join(root, "mod-panel")]) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (/^(?:fix|patch)-.*\.js$/i.test(entry.name) || forbiddenNames.has(entry.name)) {
      violations.push(path.relative(root, path.join(directory, entry.name)))
    }
  }
}

const packagedFiles = packageJson.build?.files || []
if (packagedFiles.includes("mod-panel/**/*")) violations.push("package.json: mod-panel/**/*")
if (!packagedFiles.includes("!**/.env*")) violations.push("package.json: falta !**/.env*")

const runtimeFiles = ["main.cjs", "src/index.html", "mod-panel/app.js", "src/services/supabase.js"]
const secretPatterns = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /C:\\Users\\[^\\\s]+/i,
  /https:\/\/[a-z0-9-]+\.supabase\.co/i,
]
for (const relativePath of runtimeFiles) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8")
  for (const pattern of secretPatterns) {
    if (pattern.test(source)) violations.push(`${relativePath}: ${pattern}`)
  }
}

if (violations.length) {
  console.error("Distribución rechazada:\n" + violations.map(item => `- ${item}`).join("\n"))
  process.exit(1)
}
console.log("Distribución limpia: sin secretos, dumps ni scripts de mantenimiento.")
