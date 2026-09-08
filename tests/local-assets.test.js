const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { createLocalAssetStore } = require("../src/services/local-assets.js")

test("asset store writes validated files locally and blocks unsafe types", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mimiku-assets-"))
  const store = createLocalAssetStore(root)
  const saved = await store.save({ kind: "card", name: "avatar.png", mimeType: "image/png", bytes: Buffer.from("png-data") })
  assert.equal(fs.existsSync(saved.localPath), true)
  assert.match(saved.url, /^\/assets\//)
  await assert.rejects(() => store.save({ kind: "card", name: "payload.exe", mimeType: "application/x-msdownload", bytes: Buffer.from("bad") }), /tipo de archivo/i)
  fs.rmSync(root, { recursive: true, force: true })
})

test("remote legacy assets can be imported with a deterministic checksum", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mimiku-assets-"))
  const store = createLocalAssetStore(root)
  const fetcher = async () => ({ ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => Buffer.from("legacy") })
  const first = await store.importRemote("https://legacy.invalid/a.png", "mimic", fetcher)
  const second = await store.importRemote("https://legacy.invalid/a.png", "mimic", fetcher)
  assert.equal(first.checksum, second.checksum)
  assert.equal(first.localPath, second.localPath)
  fs.rmSync(root, { recursive: true, force: true })
})
