const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

// Fix collection query - sin join, hacer dos queries separadas
const oldCollection = `  const { data } = await sb.from("viewer_cards")
    .select("*, card:card_id(*)")
    .eq("channel_id", state.currentChannel)
    .eq("username", state.twitchUser.login.toLowerCase())
    .order("obtained_at", { ascending: false })`

const newCollection = `  // obtener viewer_cards sin join
  const { data: vcData } = await sb.from("viewer_cards")
    .select("*")
    .eq("channel_id", state.currentChannel)
    .eq("username", state.twitchUser.login.toLowerCase())
    .order("obtained_at", { ascending: false })

  // obtener las cartas correspondientes
  const cardIds = [...new Set((vcData||[]).map(v => v.card_id))]
  let cardsMap = {}
  if (cardIds.length) {
    const { data: cardsData } = await sb.from("cards").select("*").in("id", cardIds)
    ;(cardsData||[]).forEach(card => { cardsMap[card.id] = card })
  }
  const data = (vcData||[]).map(vc => ({ ...vc, card: cardsMap[vc.card_id] || null }))`

c = c.replace(oldCollection, newCollection)

// Fix buyPack - viewer_cards insert sin join
const oldBuyPack = `    const { data: existing } = await sb.from("viewer_cards")
      .select("id,quantity").eq("channel_id", state.currentChannel).eq("username", u.login.toLowerCase()).eq("card_id", card.id).single()
    if (existing) {
      await sb.from("viewer_cards").update({ quantity: existing.quantity+1 }).eq("id", existing.id)
    } else {
      await sb.from("viewer_cards").insert({ channel_id: state.currentChannel, username: u.login.toLowerCase(), card_id: card.id })
    }`

const newBuyPack = `    const { data: existing } = await sb.from("viewer_cards")
      .select("id,quantity").eq("channel_id", state.currentChannel).eq("username", u.login.toLowerCase()).eq("card_id", card.id).maybeSingle()
    if (existing) {
      await sb.from("viewer_cards").update({ quantity: (existing.quantity||0)+1 }).eq("id", existing.id)
    } else {
      const { error: insertErr } = await sb.from("viewer_cards").insert({ channel_id: state.currentChannel, username: u.login.toLowerCase(), card_id: card.id, quantity: 1 })
      if (insertErr) console.error("viewer_cards insert error:", insertErr.message)
    }`

c = c.replace(oldBuyPack, newBuyPack)

// Fix profile cards count
const oldProfCards = `  const { data: cards } = await sb.from("viewer_cards").select("*").eq("channel_id", ch).eq("username", usr)
  document.getElementById("prof-cards").textContent = cards?.length ?? 0`

const newProfCards = `  const { data: cards, error: cardsErr } = await sb.from("viewer_cards").select("id").eq("channel_id", ch).eq("username", usr)
  if (cardsErr) console.error("prof-cards error:", cardsErr.message)
  document.getElementById("prof-cards").textContent = cards?.length ?? 0`

c = c.replace(oldProfCards, newProfCards)

fs.writeFileSync('mod-panel/app.js', c)
console.log('collection fixed:', c.includes('cardsMap'))
console.log('buyPack fixed:', c.includes('maybeSingle'))
