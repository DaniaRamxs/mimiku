// Posts, Novedades y Buzon de la pagina de canje.
// - Novedades (boton de la cabecera, fuera de las pestanas): registro de
//   actualizaciones; cada una puede traer un regalo de puntos.
// - Posts (pestana): lo que publica la streamer, para todos o solo subs; a
//   quien no es sub le sale bloqueado.
// - Buzon (sobre de la cabecera): lo ultimo publicado y los regalos por
//   reclamar. Solo la streamer ve el formulario para publicar.
// Datos: /api/posts, /api/posts/create|delete, /api/mailbox, /api/mailbox/seen|claim.
(function () {
  "use strict"

  var REWARD_PRESETS = [10000, 50000, 100000]
  var REASONS = {
    claimed: "Reclamado",
    "subs-only": "Solo para subs",
    "too-new": "Llegaste después de publicarse",
    "unknown-viewer": "",
  }

  var isStreamer = false
  var postsLoaded = false
  var postsOldest = null
  var drawerMode = null
  var lastSummary = { unread: 0, claimable: 0, newUpdates: 0 }
  var VIEW_FLUSH_MS = 1500
  var SVG_NS = "http://www.w3.org/2000/svg"
  var EYE = "M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z"
  var BUBBLE = "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
  var COMMENT_REASONS = { locked: "Solo los subs pueden comentar aquí.", muted: "La streamer te ha silenciado: no puedes comentar.", bot: "", "unknown-viewer": "" }
  var HEART = "M12 21C5 15.5 2 12.3 2 8.5A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 10 2.5c0 3.8-3 7-10 12.5z"
  var pendingViews = {}
  var viewTimer = null
  var seenOnce = {}
  var viewObserver = null

  function $(id) { return document.getElementById(id) }
  function app() { return window.CanjeApp }
  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }
  function fmt(value) { return Number(value || 0).toLocaleString("es") }
  function sound(name) { try { if (window.SoundKit) window.SoundKit.play(name) } catch (error) { /* sin sonido */ } }

  function ago(iso) {
    var seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
    if (seconds < 60) return "ahora mismo"
    var minutes = Math.round(seconds / 60)
    if (minutes < 60) return "hace " + minutes + " min"
    var hours = Math.round(minutes / 60)
    if (hours < 24) return "hace " + hours + " h"
    var days = Math.round(hours / 24)
    if (days < 7) return days === 1 ? "ayer" : "hace " + days + " días"
    return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })
  }

  function channelName() { return ($("channel-name") && $("channel-name").textContent) || "el canal" }
  function subUrl() { return "https://www.twitch.tv/subs/" + encodeURIComponent(channelName().toLowerCase()) }

  // ── Publicacion ─────────────────────────────────────────────────────────────
  function rewardBox(item, onClaimed) {
    var reward = item.reward
    var box = el("div", "ps-reward" + (reward.claimed ? " is-claimed" : reward.canClaim ? " is-ready" : " is-blocked"))
    var text = el("div", "ps-reward-text")
    text.appendChild(el("span", "ps-reward-kicker", reward.audience === "subs" ? "Regalo para subs" : "Regalo para todos"))
    text.appendChild(el("strong", "ps-reward-amount", fmt(reward.points) + " pts"))
    box.appendChild(el("span", "ps-gift", ""))
    box.appendChild(text)
    if (reward.canClaim) {
      var button = el("button", "btn btn-buy ps-claim", "Reclamar")
      button.type = "button"
      button.addEventListener("click", function () { claim(item, button, box, onClaimed) })
      box.appendChild(button)
    } else {
      box.appendChild(el("span", "ps-reward-state", REASONS[reward.reason] || ""))
    }
    return box
  }

  function claim(item, button, box, onClaimed) {
    button.disabled = true
    button.textContent = "Reclamando…"
    app().api("/api/mailbox/claim", { method: "POST", body: { id: item.id } }).then(function (result) {
      item.reward.claimed = true
      item.reward.canClaim = false
      item.reward.reason = "claimed"
      var rect = button.getBoundingClientRect()
      box.replaceWith(rewardBox(item, onClaimed))
      sound("coins")
      if (window.GameKit && window.GameKit.celebrate) {
        window.GameKit.celebrate("coins", "#fbbf24", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, true)
      }
      app().toast("Recibiste " + fmt(result.points) + " pts")
      if (onClaimed) onClaimed()
      app().reload()
    }).catch(function (error) {
      app().toast(error.message)
      button.disabled = false
      button.textContent = "Reclamar"
    })
  }

  function lockedBody(item) {
    var box = el("div", "ps-locked")
    box.appendChild(el("span", "ps-lock", ""))
    box.appendChild(el("strong", "", item.kind === "update" ? "Novedad solo para subs" : "Post solo para subs"))
    box.appendChild(el("span", "ps-locked-text", "Suscríbete al canal para verlo."))
    var link = el("a", "btn btn-twitch ps-sub-link", "Suscribirme en Twitch")
    link.href = subUrl()
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    box.appendChild(link)
    return box
  }

  function itemNode(item, options) {
    options = options || {}
    var card = el("article", "ps-card is-" + item.kind + (item.locked ? " is-locked" : "") + (item.unread ? " is-unread" : ""))
    var head = el("header", "ps-head")
    head.appendChild(el("span", "ps-kind", item.kind === "update" ? "Novedad" : "Post"))
    if (item.audience === "subs") head.appendChild(el("span", "ps-badge is-subs", "Solo subs"))
    head.appendChild(el("time", "ps-time", ago(item.publishedAt)))
    if (isStreamer && options.deletable) {
      var remove = el("button", "ps-delete", "Borrar")
      remove.type = "button"
      remove.addEventListener("click", function () {
        if (!confirm("¿Borrar esta publicación? Los regalos ya reclamados se quedan.")) return
        app().api("/api/posts/delete", { method: "POST", body: { id: item.id } }).then(function () {
          card.remove()
          app().toast("Publicación borrada")
        }).catch(function (error) { app().toast(error.message) })
      })
      head.appendChild(remove)
    }
    card.appendChild(head)
    if (item.title) card.appendChild(el("h3", "ps-title", item.title))
    if (item.locked) {
      card.appendChild(lockedBody(item))
    } else {
      if (item.body) card.appendChild(el("p", "ps-body", item.body))
      if (item.image) {
        var img = document.createElement("img")
        img.className = "ps-image"
        img.src = item.image
        img.alt = ""
        img.loading = "lazy"
        img.referrerPolicy = "no-referrer"
        card.appendChild(img)
      }
    }
    if (item.reward) card.appendChild(rewardBox(item, options.onClaimed))
    card.appendChild(statsBar(item, card))
    watchView(card, item)
    return card
  }

  // ── Vistas y likes ──────────────────────────────────────────────────────────
  function icon(path, className) {
    var svg = document.createElementNS(SVG_NS, "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("class", className)
    svg.setAttribute("aria-hidden", "true")
    var shape = document.createElementNS(SVG_NS, "path")
    shape.setAttribute("d", path)
    svg.appendChild(shape)
    return svg
  }

  function countText(n, one, many) { return fmt(n) + " " + (n === 1 ? one : many) }

  function statsBar(item, card) {
    var bar = el("footer", "ps-stats")
    var views = el("span", "ps-views")
    views.appendChild(icon(EYE, "ps-icon"))
    var viewsText = el("span", "", countText(item.views || 0, "vista", "vistas"))
    views.appendChild(viewsText)
    bar.appendChild(views)
    var talk = el("button", "ps-talk")
    talk.type = "button"
    talk.disabled = !!item.locked
    talk.title = item.locked ? "Solo los subs pueden comentar" : "Comentarios"
    talk.setAttribute("aria-expanded", "false")
    talk.appendChild(icon(BUBBLE, "ps-icon"))
    var talkText = el("span", "", fmt(item.comments || 0))
    talk.appendChild(talkText)
    talk.addEventListener("click", function () { toggleComments(item, card, talk, talkText) })
    bar.appendChild(talk)
    var like = el("button", "ps-like" + (item.liked ? " is-liked" : ""))
    like.type = "button"
    like.disabled = !!item.locked
    like.title = item.locked ? "Solo los subs pueden darle like" : item.liked ? "Quitar like" : "Me gusta"
    like.setAttribute("aria-pressed", String(!!item.liked))
    like.appendChild(icon(HEART, "ps-icon"))
    var likesText = el("span", "", fmt(item.likes || 0))
    like.appendChild(likesText)
    like.addEventListener("click", function () { toggleLike(item, like, likesText) })
    bar.appendChild(like)
    return bar
  }

  // Se pinta al momento y se corrige con lo que diga el servidor.
  function toggleLike(item, button, text) {
    if (button.disabled) return
    var next = !item.liked
    paintLike(item, button, text, next, (item.likes || 0) + (next ? 1 : -1))
    if (next) sound("tap")
    button.disabled = true
    app().api("/api/posts/like", { method: "POST", body: { id: item.id } }).then(function (result) {
      paintLike(item, button, text, result.liked, result.likes)
    }).catch(function (error) {
      paintLike(item, button, text, !next, (item.likes || 0) + (next ? -1 : 1))
      app().toast(error.message)
    }).then(function () { button.disabled = false })
  }

  function paintLike(item, button, text, liked, likes) {
    item.liked = liked
    item.likes = Math.max(0, likes)
    button.classList.toggle("is-liked", liked)
    button.setAttribute("aria-pressed", String(liked))
    button.title = liked ? "Quitar like" : "Me gusta"
    text.textContent = fmt(item.likes)
    if (liked) {
      button.classList.remove("is-pop")
      void button.offsetWidth
      button.classList.add("is-pop")
    }
  }

  // ── Comentarios ─────────────────────────────────────────────────────────────
  function toggleComments(item, card, button, countText) {
    var open = card.querySelector(".ps-comments")
    if (open) {
      open.remove()
      button.setAttribute("aria-expanded", "false")
      return
    }
    button.setAttribute("aria-expanded", "true")
    var box = el("section", "ps-comments")
    box.setAttribute("aria-label", "Comentarios")
    var older = el("button", "ps-older", "Ver comentarios anteriores")
    older.type = "button"
    older.hidden = true
    var list = el("div", "ps-comment-list")
    var empty = el("p", "hint ps-comment-empty", "Todavía no hay comentarios. ¡Sé el primero!")
    var form = el("form", "ps-comment-form")
    var input = el("textarea", "ps-input ps-comment-input")
    input.rows = 1
    input.maxLength = 500
    input.placeholder = "Escribe un comentario…"
    var send = el("button", "btn btn-buy ps-comment-send", "Enviar")
    send.type = "submit"
    form.appendChild(input)
    form.appendChild(send)
    var note = el("p", "hint ps-comment-note", "")
    note.hidden = true
    box.appendChild(older)
    box.appendChild(list)
    box.appendChild(empty)
    box.appendChild(form)
    box.appendChild(note)
    card.appendChild(box)
    var oldest = null
    var setCount = function (n) { item.comments = n; countText.textContent = fmt(n) }

    function load(before) {
      return app().api("/api/posts/comments?id=" + encodeURIComponent(item.id) + (before ? "&before=" + encodeURIComponent(before) : "")).then(function (result) {
        var nodes = result.items.map(function (comment) { return commentNode(comment, item, list, setCount) })
        if (before) nodes.slice().reverse().forEach(function (node) { list.insertBefore(node, list.firstChild) })
        else nodes.forEach(function (node) { list.appendChild(node) })
        if (result.items.length) oldest = result.items[0].createdAt
        older.hidden = !result.hasMore
        empty.hidden = list.children.length > 0
        form.hidden = !result.canComment
        note.hidden = result.canComment || !COMMENT_REASONS[result.reason]
        note.textContent = COMMENT_REASONS[result.reason] || ""
        if (!before && result.canComment) input.focus({ preventScroll: true })
      }).catch(function (error) {
        note.hidden = false
        note.textContent = error.message
        form.hidden = true
      })
    }

    older.addEventListener("click", function () { load(oldest) })
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit() }
    })
    input.addEventListener("input", function () {
      input.style.setProperty("height", "auto")
      input.style.setProperty("height", Math.min(140, input.scrollHeight) + "px")
    })
    form.addEventListener("submit", function (event) {
      event.preventDefault()
      var text = input.value.trim()
      if (!text || send.disabled) return
      send.disabled = true
      app().api("/api/posts/comment", { method: "POST", body: { id: item.id, body: text, key: app().randomKey() } }).then(function (result) {
        input.value = ""
        input.style.removeProperty("height")
        var node = commentNode(result.item, item, list, setCount)
        node.classList.add("is-new")
        list.appendChild(node)
        empty.hidden = true
        if (typeof result.comments === "number") setCount(result.comments)
        sound("tap")
      }).catch(function (error) { app().toast(error.message) }).then(function () { send.disabled = false })
    })
    load(null)
  }

  function commentNode(comment, item, list, setCount) {
    var node = el("article", "ps-comment" + (comment.author.streamer ? " is-streamer" : "") + (comment.mine ? " is-mine" : ""))
    var face = el("span", "ps-comment-face")
    if (comment.author.avatar) {
      var img = document.createElement("img")
      img.src = comment.author.avatar
      img.alt = ""
      img.loading = "lazy"
      img.referrerPolicy = "no-referrer"
      face.appendChild(img)
    } else {
      face.textContent = (comment.author.display || "?").charAt(0).toUpperCase()
    }
    node.appendChild(face)
    var main = el("div", "ps-comment-main")
    var head = el("div", "ps-comment-head")
    var name = el("button", "ps-comment-name", comment.author.display)
    name.type = "button"
    name.title = "Ver su perfil"
    name.addEventListener("click", function () {
      if (!comment.author.login || !window.CommunityUI) return
      if (document.getElementById("drawer").open) closeDrawer()
      app().selectTab("community")
      window.CommunityUI.open(comment.author.login)
    })
    head.appendChild(name)
    if (comment.author.streamer) head.appendChild(el("span", "ps-badge is-streamer", "Streamer"))
    if (comment.author.muted) head.appendChild(el("span", "ps-badge is-muted", "Silenciado"))
    head.appendChild(el("time", "ps-time", ago(comment.createdAt)))
    main.appendChild(head)
    main.appendChild(el("p", "ps-comment-body", comment.body))
    var actions = el("div", "ps-comment-actions")
    if (comment.canDelete) {
      var remove = el("button", "ps-mini-action", "Borrar")
      remove.type = "button"
      remove.addEventListener("click", function () {
        if (!confirm(comment.mine ? "¿Borrar tu comentario?" : "¿Borrar este comentario de " + comment.author.display + "?")) return
        app().api("/api/posts/comment/delete", { method: "POST", body: { commentId: comment.id } }).then(function (result) {
          node.remove()
          if (typeof result.comments === "number") setCount(result.comments)
          var empty = list.parentElement && list.parentElement.querySelector(".ps-comment-empty")
          if (empty) empty.hidden = list.children.length > 0
        }).catch(function (error) { app().toast(error.message) })
      })
      actions.appendChild(remove)
    }
    if (comment.canMute) {
      var mute = el("button", "ps-mini-action is-danger", comment.author.muted ? "Quitar silencio" : "Silenciar")
      mute.type = "button"
      mute.addEventListener("click", function () {
        var next = !comment.author.muted
        if (next && !confirm("¿Silenciar a " + comment.author.display + "? No podrá comentar en ningún post hasta que se lo quites.")) return
        app().api("/api/posts/comment/mute", { method: "POST", body: { commentId: comment.id, muted: next } }).then(function () {
          comment.author.muted = next
          app().toast(next ? comment.author.display + " ya no puede comentar" : comment.author.display + " puede volver a comentar")
          node.replaceWith(commentNode(comment, item, list, setCount))
        }).catch(function (error) { app().toast(error.message) })
      })
      actions.appendChild(mute)
    }
    if (actions.children.length) main.appendChild(actions)
    node.appendChild(main)
    return node
  }

  // La vista se apunta cuando al menos media publicacion sale en pantalla.
  function watchView(card, item) {
    if (item.locked || seenOnce[item.id]) return
    if (!("IntersectionObserver" in window)) { queueView(item); return }
    if (!viewObserver) {
      viewObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || !entry.target._item) return
          viewObserver.unobserve(entry.target)
          queueView(entry.target._item)
        })
      }, { threshold: 0.5 })
    }
    card._item = item
    viewObserver.observe(card)
  }

  function queueView(item) {
    if (seenOnce[item.id]) return
    seenOnce[item.id] = true
    pendingViews[item.id] = item
    clearTimeout(viewTimer)
    viewTimer = setTimeout(flushViews, VIEW_FLUSH_MS)
  }

  function flushViews() {
    var items = Object.keys(pendingViews).map(function (id) { return pendingViews[id] })
    pendingViews = {}
    if (!items.length) return
    app().api("/api/posts/view", { method: "POST", body: { ids: items.map(function (item) { return item.id }) } })
      .catch(function () { /* las vistas son un extra: si falla, se apunta la proxima vez */ })
  }

  // ── Formulario (solo la streamer) ───────────────────────────────────────────
  function composer(kind, onDone) {
    var form = el("form", "ps-compose")
    form.setAttribute("novalidate", "")
    form.appendChild(el("p", "ps-compose-kicker", kind === "update" ? "Nueva novedad" : "Nuevo post"))
    var title = el("input", "ps-input")
    title.type = "text"
    title.maxLength = 120
    title.placeholder = kind === "update" ? "Título (por ejemplo: Llega el Blackjack contra Hikki)" : "Título (opcional)"
    form.appendChild(title)
    var body = el("textarea", "ps-input ps-textarea")
    body.maxLength = 4000
    body.rows = 4
    body.placeholder = kind === "update" ? "Qué hay de nuevo…" : "Escribe algo para tu comunidad…"
    form.appendChild(body)
    var image = el("input", "ps-input")
    image.type = "url"
    image.placeholder = "Imagen o GIF (enlace https, opcional)"
    form.appendChild(image)

    var row = el("div", "ps-compose-row")
    var audience = toggle([["all", "Para todos"], ["subs", "Solo subs"]], "all")
    row.appendChild(labelled("Quién lo ve", audience.node))
    form.appendChild(row)

    var giftRow = el("div", "ps-compose-row")
    var amounts = [["0", "Sin regalo"]].concat(REWARD_PRESETS.map(function (value) { return [String(value), fmt(value)] }))
    var amount = toggle(amounts, kind === "update" ? "100000" : "0")
    var custom = el("input", "ps-input ps-custom")
    custom.type = "number"
    custom.min = "0"
    custom.max = "1000000"
    custom.step = "1000"
    custom.placeholder = "Otra cantidad"
    custom.addEventListener("input", function () { amount.set(custom.value ? "" : "0") })
    var amountBox = el("div", "ps-amounts")
    amountBox.appendChild(amount.node)
    amountBox.appendChild(custom)
    giftRow.appendChild(labelled("Regalo de puntos (se reclama en el Buzón)", amountBox))
    var giftAudience = toggle([["all", "Para todos"], ["subs", "Solo subs"]], "all")
    giftRow.appendChild(labelled("Quién lo reclama", giftAudience.node))
    form.appendChild(giftRow)
    form.appendChild(el("p", "hint ps-hint", "El regalo lo puede reclamar cada persona una vez, si ya estaba en la comunidad cuando lo publicas (así no se farmea con cuentas nuevas)."))

    var publish = el("button", "btn btn-buy ps-publish", kind === "update" ? "Publicar novedad" : "Publicar post")
    publish.type = "submit"
    form.appendChild(publish)
    form.addEventListener("submit", function (event) {
      event.preventDefault()
      var reward = custom.value ? Math.round(Number(custom.value)) : Number(amount.value())
      if (!(reward >= 0 && reward <= 1000000)) { app().toast("El regalo va de 0 a 1.000.000 pts"); return }
      if (kind === "update" && !title.value.trim()) { app().toast("Ponle un título a la novedad"); return }
      if (!body.value.trim() && !image.value.trim()) { app().toast("Escribe algo o pon una imagen"); return }
      if (reward && !confirm("Cada persona de la comunidad podrá reclamar " + fmt(reward) + " pts" + (giftAudience.value() === "subs" ? " (solo subs)" : "") + ". ¿Publicar?")) return
      publish.disabled = true
      app().api("/api/posts/create", { method: "POST", body: {
        kind: kind, title: title.value, body: body.value, image: image.value.trim(),
        audience: audience.value(), reward: reward, rewardAudience: giftAudience.value(), key: app().randomKey(),
      } }).then(function () {
        title.value = ""
        body.value = ""
        image.value = ""
        custom.value = ""
        audience.set("all")
        giftAudience.set("all")
        amount.set(kind === "update" ? "100000" : "0")
        sound("chime")
        app().toast(kind === "update" ? "Novedad publicada" : "Post publicado")
        onDone()
      }).catch(function (error) { app().toast(error.message) }).then(function () { publish.disabled = false })
    })
    return form
  }

  function labelled(text, node) {
    var box = el("div", "ps-field")
    box.appendChild(el("span", "ps-label", text))
    box.appendChild(node)
    return box
  }

  // Botones de opcion (uno elegido).
  function toggle(options, initial) {
    var current = initial
    var node = el("div", "ps-toggle")
    node.setAttribute("role", "group")
    var buttons = options.map(function (option) {
      var button = el("button", "ps-chip", option[1])
      button.type = "button"
      button.addEventListener("click", function () { set(option[0]) })
      node.appendChild(button)
      return [option[0], button]
    })
    function set(value) {
      current = value
      buttons.forEach(function (pair) { pair[1].setAttribute("aria-pressed", String(pair[0] === value)) })
    }
    set(initial)
    return { node: node, value: function () { return current }, set: set }
  }

  // ── Pestana Posts ───────────────────────────────────────────────────────────
  function loadPosts(reset) {
    var feed = $("posts-feed")
    var query = "/api/posts?kind=post" + (!reset && postsOldest ? "&before=" + encodeURIComponent(postsOldest) : "")
    $("posts-more").hidden = true
    return app().api(query).then(function (result) {
      isStreamer = result.isStreamer
      paintComposer()
      if (reset) feed.textContent = ""
      result.items.forEach(function (item) { feed.appendChild(itemNode(item, { deletable: true })) })
      if (result.items.length) postsOldest = result.items[result.items.length - 1].publishedAt
      $("posts-empty").hidden = feed.children.length > 0
      $("posts-more").hidden = !result.hasMore
      postsLoaded = true
    }).catch(function (error) { app().toast(error.message) })
  }

  function paintComposer() {
    var box = $("posts-compose")
    if (!isStreamer) { box.hidden = true; return }
    if (!box.children.length) box.appendChild(composer("post", function () { loadPosts(true) }))
    box.hidden = false
  }

  // ── Cajon lateral: Novedades y Buzon ────────────────────────────────────────
  function openDrawer(mode) {
    drawerMode = mode
    $("drawer-title").textContent = mode === "news" ? "Novedades" : "Buzón"
    $("drawer-body").textContent = ""
    $("drawer-body").appendChild(el("p", "hint", "Cargando…"))
    var dialog = $("drawer")
    if (!dialog.open) dialog.showModal()
    requestAnimationFrame(function () { dialog.classList.add("is-open") })
    return mode === "news" ? loadNews() : loadMailbox()
  }

  function closeDrawer() {
    var dialog = $("drawer")
    dialog.classList.remove("is-open")
    setTimeout(function () { if (dialog.open) dialog.close() }, 220)
    drawerMode = null
  }

  function loadNews() {
    return app().api("/api/posts?kind=update").then(function (result) {
      isStreamer = result.isStreamer
      var body = $("drawer-body")
      body.textContent = ""
      if (isStreamer) body.appendChild(composer("update", loadNews))
      if (!result.items.length) body.appendChild(el("p", "hint ps-empty", "Todavía no hay novedades."))
      var list = el("div", "ps-timeline")
      result.items.forEach(function (item) { list.appendChild(itemNode(item, { deletable: true, onClaimed: refreshSummary })) })
      body.appendChild(list)
      // Abrir las novedades tambien las da por vistas en el buzon.
      return app().api("/api/mailbox/seen", { method: "POST", body: {} }).then(refreshSummary)
    }).catch(function (error) { app().toast(error.message) })
  }

  function loadMailbox() {
    return app().api("/api/mailbox").then(function (result) {
      var body = $("drawer-body")
      body.textContent = ""
      var note = el("p", "ps-mail-note", "")
      var paintNote = function (claimable) {
        note.hidden = !claimable
        note.textContent = claimable === 1 ? "Tienes 1 regalo por reclamar." : "Tienes " + claimable + " regalos por reclamar."
      }
      paintNote(result.claimable)
      body.appendChild(note)
      var onClaimed = function () { refreshSummary().then(function (summary) { if (summary) paintNote(summary.claimable) }) }
      if (!result.items.length) body.appendChild(el("p", "hint ps-empty", "Tu buzón está vacío. Aquí llegarán las novedades y los posts del canal."))
      var list = el("div", "ps-timeline")
      // Primero lo que tiene regalo por reclamar, luego por fecha.
      result.items.slice().sort(function (a, b) {
        var ra = a.reward && a.reward.canClaim ? 1 : 0
        var rb = b.reward && b.reward.canClaim ? 1 : 0
        return rb - ra || Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
      }).forEach(function (item) { list.appendChild(itemNode(item, { onClaimed: onClaimed })) })
      body.appendChild(list)
      return app().api("/api/mailbox/seen", { method: "POST", body: {} }).then(refreshSummary)
    }).catch(function (error) { app().toast(error.message) })
  }

  function refreshSummary() {
    return app().api("/api/mailbox").then(function (result) { paintSummary(result); return result }).catch(function () { return null })
  }

  function paintSummary(summary) {
    if (!summary) return
    var grew = summary.unread > lastSummary.unread
    lastSummary = summary
    var count = $("mail-count")
    var total = Math.max(summary.unread, summary.claimable)
    count.hidden = !total
    count.textContent = total > 9 ? "9+" : String(total)
    $("mail-btn").classList.toggle("has-gift", summary.claimable > 0)
    $("news-dot").hidden = !summary.newUpdates
    // Algo nuevo: el sobre da un saltito.
    if (grew && drawerMode === null) {
      var button = $("mail-btn")
      button.classList.remove("is-ping")
      void button.offsetWidth
      button.classList.add("is-ping")
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    $("news-btn").addEventListener("click", function () { openDrawer("news") })
    $("mail-btn").addEventListener("click", function () { openDrawer("mail") })
    $("drawer-close").addEventListener("click", closeDrawer)
    $("drawer").addEventListener("cancel", function (event) { event.preventDefault(); closeDrawer() })
    $("drawer").addEventListener("click", function (event) { if (event.target === $("drawer")) closeDrawer() })
    $("posts-more").addEventListener("click", function () { loadPosts(false) })
  })

  window.PostsUI = {
    // app.js en cada refresco: el resumen del buzon (viene en /api/state).
    onState: function (state) {
      $("top-actions").hidden = false
      if (state && state.mailbox) paintSummary(state.mailbox)
    },
    setVisible: function (value) { if (value && !postsLoaded && window.CanjeApp) loadPosts(true) },
    hide: function () { $("top-actions").hidden = true },
  }
})()
