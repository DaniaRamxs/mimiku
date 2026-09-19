const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mimiku-node-tests-"))
const workspace = path.join(temporaryRoot, "workspace")
const ignoredDirectories = new Set([".git", "node_modules", "dist"])

function copyProject(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    if (entry.isFile() && /(?:\.db(?:-.+)?|\.db\.backup)$/i.test(entry.name)) continue
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyProject(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: workspace, stdio: "inherit", shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status || 1
  return result.status === 0
}

copyProject(root, workspace)
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

try {
  if (!run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund"])) process.exit()
  if (!run(npm, ["rebuild", "better-sqlite3"])) process.exit()
  run(npm, ["run", "test:node"])
} finally {
  if (!process.exitCode) fs.rmSync(temporaryRoot, { recursive: true, force: true })
  else console.error(`La copia temporal con el fallo se conserva en: ${temporaryRoot}`)
}
