const fs = require('fs')
let c = fs.readFileSync('src/services/overlay-server.js', 'utf8')

// Reemplazar las líneas con backticks sin escapar dentro del template literal
c = c.replace(
  `html = \`<span style="background:\${bg};color:\${fg};border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;margin-right:8px">\${m.number}</span>\${m.msg}\``,
  `html = '<span style="background:' + bg + ';color:' + fg + ';border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;margin-right:8px">' + m.number + '</span>' + m.msg`
)

c = c.replace(
  "html = `${icons[m.result] || '🃏'} ${m.msg}`",
  "html = (icons[m.result] || '🃏') + ' ' + m.msg"
)

fs.writeFileSync('src/services/overlay-server.js', c)
console.log('fixed:', !c.includes("html = `"))
