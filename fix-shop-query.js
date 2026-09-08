const fs = require('fs')
let c = fs.readFileSync('src/services/shopRealtime.js', 'utf8')

c = c.replace(
  `    const { data, error } = await supabase
      .from("shop_purchases")
      .select("*, item:item_id(*)")
      .eq("channel_id", _channel)
      .gt("purchased_at", lastChecked)
      .order("purchased_at", { ascending: true })
      .limit(10)`,
  `    const { data, error } = await supabase
      .from("shop_purchases")
      .select("*")
      .eq("channel_id", _channel)
      .gt("purchased_at", lastChecked)
      .order("purchased_at", { ascending: true })
      .limit(10)`
)

fs.writeFileSync('src/services/shopRealtime.js', c)
console.log('fixed:', !c.includes('item:item_id'))
