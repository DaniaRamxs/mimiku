// services/achievements.js — catalogo de logros de la pagina de canje.
//
// Cada logro mira un contador de por vida (`stat`, ver community.js: se suma
// con lo que pasa en el tablon En vivo) o un dato del perfil (`fact`: nivel,
// coleccion, antiguedad...). Se desbloquea al llegar a `goal` y queda para
// siempre aunque luego baje (vender cartas, etc.).
// tier: bronce | plata | oro. icon: dibujo de la medalla en la pagina.
const ACHIEVEMENTS = [
  { id: "primera-tirada", name: "Primera tirada", description: "Tira del gachapón por primera vez.", tier: "bronce", icon: "capsule", stat: "pulls", goal: 1 },
  { id: "gacha-100", name: "Adicto al gachapón", description: "Haz 100 tiradas del gachapón.", tier: "plata", icon: "capsule", stat: "pulls", goal: 100 },
  { id: "toque-dorado", name: "Toque dorado", description: "Consigue un personaje legendario.", tier: "plata", icon: "star", stat: "legendaries", goal: 1 },
  { id: "iman-legendarios", name: "Imán de legendarios", description: "Consigue 10 personajes legendarios.", tier: "oro", icon: "star", stat: "legendaries", goal: 10 },
  { id: "jugador", name: "Jugador", description: "Juega 50 partidas de minijuegos.", tier: "bronce", icon: "dice", stat: "plays", goal: 50 },
  { id: "habitual", name: "Habitual del casino", description: "Juega 500 partidas de minijuegos.", tier: "plata", icon: "dice", stat: "plays", goal: 500 },
  { id: "gran-premio", name: "Gran premio", description: "Gana un premio gordo en un minijuego.", tier: "plata", icon: "trophy", stat: "big_wins", goal: 1 },
  { id: "rival-hikki", name: "Rival de Hikki", description: "Gánale una mano a Hikki en el blackjack.", tier: "bronce", icon: "cards", stat: "hikki_wins", goal: 1 },
  { id: "pesadilla-hikki", name: "Pesadilla de Hikki", description: "Gánale 50 manos a Hikki.", tier: "oro", icon: "cards", stat: "hikki_wins", goal: 50 },
  { id: "natural", name: "Blackjack natural", description: "Saca un blackjack con tus dos primeras cartas.", tier: "plata", icon: "cards", stat: "naturals", goal: 1 },
  { id: "manos-rapidas", name: "Manos rápidas", description: "Roba 5 veces (puntos o personajes).", tier: "plata", icon: "hand", stat: "steals", goal: 5 },
  { id: "pillado", name: "Pillado", description: "Te pillan robando 5 veces.", tier: "bronce", icon: "hand", stat: "rob_fails", goal: 5 },
  { id: "generoso", name: "Generoso", description: "Regala 50.000 puntos en total.", tier: "plata", icon: "gift", stat: "gifts", goal: 50000 },
  { id: "mecenas", name: "Mecenas", description: "Regala 500.000 puntos en total.", tier: "oro", icon: "gift", stat: "gifts", goal: 500000 },
  { id: "nivel-10", name: "Nivel 10", description: "Llega al nivel 10.", tier: "bronce", icon: "level", fact: "level", goal: 10 },
  { id: "nivel-25", name: "Nivel 25", description: "Llega al nivel 25.", tier: "plata", icon: "level", fact: "level", goal: 25 },
  { id: "nivel-50", name: "Nivel 50", description: "Llega al nivel 50.", tier: "oro", icon: "level", fact: "level", goal: 50 },
  { id: "coleccionista", name: "Coleccionista", description: "Ten 25 personajes distintos.", tier: "plata", icon: "album", fact: "owned", goal: 25 },
  { id: "coleccion-completa", name: "Colección completa", description: "Ten todos los personajes del canal.", tier: "oro", icon: "crown", fact: "complete", goal: 1 },
  { id: "escaparate", name: "Escaparate", description: "Llena tu vitrina con 6 personajes.", tier: "bronce", icon: "album", fact: "showcase", goal: 6 },
  { id: "con-estilo", name: "Con estilo", description: "Equipa un banner y un marco.", tier: "bronce", icon: "brush", fact: "styled", goal: 1 },
  { id: "veterano", name: "Veterano", description: "Lleva 30 días en la comunidad.", tier: "bronce", icon: "clock", fact: "days", goal: 30 },
]

const BY_ID = new Map(ACHIEVEMENTS.map(item => [item.id, item]))
const TIER_ORDER = { oro: 0, plata: 1, bronce: 2 }

function valueOf(item, stats, facts) {
  return Number((item.stat ? stats[item.stat] : facts[item.fact]) || 0)
}

// Logros alcanzados con estos valores (solo los que se pueden mirar: sin
// `facts` se ignoran los de perfil).
function reached(stats, facts = null) {
  return ACHIEVEMENTS.filter(item => (item.stat || facts) && valueOf(item, stats, facts || {}) >= item.goal).map(item => item.id)
}

function publicAchievement(item) {
  return { id: item.id, name: item.name, description: item.description, tier: item.tier, icon: item.icon }
}

module.exports = { ACHIEVEMENTS, BY_ID, TIER_ORDER, reached, valueOf, publicAchievement }
