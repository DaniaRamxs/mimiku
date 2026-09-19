const test = require("node:test")
const assert = require("node:assert/strict")

const { normalizeViewerIdentity, viewerIdentityKey } = require("../src/core/identity/viewer-identity.js")
const { createCooldownStore } = require("../src/services/shop.js")

test("canonical identity key uses platform and real platform user id", () => {
  assert.equal(viewerIdentityKey({ platform: "YouTube", platformUserId: "123", username: "Luna" }), "youtube:123")
  assert.equal(viewerIdentityKey({ platform: "Twitch", platformUserId: "123", username: "Luna" }), "twitch:123")
})

test("legacy identity fallback remains namespaced by platform", () => {
  assert.deepEqual(normalizeViewerIdentity({ platform: "YouTube", username: " Luna " }), {
    platform: "youtube",
    platformUserId: "",
    username: "luna",
    displayName: "luna",
    avatarUrl: "",
  })
  assert.equal(viewerIdentityKey({ platform: "youtube", username: "luna" }), "youtube:legacy:luna")
})

test("shop cooldowns use stable identity rather than username alone", () => {
  let now = 1000
  const cooldowns = createCooldownStore({ now: () => now, cooldownMs: 30000 })
  const twitch = { platform: "twitch", platformUserId: "tw-1", username: "luna" }
  const youtube = { platform: "youtube", platformUserId: "yt-1", username: "luna" }
  cooldowns.set(twitch, "confeti")
  now += 100
  assert.ok(cooldowns.check(twitch, "confeti") > 0)
  assert.equal(cooldowns.check(youtube, "confeti"), 0)
})

