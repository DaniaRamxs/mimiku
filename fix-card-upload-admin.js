const fs = require('fs')
let c = fs.readFileSync('src/pages/cards.js', 'utf8')

c = c.replace(
  'const { supabase } = require("../services/supabase.js")',
  'const { supabaseAdmin } = require("../services/supabase.js")'
)

c = c.replace(
  `  const { error } = await supabase.storage.from("card-assets").upload(path, file, { contentType: file.type, upsert: false })
  if (hint) hint.style.display = "none"

  if (error) { showToast("Error al subir: " + error.message); return }

  const { data: { publicUrl } } = supabase.storage.from("card-assets").getPublicUrl(path)`,
  `  const { error } = await supabaseAdmin.storage.from("card-assets").upload(path, file, { contentType: file.type, upsert: false })
  if (hint) hint.style.display = "none"

  if (error) { showToast("Error al subir: " + error.message); console.error("upload error:", error); return }

  const { data: { publicUrl } } = supabaseAdmin.storage.from("card-assets").getPublicUrl(path)`
)

fs.writeFileSync('src/pages/cards.js', c)
console.log('admin client:', c.includes('supabaseAdmin'))
