const fs = require('fs')
let c = fs.readFileSync('mod-panel/app.js', 'utf8')

c = c.replace(
  `function switchChTab(tab) {
  document.querySelectorAll(".ch-tab").forEach(b => b.classList.remove("active"))
  document.querySelectorAll(".ch-tab-content").forEach(t => {
    t.style.display = "none"
    t.style.visibility = "hidden"
    t.style.position = "absolute"
    t.classList.remove("active")
  })
  const btn = document.querySelector(\`.ch-tab[data-tab="\${tab}"]\`)
  const content = document.getElementById("tab-"+tab)
  if (btn) btn.classList.add("active")
  if (content) {
    content.style.display = "block"
    content.style.visibility = "visible"
    content.style.position = "relative"
    content.classList.add("active")
  }`,
  `function switchChTab(tab) {
  document.querySelectorAll(".ch-tab").forEach(b => b.classList.remove("active"))
  document.querySelectorAll(".ch-tab-content").forEach(t => {
    t.style.display = "none"
    t.classList.remove("active")
  })
  const btn = document.querySelector(\`.ch-tab[data-tab="\${tab}"]\`)
  const content = document.getElementById("tab-"+tab)
  if (btn) btn.classList.add("active")
  if (content) {
    content.style.display = "block"
    content.classList.add("active")
  }`
)

fs.writeFileSync('mod-panel/app.js', c)
console.log('switchChTab simplified')
