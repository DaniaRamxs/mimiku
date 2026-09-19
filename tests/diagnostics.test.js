const test = require("node:test")
const assert = require("node:assert/strict")

const { createDiagnosticsService } = require("../src/services/diagnostics.js")

test("stream doctor reports local subsystems without leaking secrets", () => {
  const service = createDiagnosticsService({
    database: { quickCheck: () => ({ ok: true, result: "ok" }) },
    overlay: { getStatus: () => ({ running: true, error: null }) },
    ssn: { getStatus: () => ({ connection: { state: "connected", port: 3003 }, sessionId: "must-not-leak" }) },
    twitch: { getStatus: () => ({ state: "disconnected", channel: "" }) },
    sounds: { list: () => ({ mappings: [{ exists: false }], enabled: true }) },
    workspace: () => ({ id: "local-fake", name: "Kira" }),
    appVersion: "2.0.0",
  })
  const report = service.run()
  assert.equal(report.checks.find(check => check.id === "database").ok, true)
  assert.equal(report.checks.find(check => check.id === "sound-files").ok, false)
  assert.equal(JSON.stringify(report).includes("must-not-leak"), false)
})

