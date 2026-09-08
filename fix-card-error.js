const fs = require('fs')
let c = fs.readFileSync('src/services/profiles.js', 'utf8')

c = c.replace(
  `async function createCard(channelId, name, description, imageUrl, rarity) {
  const { data, error } = await supabase.from("cards").insert({
    channel_id: channelId.toLowerCase(), name, description,
    image_url: imageUrl, rarity,
  }).select().single()
  if (error) throw error
  return data
}`,
  `async function createCard(channelId, name, description, imageUrl, rarity) {
  const { data, error } = await supabase.from("cards").insert({
    channel_id: channelId.toLowerCase(), name, description,
    image_url: imageUrl || "", rarity,
  }).select().single()
  if (error) {
    console.error("[profiles] createCard error:", JSON.stringify(error))
    throw new Error(error.message || JSON.stringify(error))
  }
  return data
}`
)

fs.writeFileSync('src/services/profiles.js', c)
console.log('fixed:', c.includes('JSON.stringify(error)'))
