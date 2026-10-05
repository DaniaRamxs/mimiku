const test = require("node:test")
const assert = require("node:assert/strict")
const { createTwitchLiveStatus } = require("../src/services/twitch-live-status.js")

test("estado del directo: guarda titulo, juego, espectadores y miniatura en 640x360", async () => {
  let live = true
  const helix = {
    hasToken: () => true,
    get: async () => ({ data: live ? [{ id: "77", started_at: "2026-10-05T18:00:00Z", title: "Blackjack", game_name: "Just Chatting", viewer_count: 12, user_login: "hikkidx", user_name: "HikkiDX", thumbnail_url: "https://static-cdn.jtvnw.net/previews-ttv/live_user_hikkidx-{width}x{height}.jpg" }] : [] }),
  }
  const status = createTwitchLiveStatus({ helix, getChannel: () => "HikkiDX", log: { warn() {} } })
  const on = await status.check()
  assert.deepEqual([on.live, on.title, on.game, on.viewers, on.login, on.display], [true, "Blackjack", "Just Chatting", 12, "hikkidx", "HikkiDX"])
  assert.equal(on.thumbnail, "https://static-cdn.jtvnw.net/previews-ttv/live_user_hikkidx-640x360.jpg")
  live = false
  const off = await status.check()
  assert.deepEqual([off.live, off.login], [false, "hikkidx"])
})
