const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")
const RUNTIME_FILES = [
  "package.json",
  "main.cjs",
  "sync-to-supabase.js",
  "supabase-schema.sql",
  "src/index.html",
  "src/services/supabase.js",
  "src/services/vts/vts-roulette-config.json",
  "mod-panel/app.js",
]

function projectTextFiles(directory = ROOT) {
  const ignored = new Set(["node_modules", "dist", "build", "tests", ".git", "mimiku"])
  const allowed = new Set([".js", ".cjs", ".json", ".html", ".sql", ".md"])
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...projectTextFiles(absolute))
    else if (allowed.has(path.extname(entry.name).toLowerCase())) files.push(absolute)
  }
  return files
}

test("distributed runtime does not contain original developer-bound values", () => {
  const banned = [
    /grpubuffirqpiimtdnnz/i,
    /mod-panel-tau\.vercel\.app/i,
    /3ioia22c6jvh5iy3hm4auq2f0ff7gj/i,
    /hikkidx/i,
    /Dania Alejandra Chacaya Ramos/i,
    /Dan\s*\/\s*hikkidx/i,
  ]

  const violations = []
  for (const relativePath of RUNTIME_FILES) {
    const content = fs.readFileSync(path.join(ROOT, relativePath), "utf8")
    for (const pattern of banned) {
      if (pattern.test(content)) violations.push(`${relativePath}: ${pattern}`)
    }
  }

  assert.deepEqual(violations, [])
})

test("distributed runtime contains no embedded JWT credentials", () => {
  const jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
  const violations = RUNTIME_FILES.filter(relativePath => {
    const content = fs.readFileSync(path.join(ROOT, relativePath), "utf8")
    return jwtPattern.test(content)
  })

  assert.deepEqual(violations, [])
})

test("active project text contains no original developer identity", () => {
  const banned = /grpubuffirqpiimtdnnz|mod-panel-tau\.vercel\.app|3ioia22c6jvh5iy3hm4auq2f0ff7gj|hikkidx|Dania Alejandra Chacaya Ramos/i
  const violations = projectTextFiles()
    .filter(file => banned.test(fs.readFileSync(file, "utf8")))
    .map(file => path.relative(ROOT, file))
  assert.deepEqual(violations, [])
})

test("legacy import is rejected before loading a cloud client when disabled", () => {
  const main = fs.readFileSync(path.join(ROOT, "main.cjs"), "utf8")
  const handlerStart = main.indexOf('ipcMain.handle("legacy:import"')
  const guard = main.indexOf("appConfig.isLegacySupabaseConfigured()", handlerStart)
  const importerLoad = main.indexOf('require("./src/services/legacy-importer.js")', handlerStart)

  assert.notEqual(handlerStart, -1)
  assert.ok(guard > handlerStart)
  assert.ok(importerLoad > guard)
})
