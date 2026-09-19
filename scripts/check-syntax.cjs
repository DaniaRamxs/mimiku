const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const roots = ["main.cjs", "src", "mod-panel"]
const files = []

function collect(relativePath) {
  const absolute = path.join(root, relativePath)
  const stats = fs.statSync(absolute)
  if (stats.isDirectory()) {
    for (const name of fs.readdirSync(absolute)) collect(path.join(relativePath, name))
    return
  }
  if (/\.(?:js|cjs)$/i.test(absolute)) files.push(absolute)
}

for (const entry of roots) collect(entry)
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log(`${files.length} archivos JavaScript con sintaxis válida.`)
