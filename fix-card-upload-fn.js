const fs = require('fs')
let c = fs.readFileSync('src/pages/cards.js', 'utf8')

const uploadFn = `
async function uploadCardImage(file) {
  if (!file) return
  if (file.size > 5 * 1024 * 1024) { showToast("La imagen supera 5MB"); return }

  const hint = document.getElementById("card-img-uploading")
  if (hint) hint.style.display = "block"

  const { supabase } = require("../services/supabase.js")
  const ch   = localStorage.getItem("mimiku_channel")
  const ext  = file.name.split(".").pop()
  const path = \`\${ch}/\${Date.now()}.\${ext}\`

  const { error } = await supabase.storage.from("card-assets").upload(path, file, { contentType: file.type, upsert: false })
  if (hint) hint.style.display = "none"

  if (error) { showToast("Error al subir: " + error.message); return }

  const { data: { publicUrl } } = supabase.storage.from("card-assets").getPublicUrl(path)
  document.getElementById("card-img").value = publicUrl
  showToast("Imagen subida ✦")
}

`

c = c.replace(
  'module.exports = { initCards, loadCards, loadPacks, createCard, deleteCard, createPack }',
  uploadFn + 'module.exports = { initCards, loadCards, loadPacks, createCard, deleteCard, createPack, uploadCardImage }'
)

fs.writeFileSync('src/pages/cards.js', c)
console.log('upload fn added:', c.includes('uploadCardImage'))
