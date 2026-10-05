// services/card-sleeves.js — fundas para cartas del gachapon.
//
// Una funda se compra en la tienda (rara, epica) o se gana (prisma: nivel 30
// premium del pase de batalla) y queda guardada hasta que el viewer elige a
// que carta ponersela. Ponerla es para siempre: esa copia pasa a contar como
// "con funda" (viewer_card_variants) y viaja con ella al venderla o tradearla.
// Una copia lleva como mucho una funda.
const SLEEVES = {
  rara: { name: "Funda rara", tier: "raro", description: "Cromado azul con un destello que recorre la carta." },
  epica: { name: "Funda épica", tier: "epico", description: "Marco de croma violeta que gira y chispas de energía." },
  prisma: { name: "Funda prisma", tier: "legendario", description: "Prisma holográfico arcoíris. Solo se consigue en el pase de batalla." },
  corona: { name: "Funda Corona", tier: "legendario", description: "Morada con coronas doradas. Solo para subs del canal, en el Pase Sub." },
}

function createCardSleeves({ platform, getChannel }) {
  const db = platform.db

  function activeChannel() {
    const value = getChannel()
    return value && String(value).trim() ? String(value).toLowerCase() : "local"
  }

  // Fundas sin poner: { rara: 0, epica: 1, prisma: 0 }.
  function tokens(viewerId) {
    const rows = db.prepare("SELECT sleeve, quantity FROM viewer_sleeves_local WHERE channel_id=? AND viewer_id=?").all(activeChannel(), viewerId)
    return Object.fromEntries(Object.keys(SLEEVES).map(sleeve => [sleeve, (rows.find(row => row.sleeve === sleeve) || { quantity: 0 }).quantity]))
  }

  function grant(viewerId, sleeve, quantity = 1) {
    if (!SLEEVES[sleeve]) throw new Error(`Funda desconocida: ${sleeve}`)
    db.prepare(`INSERT INTO viewer_sleeves_local(channel_id, viewer_id, sleeve, quantity) VALUES(?,?,?,?)
      ON CONFLICT(channel_id, viewer_id, sleeve) DO UPDATE SET quantity=quantity+excluded.quantity`)
      .run(activeChannel(), viewerId, sleeve, quantity)
  }

  // Pone una funda en una copia SIN funda de `cardId` (la normal, o la de rango `rank`).
  function apply(viewerId, cardId, sleeve, rank = null) {
    if (!SLEEVES[sleeve]) return { ok: false, reason: "no-sleeve" }
    const channelId = activeChannel()
    const id = String(cardId)
    const rankKey = String(rank || "")
    return db.transaction(() => {
      const available = rankKey
        ? (db.prepare("SELECT quantity FROM viewer_card_variants WHERE channel_id=? AND viewer_id=? AND card_id=? AND rank=? AND sleeve=''")
          .get(channelId, viewerId, id, rankKey) || { quantity: 0 }).quantity
        : platform.profiles.plainCopies(channelId, viewerId, id)
      if (available < 1) return { ok: false, reason: "no-plain-copy" }
      const used = db.prepare(`UPDATE viewer_sleeves_local SET quantity=quantity-1
        WHERE channel_id=? AND viewer_id=? AND sleeve=? AND quantity>=1`).run(channelId, viewerId, sleeve).changes
      if (!used) return { ok: false, reason: "no-sleeve" }
      if (rankKey) {
        db.prepare("UPDATE viewer_card_variants SET quantity=quantity-1 WHERE channel_id=? AND viewer_id=? AND card_id=? AND rank=? AND sleeve=''")
          .run(channelId, viewerId, id, rankKey)
      }
      db.prepare(`INSERT INTO viewer_card_variants(channel_id, viewer_id, card_id, rank, sleeve, quantity) VALUES(?,?,?,?,?,1)
        ON CONFLICT(channel_id, viewer_id, card_id, rank, sleeve) DO UPDATE SET quantity=quantity+1`).run(channelId, viewerId, id, rankKey, sleeve)
      const card = db.prepare("SELECT name FROM cards_local WHERE id=?").get(id)
      return { ok: true, sleeve, sleeveName: SLEEVES[sleeve].name, name: card ? card.name : "" }
    })()
  }

  return { tokens, grant, apply }
}

module.exports = { createCardSleeves, SLEEVES }
