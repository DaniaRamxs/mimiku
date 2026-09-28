const fs = require("node:fs")

function createDiagnosticsService(dependencies) {
  function check(id, label, read) {
    try {
      const result = read()
      return { id, label, ok: result.ok !== false, detail: String(result.detail || "OK").slice(0, 300) }
    } catch (error) {
      return { id, label, ok: false, detail: String(error.message || error).slice(0, 300) }
    }
  }

  function run() {
    const checks = []
    checks.push(check("database", "SQLite", () => {
      const result = dependencies.database.quickCheck()
      return { ok: result.ok, detail: result.ok ? "Base local íntegra" : result.result }
    }))
    checks.push(check("overlay", "Servidor local", () => {
      const status = dependencies.overlay.getStatus()
      return { ok: status.running, detail: status.running ? `${status.host || "127.0.0.1"}:${status.httpPort || 7777} y WebSocket local` : (status.error || "No iniciado") }
    }))
    checks.push(check("workspace", "Comunidad local", () => {
      const workspace = dependencies.workspace()
      return { ok: !!workspace?.id, detail: workspace?.id ? "Configurada" : "Sin identificador local" }
    }))
    checks.push(check("twitch", "Twitch", () => {
      const status = dependencies.twitch.getStatus()
      return { ok: status.state !== "error", detail: status.state === "connected" ? "Conectado" : (status.state || "No conectado") }
    }))
    checks.push(check("ssn", "Social Stream Ninja", () => {
      const status = dependencies.ssn.getStatus()
      const state = status.connection?.state || "not_connected"
      return { ok: state !== "error", detail: state === "connected" ? `Conectado en 127.0.0.1:${status.connection.port || 3003}` : state }
    }))
    checks.push(check("sound-files", "Sound Triggers", () => {
      const soundState = dependencies.sounds.list()
      const missing = soundState.mappings.filter(mapping => mapping.exists === false).length
      return { ok: missing === 0, detail: missing ? `${missing} archivo(s) ausente(s)` : `${soundState.mappings.length} trigger(s) disponibles` }
    }))
    return {
      generatedAt: new Date().toISOString(),
      appVersion: dependencies.appVersion,
      runtime: { platform: process.platform, arch: process.arch, electron: process.versions.electron || "", node: process.versions.node },
      checks,
      ok: checks.every(item => item.ok),
    }
  }

  function exportReport(filePath) {
    const report = run()
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), { encoding: "utf8", flag: "w" })
    return report
  }

  return { run, exportReport }
}

let defaultService = null
function getDefaultDiagnosticsService() {
  if (!defaultService) {
    defaultService = createDiagnosticsService({
      database: require("./db.js"),
      overlay: require("./overlay-server.js"),
      ssn: require("../integrations/social-stream-ninja/social-stream-ninja-state.js").getDefaultSocialStreamNinjaState(),
      twitch: require("./twitch.js"),
      sounds: require("./emoteSounds.js"),
      workspace: () => require("./app-config.js").ensureWorkspace(),
      appVersion: require("../../package.json").version,
    })
  }
  return defaultService
}

module.exports = { createDiagnosticsService, getDefaultDiagnosticsService }
