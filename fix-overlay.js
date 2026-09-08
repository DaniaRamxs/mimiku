const fs = require('fs')
let c = fs.readFileSync('src/services/overlay-server.js', 'utf8')

// Agregar Set de señales procesadas
c = c.replace(
  'let pollingStarted = false',
  'let pollingStarted = false\nconst processedSigs = new Set()'
)

// En pollSignals, saltear señales ya procesadas
c = c.replace(
  '    for (const sig of sigs) {\n      if (sig.type === "new_share")  await handleNewShare(sig)\n      if (sig.type === "offer")      await handleOffer(sig)\n      if (sig.type === "ice_mod")    await handleIceMod(sig)\n      if (sig.type === "stop_share") handleStopShare(sig)\n    }',
  '    for (const sig of sigs) {\n      if (processedSigs.has(sig.id)) continue\n      processedSigs.add(sig.id)\n      if (sig.type === "new_share")  await handleNewShare(sig)\n      if (sig.type === "offer")      await handleOffer(sig)\n      if (sig.type === "ice_mod")    await handleIceMod(sig)\n      if (sig.type === "stop_share") handleStopShare(sig)\n    }'
)

fs.writeFileSync('src/services/overlay-server.js', c)
console.log('processedSigs added:', c.includes('processedSigs'))
