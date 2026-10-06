// services/profile-cosmetics.js — Catalogo de la tienda de perfil de la
// pagina de canje: banners (fondo de la tarjeta), marcos (decoracion
// alrededor de la foto, como en Discord) y estilos de nombre (color y
// animacion del nombre en todas partes: Comunidad, comentarios, En vivo,
// Top, Duelos). Aqui solo hay datos: como se ve cada uno lo dibuja la web
// (src/canje-web/profile-kit.js + profile.css, name-styles.css).
//
// `subOnly`: no se vende; lo tiene gratis quien sea sub comprobado del canal.

const RARITY_LABELS = { comun: "Común", raro: "Raro", epico: "Épico", legendario: "Legendario" }

const COSMETICS = [
  // ── Banners ──
  { id: "banner-aurora", slot: "banner", name: "Aurora", rarity: "comun", price: 25000, description: "Luces del norte sobre las montañas y un cielo estrellado." },
  { id: "banner-oceano", slot: "banner", name: "Océano", rarity: "comun", price: 25000, description: "Olas que van y vienen con destellos de sol." },
  { id: "banner-nieve", slot: "banner", name: "Nevada", rarity: "comun", price: 25000, description: "Copos de nieve cayendo sobre picos helados." },
  { id: "banner-burbujas", slot: "banner", name: "Burbujas", rarity: "comun", price: 25000, description: "Burbujas que suben entre rayos de luz bajo el agua." },
  { id: "banner-confeti", slot: "banner", name: "Fiesta", rarity: "comun", price: 25000, description: "Lluvia de confeti y focos de discoteca." },
  { id: "banner-dunas", slot: "banner", name: "Dunas", rarity: "comun", price: 25000, description: "Desierto al atardecer con arena que vuela." },
  { id: "banner-otono", slot: "banner", name: "Otoño", rarity: "comun", price: 25000, description: "Hojas naranjas cayendo y dando vueltas." },
  { id: "banner-nubes", slot: "banner", name: "Entre nubes", rarity: "comun", price: 25000, description: "Nubes que pasan bajo un arcoíris pastel." },
  { id: "banner-sakura", slot: "banner", name: "Sakura", rarity: "raro", price: 60000, description: "Pétalos de cerezo cayendo desde una rama en flor." },
  { id: "banner-synthwave", slot: "banner", name: "Synthwave", rarity: "raro", price: 60000, description: "Atardecer retro con rejilla de neón." },
  { id: "banner-corazones", slot: "banner", name: "Corazones", rarity: "raro", price: 60000, description: "Corazones que flotan y un latido que lo ilumina todo." },
  { id: "banner-matrix", slot: "banner", name: "Código", rarity: "raro", price: 60000, description: "Lluvia de código verde, como en la peli." },
  { id: "banner-luciernagas", slot: "banner", name: "Luciérnagas", rarity: "raro", price: 60000, description: "Un bosque de noche lleno de lucecitas que vuelan." },
  { id: "banner-lava", slot: "banner", name: "Lámpara de lava", rarity: "raro", price: 60000, description: "Gotas de lava que suben y bajan sin prisa." },
  { id: "banner-arcade", slot: "banner", name: "Arcade", rarity: "raro", price: 60000, description: "Invasores pixelados marchando en una pantalla retro." },
  { id: "banner-ecualizador", slot: "banner", name: "Ecualizador", rarity: "raro", price: 60000, description: "Barras de sonido que bailan al ritmo." },
  { id: "banner-cristales", slot: "banner", name: "Cristales", rarity: "raro", price: 60000, description: "Una cueva de cristales que destellan." },
  { id: "banner-galaxia", slot: "banner", name: "Galaxia", rarity: "epico", price: 120000, description: "Nebulosa con estrellas que parpadean y estrellas fugaces." },
  { id: "banner-fuego", slot: "banner", name: "Infierno", rarity: "epico", price: 120000, description: "Llamas que suben sin parar." },
  { id: "banner-tormenta", slot: "banner", name: "Tormenta", rarity: "epico", price: 120000, description: "Lluvia, nubes negras y rayos que lo iluminan todo." },
  { id: "banner-ciudad", slot: "banner", name: "Ciudad neón", rarity: "epico", price: 120000, description: "Rascacielos que pasan de noche bajo un sol de neón." },
  { id: "banner-medusas", slot: "banner", name: "Abismo", rarity: "epico", price: 120000, description: "Medusas que brillan en el fondo del mar." },
  { id: "banner-portal", slot: "banner", name: "Portal", rarity: "epico", price: 120000, description: "Un remolino de energía que se lo traga todo." },
  { id: "banner-estatica", slot: "banner", name: "Señal perdida", rarity: "epico", price: 120000, description: "Carta de ajuste y estática de televisión vieja." },
  { id: "banner-koi", slot: "banner", name: "Estanque koi", rarity: "epico", price: 120000, description: "Peces koi nadando en círculos entre nenúfares." },
  { id: "banner-oro", slot: "banner", name: "Lujo dorado", rarity: "legendario", price: 300000, description: "Oro pulido con destellos y un brillo que lo cruza." },
  { id: "banner-prisma", slot: "banner", name: "Prisma", rarity: "legendario", price: 300000, description: "Holograma arcoíris como las fundas prisma." },
  { id: "banner-agujero", slot: "banner", name: "Agujero negro", rarity: "legendario", price: 300000, description: "Un disco de fuego girando alrededor de la nada." },
  { id: "banner-eclipse", slot: "banner", name: "Eclipse", rarity: "legendario", price: 300000, description: "La luna tapa el sol y la corona brilla a su alrededor." },
  { id: "banner-supernova", slot: "banner", name: "Supernova", rarity: "legendario", price: 300000, description: "Una estrella que explota en ondas de luz." },
  { id: "banner-diamante", slot: "banner", name: "Diamante", rarity: "legendario", price: 300000, description: "Un diamante enorme con reflejos de arcoíris." },
  { id: "banner-sub", slot: "banner", name: "Banner Sub", rarity: "epico", price: 0, subOnly: true, description: "Morado y dorado con destellos. Gratis mientras seas sub del canal." },
  // ── Marcos ──
  { id: "frame-chispas", slot: "frame", name: "Chispas", rarity: "comun", price: 30000, description: "Un aro que gira con chispas." },
  { id: "frame-gato", slot: "frame", name: "Orejas de gato", rarity: "comun", price: 30000, description: "Dos orejitas que se mueven de vez en cuando." },
  { id: "frame-neon", slot: "frame", name: "Neón", rarity: "comun", price: 30000, description: "Doble aro de neón rosa y azul que parpadea." },
  { id: "frame-pixel", slot: "frame", name: "8 bits", rarity: "comun", price: 30000, description: "Aro pixelado con un corazón de videojuego." },
  { id: "frame-corazones", slot: "frame", name: "Enamorado", rarity: "comun", price: 30000, description: "Un aro que late y corazones que suben." },
  { id: "frame-burbujas", slot: "frame", name: "Burbujas", rarity: "comun", price: 30000, description: "Burbujas que suben alrededor de tu foto." },
  { id: "frame-estrellas", slot: "frame", name: "Estrellitas", rarity: "comun", price: 30000, description: "Un anillo de estrellas que gira y parpadea." },
  { id: "frame-hielo", slot: "frame", name: "Escarcha", rarity: "raro", price: 70000, description: "Cristales de hielo y copos flotando alrededor." },
  { id: "frame-cuernos", slot: "frame", name: "Diablillo", rarity: "raro", price: 70000, description: "Cuernos y un aro rojo que arde por dentro." },
  { id: "frame-zorro", slot: "frame", name: "Orejas de zorro", rarity: "raro", price: 70000, description: "Orejas de zorro naranjas que se mueven solas." },
  { id: "frame-flores", slot: "frame", name: "Corona de flores", rarity: "raro", price: 70000, description: "Flores que giran y se mecen sobre tu foto." },
  { id: "frame-murcielago", slot: "frame", name: "Vampiro", rarity: "raro", price: 70000, description: "Alas de murciélago que aletean." },
  { id: "frame-auriculares", slot: "frame", name: "Auriculares", rarity: "raro", price: 70000, description: "Cascos gamer con ondas de sonido." },
  { id: "frame-conejo", slot: "frame", name: "Orejas de conejo", rarity: "raro", price: 70000, description: "Orejas largas; una se dobla de vez en cuando." },
  { id: "frame-laurel", slot: "frame", name: "Laurel", rarity: "raro", price: 70000, description: "Corona de laurel dorada de campeón." },
  { id: "frame-halo", slot: "frame", name: "Halo", rarity: "epico", price: 140000, description: "Halo de ángel con rayos de luz detrás." },
  { id: "frame-llamas", slot: "frame", name: "Llamas", rarity: "epico", price: 140000, description: "Tu foto rodeada de fuego y brasas." },
  { id: "frame-orbita", slot: "frame", name: "Órbita", rarity: "epico", price: 140000, description: "Dos planetas que giran a tu alrededor, por delante y por detrás." },
  { id: "frame-rayo", slot: "frame", name: "Electricidad", rarity: "epico", price: 140000, description: "Rayos que chisporrotean alrededor del aro." },
  { id: "frame-glitch", slot: "frame", name: "Glitch", rarity: "epico", price: 140000, description: "Un fallo digital que hace temblar tu foto." },
  { id: "frame-vortice", slot: "frame", name: "Vórtice", rarity: "epico", price: 140000, description: "Un remolino de colores gira detrás de tu foto." },
  { id: "frame-ondas", slot: "frame", name: "Ondas", rarity: "epico", price: 140000, description: "Ondas de neón que salen de tu foto sin parar." },
  { id: "frame-cristal", slot: "frame", name: "Cristal", rarity: "epico", price: 140000, description: "Fragmentos de cristal flotando a tu alrededor." },
  { id: "frame-corona", slot: "frame", name: "Corona", rarity: "legendario", price: 350000, description: "Corona de oro con joyas que destellan." },
  { id: "frame-arcoiris", slot: "frame", name: "Arcoíris", rarity: "legendario", price: 350000, description: "Aro de todos los colores con estrellitas alrededor." },
  { id: "frame-alas", slot: "frame", name: "Alas de ángel", rarity: "legendario", price: 350000, description: "Alas blancas que aletean a los lados de tu foto." },
  { id: "frame-cosmos", slot: "frame", name: "Cosmos", rarity: "legendario", price: 350000, description: "Aro de galaxia con estrellas girando y una luna." },
  { id: "frame-runas", slot: "frame", name: "Círculo mágico", rarity: "legendario", price: 350000, description: "Un círculo de runas que gira detrás de tu foto." },
  { id: "frame-fenix", slot: "frame", name: "Fénix", rarity: "legendario", price: 350000, description: "Alas de fuego que aletean y sueltan brasas." },
  { id: "frame-diamante", slot: "frame", name: "Diamante", rarity: "legendario", price: 350000, description: "Aro prismático con un diamante que destella." },
  { id: "frame-sub", slot: "frame", name: "Marco Sub", rarity: "epico", price: 0, subOnly: true, description: "Morado y dorado con una estrella en órbita. Gratis mientras seas sub del canal." },
  // ── Estilos de nombre ──
  { id: "name-menta", slot: "name", name: "Menta", rarity: "comun", price: 20000, description: "Degradado verde agua, fresco y limpio." },
  { id: "name-atardecer", slot: "name", name: "Atardecer", rarity: "comun", price: 20000, description: "Del naranja al rosa, como el cielo a última hora." },
  { id: "name-oceano", slot: "name", name: "Océano", rarity: "comun", price: 20000, description: "Azules profundos que se mezclan." },
  { id: "name-chicle", slot: "name", name: "Chicle", rarity: "comun", price: 20000, description: "Rosa y lila pastel, dulce a más no poder." },
  { id: "name-neon", slot: "name", name: "Neón", rarity: "raro", price: 50000, description: "Un letrero de neón que zumba y parpadea de vez en cuando." },
  { id: "name-oro", slot: "name", name: "Oro", rarity: "raro", price: 50000, description: "Letras de oro con un brillo que las cruza." },
  { id: "name-escarcha", slot: "name", name: "Escarcha", rarity: "raro", price: 50000, description: "Hielo azul con destellos que aparecen y se van." },
  { id: "name-ola", slot: "name", name: "Ola", rarity: "raro", price: 50000, description: "Las letras suben y bajan como una ola." },
  { id: "name-terminal", slot: "name", name: "Terminal", rarity: "raro", price: 50000, description: "Verde de consola con el cursor parpadeando." },
  { id: "name-arcoiris", slot: "name", name: "Arcoíris", rarity: "epico", price: 110000, description: "Todos los colores corriendo por tu nombre sin parar." },
  { id: "name-fuego", slot: "name", name: "Fuego", rarity: "epico", price: 110000, description: "Llamas que suben por las letras y un brillo de brasa." },
  { id: "name-glitch", slot: "name", name: "Glitch", rarity: "epico", price: 110000, description: "Tu nombre falla en rojo y cian como una señal rota." },
  { id: "name-galaxia", slot: "name", name: "Galaxia", rarity: "epico", price: 110000, description: "Nebulosa morada con estrellitas que parpadean." },
  { id: "name-saltarin", slot: "name", name: "Saltarín", rarity: "epico", price: 110000, description: "Cada letra da un saltito, una detrás de otra." },
  { id: "name-holograma", slot: "name", name: "Holograma", rarity: "legendario", price: 250000, description: "Reflejos de holograma que cambian de color con un destello." },
  { id: "name-realeza", slot: "name", name: "Realeza", rarity: "legendario", price: 250000, description: "Oro brillante, una coronita y destellos alrededor." },
  { id: "name-plasma", slot: "name", name: "Plasma", rarity: "legendario", price: 250000, description: "Energía eléctrica que recorre el nombre con chispazos." },
  { id: "name-sub", slot: "name", name: "Nombre Sub", rarity: "epico", price: 0, subOnly: true, description: "Morado y dorado con brillo. Gratis mientras seas sub del canal." },
]

// Ranura de cada tipo -> columna de viewer_profiles donde se guarda lo equipado.
const SLOT_COLUMNS = { banner: "banner", frame: "frame", name: "name_style" }

const BY_ID = new Map(COSMETICS.map(item => [item.id, item]))

function cosmetic(id) {
  return BY_ID.get(String(id || "")) || null
}

module.exports = { COSMETICS, RARITY_LABELS, SLOT_COLUMNS, cosmetic }
