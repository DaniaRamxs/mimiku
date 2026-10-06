// services/community.js — portada de la pestaña Comunidad y logros.
//
// - Ahora en el canal: quien tiene la pagina abierta (cualquier llamada a la
//   API cuenta como "visto", la pagina consulta cada pocos segundos) y quien
//   ha escrito en el chat hace poco (la misma ventana que da XP por ver).
// - Destacados de la semana (ultimos 7 dias, todo guardado en la base de
//   datos, asi que sobrevive a reiniciar Mimiku): legendarios y niveles del
//   registro de actividad (los apuntan gachapon.js, plinko.js y levels al
//   momento, con o sin la pagina abierta) y puntos ganados a Hikki de las
//   manos de blackjack guardadas (minigame_sessions).
// - Logros (achievements.js): cada jugada que pasa por el tablon En vivo suma
//   a los contadores de por vida del viewer (`track`); los de perfil (nivel,
//   coleccion...) se miran al abrir un perfil. Un logro nuevo queda sin ver
//   hasta que la pagina se lo avisa al viewer (`takeFresh`).
const { createViewerProfiles } = require("./viewer-profiles.js")
const { ACHIEVEMENTS, BY_ID, TIER_ORDER, reached, valueOf, publicAchievement } = require("./achievements.js")

const ONLINE_WINDOW_MS = 2 * 60_000
const ONLINE_MAX = 30
const WEEK_MS = 7 * 24 * 60 * 60_000
const HIGHLIGHT_TOP = 3
const MINIGAMES = new Set(["plinko", "scratch", "wheel", "slots", "hilo", "mines", "blackjack"])

// Lo que suma cada evento del tablon a los contadores de por vida.
function statsOf(event) {
  const add = {}
  const inc = (stat, value = 1) => { if (value > 0) add[stat] = (add[stat] || 0) + value }
  const kind = event.kind || "play"
  const net = Number(event.net) || 0
  if (kind === "play" && MINIGAMES.has(event.game)) {
    inc("plays")
    if (event.big && event.outcome === "win") inc("big_wins")
  }
  if (kind === "play" && event.game === "gacha") inc("pulls", Math.max(1, Math.trunc(Number(event.count) || 1)))
  if (kind === "play" && event.rarity === "legendario") inc("legendaries")
  if (event.game === "blackjack") {
    if (net > 0 || event.handWon) inc("hikki_wins")
    if (event.result === "blackjack") inc("naturals")
  }
  if (kind === "steal" || kind === "rob") inc("steals")
  if (kind === "rob-fail") inc("rob_fails")
  if (kind === "gift") inc("gifts", Math.trunc(net))
  return add
}

function createCommunity({ platform, getChannel, now = Date.now, isSub = () => false, getChatters = () => [] }) {
  const db = platform.db
  const profiles = createViewerProfiles({ platform, getChannel, now, isSub })
  const web = new Map() // viewerId -> ultima vez visto en la pagina
  const byTwitch = new Map() // twitchId -> viewerId

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  function iso(at = now()) { return new Date(at).toISOString() }

  function viewerIdFromTwitch(twitchId) {
    const key = String(twitchId)
    if (byTwitch.has(key)) return byTwitch.get(key)
    const row = db.prepare("SELECT id FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(key)
    if (row) byTwitch.set(key, row.id)
    return row ? row.id : null
  }

  // ── Ahora en el canal ──
  function seen(twitchId) {
    const viewerId = viewerIdFromTwitch(twitchId)
    if (viewerId) web.set(viewerId, now())
  }

  function chatterIds() {
    const ids = []
    for (const chatter of getChatters() || []) {
      const row = chatter.platformUserId
        ? db.prepare("SELECT id FROM viewer_identities WHERE platform=? AND platform_user_id=?").get(chatter.platform || "twitch", String(chatter.platformUserId))
        : db.prepare("SELECT id FROM viewer_identities WHERE platform=? AND lower(username)=?").get(chatter.platform || "twitch", String(chatter.username || "").toLowerCase())
      if (row) ids.push(row.id)
    }
    return ids
  }

  function online() {
    const since = now() - ONLINE_WINDOW_MS
    for (const [id, at] of web) if (at < since) web.delete(id)
    const where = new Map()
    for (const id of web.keys()) where.set(id, "web")
    for (const id of chatterIds()) where.set(id, where.has(id) ? "both" : "chat")
    const list = [...where.entries()]
      .map(([id, place]) => { const mini = profiles.miniOf(id); return mini && { ...mini, where: place } })
      .filter(Boolean)
      // Primero quien esta en la web (se puede abrir su perfil), luego por nivel.
      .sort((a, b) => Number(b.where !== "chat") - Number(a.where !== "chat") || b.level - a.level)
    return { total: list.length, list: list.slice(0, ONLINE_MAX) }
  }

  // ── Destacados de la semana ──
  function topBy(sql, params) {
    return db.prepare(sql).all(...params).map(row => {
      const mini = profiles.miniOf(row.viewer_id)
      return mini && { ...mini, value: row.n }
    }).filter(Boolean)
  }

  function highlights() {
    const channelId = activeChannel()
    const from = iso(now() - WEEK_MS)
    const sum = action => topBy(`SELECT viewer_id, SUM(amount) AS n FROM activity_log WHERE channel_id=? AND action=? AND created_at>=?
      GROUP BY viewer_id ORDER BY n DESC LIMIT ?`, [channelId, action, from, HIGHLIGHT_TOP])
    // Lo ganado (o perdido) en cada mano terminada: cobrado - apostado.
    const hikki = topBy(`SELECT viewer_id, SUM(CASE status WHEN 'cashed' THEN payout - bet ELSE -bet END) AS n FROM minigame_sessions
      WHERE channel_id=? AND game='blackjack' AND status IN ('cashed','lost') AND updated_at>=? GROUP BY viewer_id HAVING n>0 ORDER BY n DESC LIMIT ?`, [channelId, from, HIGHLIGHT_TOP])
    return [
      { id: "legendarios", title: "Legendarios de la semana", unit: "legendario", entries: sum("legendary") },
      { id: "hikki", title: "Pesadilla de Hikki", unit: "pts ganados", entries: hikki },
      { id: "niveles", title: "Subiendo como la espuma", unit: "nivel", entries: sum("levelup") },
    ]
  }

  function home() {
    return { ok: true, online: online(), highlights: highlights(), newcomers: profiles.newcomers() }
  }

  // ── Logros ──
  function statsFor(channelId, viewerId) {
    const stats = {}
    for (const row of db.prepare("SELECT stat, value FROM viewer_stats WHERE channel_id=? AND viewer_id=?").all(channelId, viewerId)) stats[row.stat] = row.value
    return stats
  }

  function unlockedFor(channelId, viewerId) {
    return new Map(db.prepare("SELECT achievement_id, unlocked_at FROM viewer_achievements WHERE channel_id=? AND viewer_id=?").all(channelId, viewerId)
      .map(row => [row.achievement_id, row.unlocked_at]))
  }

  function unlock(channelId, viewerId, ids, have) {
    const insert = db.prepare("INSERT OR IGNORE INTO viewer_achievements(channel_id, viewer_id, achievement_id, unlocked_at, seen) VALUES(?,?,?,?,0)")
    for (const id of ids) if (!have.has(id)) { insert.run(channelId, viewerId, id, iso()); have.set(id, iso()) }
  }

  // Evento del tablon En vivo (live-feed.js `subscribe`).
  function track(channelId, event) {
    if (!event || !event.viewerId) return
    const channel = String(channelId || activeChannel()).toLowerCase()
    const viewerId = event.viewerId
    const add = statsOf(event)
    db.transaction(() => {
      const upsert = db.prepare(`INSERT INTO viewer_stats(channel_id, viewer_id, stat, value) VALUES(?,?,?,?)
        ON CONFLICT(channel_id, viewer_id, stat) DO UPDATE SET value=value+excluded.value`)
      for (const [stat, value] of Object.entries(add)) upsert.run(channel, viewerId, stat, value)
      if (Object.keys(add).length) unlock(channel, viewerId, reached(statsFor(channel, viewerId)), unlockedFor(channel, viewerId))
    })()
  }

  // Lista de logros de un viewer. `own`: tambien los que faltan, con progreso.
  function achievementsOf(viewerId, { own = false } = {}) {
    const channelId = activeChannel()
    const stats = statsFor(channelId, viewerId)
    const facts = profiles.factsOf(viewerId)
    const have = unlockedFor(channelId, viewerId)
    unlock(channelId, viewerId, reached(stats, facts), have)
    const list = ACHIEVEMENTS
      .filter(item => own || have.has(item.id))
      .map(item => ({
        ...publicAchievement(item), unlocked: have.has(item.id), unlockedAt: have.get(item.id) || null,
        ...(own ? { progress: Math.min(item.goal, valueOf(item, stats, facts)), goal: item.goal } : {}),
      }))
      // Conseguidos primero (oro arriba); de los que faltan, los mas cerca de lograrse.
      .sort((a, b) => Number(b.unlocked) - Number(a.unlocked)
        || (a.unlocked ? TIER_ORDER[a.tier] - TIER_ORDER[b.tier] : own ? b.progress / b.goal - a.progress / a.goal : 0))
    return { unlocked: have.size, total: ACHIEVEMENTS.length, list }
  }

  function achievementsOfLogin(login) {
    const viewerId = profiles.viewerIdOf(login)
    return viewerId ? achievementsOf(viewerId) : null
  }

  // Logros nuevos que la pagina aun no ha ensenado (y se marcan como vistos).
  function takeFresh(twitchId) {
    const viewerId = viewerIdFromTwitch(twitchId)
    if (!viewerId) return []
    const channelId = activeChannel()
    const rows = db.prepare("SELECT achievement_id FROM viewer_achievements WHERE channel_id=? AND viewer_id=? AND seen=0 ORDER BY unlocked_at").all(channelId, viewerId)
    if (!rows.length) return []
    db.prepare("UPDATE viewer_achievements SET seen=1 WHERE channel_id=? AND viewer_id=? AND seen=0").run(channelId, viewerId)
    return rows.map(row => BY_ID.get(row.achievement_id)).filter(Boolean).map(publicAchievement)
  }

  return { seen, online, highlights, home, track, achievementsOf, achievementsOfLogin, takeFresh, viewerIdFromTwitch }
}

module.exports = { createCommunity, statsOf, ONLINE_WINDOW_MS }
