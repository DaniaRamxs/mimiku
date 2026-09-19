const test = require("node:test")
const assert = require("node:assert/strict")

const { createCommandConfigService } = require("../src/services/command-config.js")

function fakePlatform() {
  let saved = null
  return {
    moderation: {
      getConfig: () => saved,
      setConfig: (_channel, _key, value) => { saved = value; return saved },
    },
  }
}

test("command catalog defaults to enabled on every supported chat platform", () => {
  const service = createCommandConfigService(fakePlatform(), () => "workspace")
  const points = service.list().find(command => command.name === "!puntos")
  assert.equal(points.enabled, true)
  assert.equal(points.platform, "all")
  assert.equal(service.isEnabled("!puntos", "youtube"), true)
})

test("command catalog includes the VIP info command", () => {
  const service = createCommandConfigService(fakePlatform(), () => "workspace")
  const info = service.list().find(command => command.name === "!info")
  assert.equal(info.category, "Ayuda")
  assert.equal(info.enabled, true)
  assert.equal(service.isEnabled("!info", "twitch"), true)
})

test("disabled and platform-scoped commands are enforced", () => {
  const service = createCommandConfigService(fakePlatform(), () => "workspace")
  service.update("!puntos", { enabled: true, platform: "youtube" })
  assert.equal(service.isEnabled("!puntos", "youtube"), true)
  assert.equal(service.isEnabled("!puntos", "twitch"), false)
  service.update("!puntos", { enabled: false })
  assert.equal(service.isEnabled("!puntos", "youtube"), false)
})
