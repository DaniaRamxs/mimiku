const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.resolve(__dirname, "..")
const { escapeHtml, inlineJson, safeColor, safeHttpUrl } = require("../src/core/html.js")

test("external values are escaped before HTML rendering", () => {
  assert.equal(escapeHtml(`<img src=x onerror="boom()">`), "&lt;img src=x onerror=&quot;boom()&quot;&gt;")
  assert.equal(inlineJson(`');boom();//`), "&quot;&#39;);boom();//&quot;")
  assert.equal(safeColor("red;position:fixed"), "#7c6ef5")
  assert.equal(safeHttpUrl("javascript:alert(1)"), "")
  assert.equal(safeHttpUrl("http://127.0.0.1:7777/assets/fake.png"), "http://127.0.0.1:7777/assets/fake.png")
})

test("Electron renderer runs with context isolation and without Node integration", () => {
  const main = fs.readFileSync(path.join(ROOT, "main.cjs"), "utf8")
  assert.match(main, /nodeIntegration:\s*false/)
  assert.match(main, /contextIsolation:\s*true/)
  assert.match(main, /preload:\s*path\.join\(__dirname,\s*"src",\s*"preload\.js"\)/)
  assert.equal(fs.existsSync(path.join(ROOT, "src", "preload.js")), true)
})

test("dashboard chat feed renders external text without innerHTML", () => {
  const source = fs.readFileSync(path.join(ROOT, "src", "pages", "dashboard.js"), "utf8")
  const start = source.indexOf("function addFeedItem")
  const end = source.indexOf("async function refreshStats", start)
  assert.notEqual(start, -1)
  assert.ok(end > start)
  assert.equal(source.slice(start, end).includes("innerHTML"), false)
})

test("package allowlist excludes environment and maintenance artifacts", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const files = packageJson.build.files
  assert.ok(files.includes("!**/.env*"))
  assert.equal(files.includes("mod-panel/**/*"), false)
  assert.ok(files.includes("mod-panel/index.html"))
  assert.ok(files.includes("mod-panel/app.js"))
  assert.ok(files.includes("mod-panel/style.css"))
})

test("public HTML surfaces declare a content security policy", () => {
  for (const relativePath of ["src/index.html", "src/services/overlay.html", "mod-panel/index.html"]) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8")
    assert.match(source, /Content-Security-Policy/)
  }
})
