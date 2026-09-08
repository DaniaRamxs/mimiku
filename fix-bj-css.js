const fs = require('fs')
let c = fs.readFileSync('src/services/overlay.html', 'utf8')

const oldBjCSS = `/* ── BJ overlay ── */
#bj-overlay{
  position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.8);
  background:rgba(10,10,15,.95);border:1px solid rgba(124,110,245,.4);
  border-radius:16px;padding:24px 32px;z-index:9994;
  opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;
  text-align:center;min-width:320px;
}
#bj-overlay.show{opacity:1;transform:translate(-50%,-50%) scale(1);}
#bj-icon{font-size:48px;margin-bottom:8px;}
#bj-result-text{font-size:16px;color:#9898b0;line-height:1.5;}`

const newBjCSS = `/* ── BJ overlay ── */
#bj-overlay{
  position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  z-index:9994;opacity:0;pointer-events:none;
  transition:opacity .15s;
}
#bj-overlay.show{opacity:1;}
#bj-icon{
  font-size:120px;line-height:1;
  filter:drop-shadow(0 0 40px currentColor);
  animation:bj-pop .4s cubic-bezier(.17,.67,.35,1.4) forwards;
}
#bj-result-label{
  font-size:72px;font-weight:900;letter-spacing:-.02em;margin-top:8px;
  animation:bj-pop .4s .1s cubic-bezier(.17,.67,.35,1.4) both;
  text-shadow:0 0 60px currentColor;
}
#bj-result-text{
  font-size:20px;color:rgba(232,232,240,.7);margin-top:12px;
  animation:bj-pop .3s .2s ease both;
  max-width:600px;text-align:center;line-height:1.4;
}
@keyframes bj-pop{
  from{transform:scale(.5);opacity:0}
  to{transform:scale(1);opacity:1}
}
@keyframes bj-shake{
  0%,100%{transform:translateX(0)}
  20%{transform:translateX(-12px)}
  40%{transform:translateX(12px)}
  60%{transform:translateX(-8px)}
  80%{transform:translateX(8px)}
}`

c = c.replace(oldBjCSS, newBjCSS)
fs.writeFileSync('src/services/overlay.html', c)
console.log('CSS fixed:', c.includes('bj-pop'))
