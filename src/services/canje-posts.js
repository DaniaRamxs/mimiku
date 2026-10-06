// services/canje-posts.js — Posts, Novedades y Buzon de la pagina de canje.
//
// - Solo la streamer (la cuenta de Twitch del canal) publica. Dos tipos:
//   "post" (pestana Posts) y "update" (Novedades, el registro de cambios que
//   se abre desde la cabecera). Cada uno es para todos o solo para subs: a
//   quien no es sub se le manda bloqueado, sin el texto ni la imagen.
// - Regalo opcional (p. ej. 100.000 pts) en cualquier publicacion: se reclama
//   desde el Buzon, una vez por persona, y solo si ya era de la comunidad al
//   publicarse (para que no se farmee con cuentas nuevas). Puede ser solo
//   para subs.
// - Buzon: las ultimas publicaciones; "sin leer" es lo publicado despues de
//   la ultima vez que lo abriste.
// - Vistas y likes guardados en la base de datos: una vista por persona (se
//   apunta cuando la publicacion sale en su pantalla) y un like por persona.
//   Lo bloqueado para no subs ni cuenta vista ni se puede likear.
// - Comentarios: los escribe quien puede ver la publicacion; cada uno borra
//   los suyos y la streamer borra cualquiera y puede silenciar a alguien.
const { randomUUID } = require("node:crypto")
const { isKnownBot } = require("../core/known-bots.js")

const KINDS = ["post", "update"]
const AUDIENCES = ["all", "subs"]
const TITLE_MAX = 120
const BODY_MAX = 4000
const IMAGE_MAX = 1000
const REWARD_MAX = 1_000_000
const PAGE = 30
const MAILBOX_SIZE = 40
const POSTS_PER_HOUR = 30
const KEY_PATTERN = /^[a-z0-9-]{8,64}$/i
const LIKES_PER_MINUTE = 40
const VIEWS_PER_CALL = 40
const COMMENT_MAX = 500
const COMMENTS_PAGE = 50
const COMMENTS_PER_MINUTE = 6
const COMMENT_GAP_MS = 5000

const MESSAGES = {
  "unknown-viewer": "Mimiku todavía no te conoce: escribe algo en el chat del canal.",
  "not-streamer": "Solo la streamer puede publicar.",
  "bad-request": "Revisa los datos de la publicación.",
  "no-post": "Esa publicación ya no existe.",
  "no-reward": "Esa publicación no tiene regalo.",
  claimed: "Ya reclamaste este regalo.",
  "subs-only": "Este regalo es solo para subs.",
  "too-new": "Este regalo era para quien ya estaba en la comunidad cuando se publicó.",
  "rate-limit": "Vas muy rápido, espera un poco.",
  locked: "Este post es solo para subs.",
  muted: "La streamer te ha silenciado: no puedes comentar.",
  bot: "Los bots no pueden comentar.",
  "empty-comment": "Escribe algo antes de enviar.",
  "no-comment": "Ese comentario ya no existe.",
  "not-yours": "Solo puedes borrar tus comentarios.",
  "bad-key": "Petición no válida. Recarga la página.",
}

function cleanText(value, max) { return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) }

// Imagen o GIF: https, o un archivo subido a Mimiku (/assets/...).
function cleanImage(value) {
  const text = String(value || "").trim()
  if (!text) return ""
  try {
    const url = new URL(text)
    return url.protocol === "https:" && text.length <= IMAGE_MAX ? url.toString() : null
  } catch {
    return null
  }
}

// "2026-10-05 12:00:00" (SQLite, UTC) o ISO -> milisegundos.
function timeOf(value) {
  const text = String(value || "")
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(" ", "T") + "Z" : text)
}

// `isSub(viewerRow)`: sub del canal; `isStreamer(login)`: la cuenta del canal.
// `nameStyleOf`: estilo de nombre equipado de un viewer (tienda de perfil).
function createCanjePosts({ platform, getChannel, now = Date.now, isSub = () => false, isStreamer = () => false, nameStyleOf = () => "" }) {
  const db = platform.db
  const recentPosts = []
  const recentLikes = new Map() // viewerId -> [tiempos]
  const recentComments = new Map() // viewerId -> [tiempos]

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }
  function iso(at = now()) { return new Date(at).toISOString() }

  function findViewer(twitchId) {
    return db.prepare("SELECT * FROM viewer_identities WHERE platform='twitch' AND platform_user_id=?").get(String(twitchId)) || null
  }

  function claimOf(postId, viewerId) {
    return db.prepare("SELECT * FROM canje_post_claims WHERE post_id=? AND viewer_id=?").get(postId, viewerId) || null
  }

  // Lo que puede ver este viewer de una publicacion.
  function view(row, viewer, { sub, streamer }) {
    const locked = row.audience === "subs" && !sub && !streamer
    const reward = row.reward_points > 0 ? rewardView(row, viewer, sub) : null
    return {
      id: row.id, kind: row.kind, audience: row.audience, locked, publishedAt: row.published_at,
      title: locked && row.kind === "post" ? "" : row.title,
      body: locked ? "" : row.body,
      image: locked ? "" : row.image_url,
      reward,
      ...stats(row.id, viewer),
    }
  }

  function stats(postId, viewer) {
    const views = db.prepare("SELECT COUNT(*) AS n FROM canje_post_views WHERE post_id=?").get(postId).n
    const likes = db.prepare("SELECT COUNT(*) AS n FROM canje_post_likes WHERE post_id=?").get(postId).n
    const liked = !!(viewer && db.prepare("SELECT 1 FROM canje_post_likes WHERE post_id=? AND viewer_id=?").get(postId, viewer.id))
    const comments = db.prepare("SELECT COUNT(*) AS n FROM canje_post_comments WHERE post_id=? AND deleted_at IS NULL").get(postId).n
    return { views, likes, liked, comments }
  }

  function visiblePost(postId) {
    return db.prepare("SELECT * FROM canje_posts WHERE id=? AND channel_id=? AND deleted_at IS NULL").get(String(postId || ""), activeChannel()) || null
  }

  function canSee(row, me) { return row.audience !== "subs" || me.sub || me.streamer }

  // Vistas: la pagina manda los ids que han salido en pantalla (una por persona).
  function recordViews(twitchId, login, ids) {
    const me = who(twitchId, login)
    if (!me.viewer) return { ok: false, reason: "unknown-viewer" }
    if (!Array.isArray(ids)) return { ok: false, reason: "bad-request" }
    const insert = db.prepare("INSERT OR IGNORE INTO canje_post_views(post_id, viewer_id, viewed_at) VALUES(?,?,?)")
    let counted = 0
    db.transaction(() => {
      for (const id of [...new Set(ids.map(String))].slice(0, VIEWS_PER_CALL)) {
        const row = visiblePost(id)
        if (row && canSee(row, me)) counted += insert.run(row.id, me.viewer.id, iso()).changes
      }
    })()
    return { ok: true, counted }
  }

  // Like: un toque lo pone y otro lo quita.
  function toggleLike(twitchId, login, postId) {
    const me = who(twitchId, login)
    if (!me.viewer) return { ok: false, reason: "unknown-viewer" }
    const row = visiblePost(postId)
    if (!row) return { ok: false, reason: "no-post" }
    if (!canSee(row, me)) return { ok: false, reason: "locked" }
    const since = now() - 60_000
    const times = (recentLikes.get(me.viewer.id) || []).filter(time => time > since)
    if (times.length >= LIKES_PER_MINUTE) return { ok: false, reason: "rate-limit" }
    recentLikes.set(me.viewer.id, [...times, now()])
    const removed = db.prepare("DELETE FROM canje_post_likes WHERE post_id=? AND viewer_id=?").run(row.id, me.viewer.id).changes
    if (!removed) db.prepare("INSERT OR IGNORE INTO canje_post_likes(post_id, viewer_id, liked_at) VALUES(?,?,?)").run(row.id, me.viewer.id, iso())
    return { ok: true, ...stats(row.id, me.viewer) }
  }

  function rewardView(row, viewer, sub) {
    const claim = viewer ? claimOf(row.id, viewer.id) : null
    let reason = ""
    if (claim) reason = "claimed"
    else if (!viewer) reason = "unknown-viewer"
    else if (row.reward_audience === "subs" && !sub) reason = "subs-only"
    else if (timeOf(viewer.created_at) > timeOf(row.published_at)) reason = "too-new"
    return { points: row.reward_points, audience: row.reward_audience, claimed: !!claim, canClaim: !reason, reason }
  }

  function who(twitchId, login) {
    const viewer = findViewer(twitchId)
    return { viewer, sub: !!(viewer && isSub(viewer)), streamer: !!isStreamer(login) }
  }

  function rows(kind, limit, before = null) {
    return db.prepare(`SELECT * FROM canje_posts WHERE channel_id=? AND deleted_at IS NULL ${kind ? "AND kind=?" : ""} ${before ? "AND published_at<?" : ""}
      ORDER BY published_at DESC LIMIT ?`).all(...[activeChannel(), ...(kind ? [kind] : []), ...(before ? [before] : []), limit])
  }

  // ── Leer ──
  function list(twitchId, login, kind, before) {
    if (!KINDS.includes(kind)) return { ok: false, reason: "bad-request" }
    const me = who(twitchId, login)
    const found = rows(kind, PAGE + 1, before ? String(before).slice(0, 40) : null)
    return { ok: true, isStreamer: me.streamer, isSub: me.sub, items: found.slice(0, PAGE).map(row => view(row, me.viewer, me)), hasMore: found.length > PAGE }
  }

  function seenAt(viewerId) {
    return db.prepare("SELECT seen_at FROM viewer_mailbox WHERE channel_id=? AND viewer_id=?").get(activeChannel(), viewerId)?.seen_at || null
  }

  // Resumen para la cabecera (va en /api/state): sin leer y regalos por reclamar.
  function summary(twitchId, login) {
    const me = who(twitchId, login)
    if (!me.viewer) return { unread: 0, claimable: 0, newUpdates: 0 }
    const since = seenAt(me.viewer.id) || me.viewer.created_at
    const recent = rows(null, MAILBOX_SIZE)
    const unread = recent.filter(row => timeOf(row.published_at) > timeOf(since)).length
    const claimable = recent.filter(row => row.reward_points > 0 && rewardView(row, me.viewer, me.sub).canClaim).length
    return { unread, claimable, newUpdates: recent.filter(row => row.kind === "update" && timeOf(row.published_at) > timeOf(since)).length }
  }

  function mailbox(twitchId, login) {
    const me = who(twitchId, login)
    if (!me.viewer) return { ok: false, reason: "unknown-viewer" }
    const since = seenAt(me.viewer.id) || me.viewer.created_at
    const items = rows(null, MAILBOX_SIZE).map(row => ({ ...view(row, me.viewer, me), unread: timeOf(row.published_at) > timeOf(since) }))
    return { ok: true, items, ...summary(twitchId, login) }
  }

  function markSeen(twitchId) {
    const viewer = findViewer(twitchId)
    if (!viewer) return { ok: false, reason: "unknown-viewer" }
    db.prepare(`INSERT INTO viewer_mailbox(channel_id, viewer_id, seen_at) VALUES(?,?,?)
      ON CONFLICT(channel_id, viewer_id) DO UPDATE SET seen_at=excluded.seen_at`).run(activeChannel(), viewer.id, iso())
    return { ok: true }
  }

  // ── Reclamar el regalo ──
  function claim(twitchId, login, postId) {
    const me = who(twitchId, login)
    if (!me.viewer) return { ok: false, reason: "unknown-viewer" }
    const row = db.prepare("SELECT * FROM canje_posts WHERE id=? AND channel_id=? AND deleted_at IS NULL").get(String(postId || ""), activeChannel())
    if (!row) return { ok: false, reason: "no-post" }
    if (!(row.reward_points > 0)) return { ok: false, reason: "no-reward" }
    const reward = rewardView(row, me.viewer, me.sub)
    if (!reward.canClaim) return { ok: false, reason: reward.reason }
    const channelId = activeChannel()
    const label = row.kind === "update" ? "Regalo de novedades" : "Regalo de un post"
    const done = db.transaction(() => {
      const inserted = db.prepare("INSERT OR IGNORE INTO canje_post_claims(channel_id, post_id, viewer_id, points, claimed_at) VALUES(?,?,?,?,?)")
        .run(channelId, row.id, me.viewer.id, row.reward_points, iso()).changes
      if (!inserted) return false
      platform.economy.applyMovement({
        channelId, viewerId: me.viewer.id, balanceDelta: row.reward_points, idempotencyKey: `buzon:${row.id}:${me.viewer.id}`,
        reason: `${label}: ${row.title || "sin título"}`.slice(0, 120), sourceType: "post", sourceId: row.id,
      })
      return true
    })()
    if (!done) return { ok: false, reason: "claimed" }
    return { ok: true, points: row.reward_points, balance: platform.economy.getBalance(channelId, me.viewer.id).balance }
  }

  // ── Publicar (solo la streamer) ──
  function underLimit() {
    const since = now() - 3_600_000
    while (recentPosts.length && recentPosts[0] < since) recentPosts.shift()
    if (recentPosts.length >= POSTS_PER_HOUR) return false
    recentPosts.push(now())
    return true
  }

  function create(twitchId, login, input = {}) {
    if (!isStreamer(login)) return { ok: false, reason: "not-streamer" }
    const kind = KINDS.includes(input.kind) ? input.kind : null
    const audience = AUDIENCES.includes(input.audience) ? input.audience : "all"
    const rewardAudience = AUDIENCES.includes(input.rewardAudience) ? input.rewardAudience : "all"
    const title = cleanText(input.title, TITLE_MAX)
    const body = cleanText(input.body, BODY_MAX)
    const image = cleanImage(input.image)
    const reward = Number(input.reward || 0)
    if (!kind || image === null || !Number.isInteger(reward) || reward < 0 || reward > REWARD_MAX) return { ok: false, reason: "bad-request" }
    if (!body && !image) return { ok: false, reason: "bad-request" }
    if (kind === "update" && !title) return { ok: false, reason: "bad-request" }
    if (!KEY_PATTERN.test(String(input.key || ""))) return { ok: false, reason: "bad-key" }
    // Reintento con la misma clave: devuelve la misma publicacion.
    const existing = db.prepare("SELECT * FROM canje_posts WHERE channel_id=? AND request_key=?").get(activeChannel(), `${twitchId}:${input.key}`)
    if (existing) return { ok: true, item: view(existing, findViewer(twitchId), { sub: true, streamer: true }) }
    if (!underLimit()) return { ok: false, reason: "rate-limit" }
    const id = randomUUID()
    db.prepare(`INSERT INTO canje_posts(id, channel_id, kind, title, body, image_url, audience, reward_points, reward_audience, author, request_key, published_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, activeChannel(), kind, title, body, image, audience, reward, rewardAudience, String(login || ""), `${twitchId}:${input.key}`, iso())
    const row = db.prepare("SELECT * FROM canje_posts WHERE id=?").get(id)
    return { ok: true, item: view(row, findViewer(twitchId), { sub: true, streamer: true }) }
  }

  // Borrar: deja de verse; los regalos ya reclamados se quedan.
  function remove(login, postId) {
    if (!isStreamer(login)) return { ok: false, reason: "not-streamer" }
    const changed = db.prepare("UPDATE canje_posts SET deleted_at=? WHERE id=? AND channel_id=? AND deleted_at IS NULL").run(iso(), String(postId || ""), activeChannel()).changes
    return changed ? { ok: true } : { ok: false, reason: "no-post" }
  }

  // ── Comentarios ──
  // Comenta quien puede ver la publicacion (lo bloqueado para no subs, no).
  // Cada uno borra los suyos; la streamer borra cualquiera y puede silenciar
  // a alguien (deja de poder comentar en todo hasta que lo quite).
  function isMuted(viewerId) {
    return !!db.prepare("SELECT 1 FROM canje_comment_mutes WHERE channel_id=? AND viewer_id=?").get(activeChannel(), viewerId)
  }

  function commentReason(row, me) {
    if (!me.viewer) return "unknown-viewer"
    if (!canSee(row, me)) return "locked"
    if (isKnownBot(me.viewer.username)) return "bot"
    if (!me.streamer && isMuted(me.viewer.id)) return "muted"
    return ""
  }

  function commentView(comment, me, streamerLogin) {
    const author = db.prepare("SELECT id, username, display, avatar_url FROM viewer_identities WHERE id=?").get(comment.viewer_id) || {}
    const mine = !!me.viewer && comment.viewer_id === me.viewer.id
    return {
      id: comment.id, body: comment.body, createdAt: comment.created_at, mine,
      author: {
        login: author.username || "", display: author.display || author.username || "?", nameStyle: author.id ? nameStyleOf(author.id) : "",
        avatar: /^https:\/\//.test(author.avatar_url || "") ? author.avatar_url : null,
        streamer: !!author.username && author.username.toLowerCase() === streamerLogin,
        muted: me.streamer ? isMuted(comment.viewer_id) : undefined,
      },
      canDelete: mine || me.streamer,
      canMute: me.streamer && !mine,
    }
  }

  function comments(twitchId, login, postId, before) {
    const me = who(twitchId, login)
    const row = visiblePost(postId)
    if (!row) return { ok: false, reason: "no-post" }
    if (!canSee(row, me)) return { ok: false, reason: "locked" }
    const params = [row.id]
    if (before) params.push(String(before).slice(0, 40))
    const found = db.prepare(`SELECT * FROM canje_post_comments WHERE post_id=? AND deleted_at IS NULL ${before ? "AND created_at<?" : ""}
      ORDER BY created_at DESC LIMIT ?`).all(...params, COMMENTS_PAGE + 1)
    const streamerLogin = String(row.author || "").toLowerCase()
    const reason = commentReason(row, me)
    return {
      ok: true, items: found.slice(0, COMMENTS_PAGE).reverse().map(comment => commentView(comment, me, streamerLogin)),
      hasMore: found.length > COMMENTS_PAGE, canComment: !reason, reason,
    }
  }

  function underCommentLimit(viewerId) {
    const since = now() - 60_000
    const times = (recentComments.get(viewerId) || []).filter(time => time > since)
    if (times.length >= COMMENTS_PER_MINUTE || (times.length && now() - times[times.length - 1] < COMMENT_GAP_MS)) {
      recentComments.set(viewerId, times)
      return false
    }
    recentComments.set(viewerId, [...times, now()])
    return true
  }

  function addComment(twitchId, login, postId, input = {}) {
    const me = who(twitchId, login)
    const row = visiblePost(postId)
    if (!row) return { ok: false, reason: "no-post" }
    const reason = commentReason(row, me)
    if (reason) return { ok: false, reason }
    const body = cleanText(input.body, COMMENT_MAX).replace(/\n{3,}/g, "\n\n")
    if (!body) return { ok: false, reason: "empty-comment" }
    if (!KEY_PATTERN.test(String(input.key || ""))) return { ok: false, reason: "bad-key" }
    const requestKey = `${twitchId}:${input.key}`
    const existing = db.prepare("SELECT * FROM canje_post_comments WHERE request_key=?").get(requestKey)
    if (existing) return { ok: true, item: commentView(existing, me, String(row.author || "").toLowerCase()) }
    if (!underCommentLimit(me.viewer.id)) return { ok: false, reason: "rate-limit" }
    const id = randomUUID()
    db.prepare("INSERT INTO canje_post_comments(id, post_id, channel_id, viewer_id, body, request_key, created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, row.id, activeChannel(), me.viewer.id, body, requestKey, iso())
    const comment = db.prepare("SELECT * FROM canje_post_comments WHERE id=?").get(id)
    return { ok: true, item: commentView(comment, me, String(row.author || "").toLowerCase()), ...stats(row.id, me.viewer) }
  }

  function deleteComment(twitchId, login, commentId) {
    const me = who(twitchId, login)
    const comment = db.prepare("SELECT * FROM canje_post_comments WHERE id=? AND channel_id=? AND deleted_at IS NULL").get(String(commentId || ""), activeChannel())
    if (!comment) return { ok: false, reason: "no-comment" }
    const mine = !!me.viewer && comment.viewer_id === me.viewer.id
    if (!mine && !me.streamer) return { ok: false, reason: "not-yours" }
    db.prepare("UPDATE canje_post_comments SET deleted_at=?, deleted_by=? WHERE id=?").run(iso(), mine ? "author" : "streamer", comment.id)
    return { ok: true, ...stats(comment.post_id, me.viewer) }
  }

  // Silenciar o no a quien escribio un comentario (solo la streamer).
  function muteAuthor(twitchId, login, commentId, muted) {
    if (!isStreamer(login)) return { ok: false, reason: "not-streamer" }
    const comment = db.prepare("SELECT * FROM canje_post_comments WHERE id=? AND channel_id=?").get(String(commentId || ""), activeChannel())
    if (!comment) return { ok: false, reason: "no-comment" }
    if (muted) {
      db.prepare("INSERT OR IGNORE INTO canje_comment_mutes(channel_id, viewer_id, muted_at) VALUES(?,?,?)").run(activeChannel(), comment.viewer_id, iso())
    } else {
      db.prepare("DELETE FROM canje_comment_mutes WHERE channel_id=? AND viewer_id=?").run(activeChannel(), comment.viewer_id)
    }
    return { ok: true, muted: !!muted }
  }

  return { list, summary, mailbox, markSeen, claim, create, remove, recordViews, toggleLike, comments, addComment, deleteComment, muteAuthor }
}

const POSTS_ROUTES = {
  "/api/posts": "GET",
  "/api/posts/create": "POST",
  "/api/posts/delete": "POST",
  "/api/posts/like": "POST",
  "/api/posts/view": "POST",
  "/api/posts/comments": "GET",
  "/api/posts/comment": "POST",
  "/api/posts/comment/delete": "POST",
  "/api/posts/comment/mute": "POST",
  "/api/mailbox": "GET",
  "/api/mailbox/seen": "POST",
  "/api/mailbox/claim": "POST",
}

// Atiende una ruta de POSTS_ROUTES ya autenticada. Devuelve [status, json].
async function handlePostsApi({ pathname, url, readJson, user, posts }) {
  const reply = result => {
    if (result.ok) return [200, result]
    const status = result.reason === "not-streamer" || result.reason === "not-yours" ? 403 : result.reason === "no-post" || result.reason === "no-comment" ? 404 : result.reason === "rate-limit" ? 429 : result.reason === "bad-request" || result.reason === "bad-key" ? 400 : 409
    return [status, { error: MESSAGES[result.reason] || "No se pudo completar." }]
  }
  if (pathname === "/api/posts") return reply(posts.list(user.twitchId, user.login, url.searchParams.get("kind") || "post", url.searchParams.get("before")))
  if (pathname === "/api/mailbox") return reply(posts.mailbox(user.twitchId, user.login))
  if (pathname === "/api/posts/comments") return reply(posts.comments(user.twitchId, user.login, url.searchParams.get("id"), url.searchParams.get("before")))
  const body = await readJson()
  if (pathname === "/api/posts/create") return reply(posts.create(user.twitchId, user.login, body))
  if (pathname === "/api/posts/delete") return reply(posts.remove(user.login, body.id))
  if (pathname === "/api/posts/like") return reply(posts.toggleLike(user.twitchId, user.login, body.id))
  if (pathname === "/api/posts/view") return reply(posts.recordViews(user.twitchId, user.login, body.ids))
  if (pathname === "/api/posts/comment") return reply(posts.addComment(user.twitchId, user.login, body.id, body))
  if (pathname === "/api/posts/comment/delete") return reply(posts.deleteComment(user.twitchId, user.login, body.commentId))
  if (pathname === "/api/posts/comment/mute") return reply(posts.muteAuthor(user.twitchId, user.login, body.commentId, !!body.muted))
  if (pathname === "/api/mailbox/seen") return reply(posts.markSeen(user.twitchId))
  if (pathname === "/api/mailbox/claim") return reply(posts.claim(user.twitchId, user.login, body.id))
  return [404, { error: "No encontrado" }]
}

module.exports = { createCanjePosts, handlePostsApi, POSTS_ROUTES, MESSAGES, REWARD_MAX, timeOf }
