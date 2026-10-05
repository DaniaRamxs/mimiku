// core/card-packs.js — listas de personajes listas para el gachapon
// ("Crear muchos a la vez" > Packs). Solo nombre, rareza sugerida y juego:
// la imagen o GIF se pone despues (arrastrando archivos con su nombre o con
// "Buscar GIFs"), y todo se puede editar antes y despues de crearlos.
//
// Rareza sugerida: los mas iconicos del juego en legendario, el resto de
// 5 estrellas / rango S en epico, los principales de 4 estrellas / rango A en
// raro y los demas en comun. `search`: lo que se busca en GIPHY.

function pack(id, name, search, groups) {
  const characters = []
  for (const [rarity, names] of Object.entries(groups)) {
    for (const entry of names) {
      const [display, query] = Array.isArray(entry) ? entry : [entry, entry]
      characters.push({ name: display, rarity, description: name, search: `${query} ${search}` })
    }
  }
  return { id, name, characters }
}

const PACKS = [
  pack("hsr", "Honkai: Star Rail", "honkai star rail", {
    legendario: ["Kafka", "Acheron", "Firefly", "Silver Wolf", "Blade", "Jingliu", "Sparkle", "Castorice", "Phainon"],
    epico: [
      "Seele", "Jing Yuan", ["Dan Heng Imbibitor Lunae", "Dan Heng Imbibitor Lunae"], "Fu Xuan", "Huohuo", "Ruan Mei", "Aventurine",
      "Black Swan", "Robin", "Boothill", "Feixiao", "Yunli", "Jiaoqiu", "Lingsha", "Rappa", "Sunday", "The Herta", "Aglaea",
      "Bronya", "Himeko", "Welt", "Clara", "Gepard", "Yanqing", "Bailu", "Topaz", ["Dr. Ratio", "Dr Ratio"], "Argenti", "Jade",
      "Tribbie", "Mydei", "Anaxa", "Fugue",
    ],
    raro: [["March 7th", "March 7th"], "Dan Heng", "Trailblazer", "Herta", "Pela", "Asta", "Tingyun", "Qingque", "Gallagher", "Sushang", "Lynx", "Guinaifen"],
    comun: ["Natasha", "Serval", "Sampo", "Hook", "Luka", "Yukong", "Hanya", "Xueyi", "Misha", "Moze", "Arlan", "Pom-Pom"],
  }),
  pack("genshin", "Genshin Impact", "genshin impact", {
    legendario: ["Raiden Shogun", "Zhongli", "Venti", "Nahida", "Furina", "Mavuika", "Hu Tao", "Arlecchino", "Neuvillette"],
    epico: [
      "Ganyu", ["Kaedehara Kazuha", "Kazuha"], ["Kamisato Ayaka", "Ayaka"], "Yelan", "Xiao", "Eula", "Klee", "Diluc", "Jean", "Keqing",
      "Mona", "Qiqi", "Tighnari", "Cyno", "Nilou", "Alhaitham", "Wanderer", "Yae Miko", ["Sangonomiya Kokomi", "Kokomi"], "Navia",
      "Wriothesley", "Clorinde", "Chiori", "Emilie", "Kinich", "Xilonen", "Citlali", "Mualani", "Lyney", "Shenhe", "Albedo",
      ["Arataki Itto", "Itto"], ["Tartaglia", "Childe"], "Baizhu", "Dehya", "Yoimiya",
    ],
    raro: ["Bennett", "Xingqiu", "Xiangling", "Fischl", "Sucrose", "Kaeya", "Lisa", "Amber", "Noelle", "Barbara", "Beidou", "Ningguang", "Paimon"],
    comun: [
      "Razor", "Chongyun", "Xinyan", "Diona", "Rosaria", "Yanfei", "Sayu", ["Kujou Sara", "Kujou Sara"], "Thoma", "Gorou", "Yun Jin",
      ["Kuki Shinobu", "Kuki Shinobu"], ["Shikanoin Heizou", "Heizou"], "Collei", "Dori", "Candace", "Layla", "Faruzan", "Yaoyao",
      "Kirara", "Lynette", "Freminet", "Charlotte", "Chevreuse", "Gaming",
    ],
  }),
  pack("zzz", "Zenless Zone Zero", "zenless zone zero", {
    legendario: ["Ellen Joe", ["Hoshimi Miyabi", "Miyabi"], "Jane Doe", "Zhu Yuan", "Yixuan", ["Tsukishiro Yanagi", "Yanagi"]],
    epico: [
      "Grace Howard", ["Von Lycaon", "Lycaon"], ["Alexandrina Sebastiane", "Rina"], "Koleda Belobog", ["Nekomiya Mana", "Nekomata"],
      "Soldier 11", "Qingyi", "Caesar King", "Burnice White", "Lighter", ["Asaba Harumasa", "Harumasa"], "Astra Yao",
      "Evelyn Chevalier", "Trigger", "Vivian Banshee", "Hugo Vlad",
    ],
    raro: ["Anby Demara", "Nicole Demara", "Billy Kid", ["Belle", "Belle proxy"], ["Wise", "Wise proxy"], "Corin Wickes", "Soukaku", ["Luciana de Montefio", "Lucy"]],
    comun: ["Anton Ivanov", "Ben Bigger", "Piper Wheel", "Seth Lowell", "Pulchra Fellini", ["Bangboo", "Bangboo"]],
  }),
  pack("p3", "Persona 3", "persona 3", {
    legendario: [["Makoto Yuki", "Makoto Yuki"], "Aigis", ["Mitsuru Kirijo", "Mitsuru"], ["Ryoji Mochizuki", "Ryoji"]],
    epico: [["Yukari Takeba", "Yukari"], ["Akihiko Sanada", "Akihiko"], ["Shinjiro Aragaki", "Shinjiro"], ["Kotone Shiomi", "Kotone"], "Elizabeth"],
    raro: [["Junpei Iori", "Junpei"], ["Fuuka Yamagishi", "Fuuka"], ["Ken Amada", "Ken Amada"], "Koromaru", ["Chidori Yoshino", "Chidori"]],
    comun: ["Igor", ["Takaya Sakaki", "Takaya"], "Theodore"],
  }),
  pack("p4", "Persona 4", "persona 4", {
    legendario: [["Yu Narukami", "Yu Narukami"], ["Rise Kujikawa", "Rise"], ["Tohru Adachi", "Adachi"]],
    epico: [["Yosuke Hanamura", "Yosuke"], ["Chie Satonaka", "Chie"], ["Yukiko Amagi", "Yukiko"], ["Naoto Shirogane", "Naoto"], "Margaret", "Marie"],
    raro: [["Kanji Tatsumi", "Kanji"], "Teddie", ["Nanako Dojima", "Nanako"]],
    comun: [["Ryotaro Dojima", "Dojima"]],
  }),
  pack("p5", "Persona 5", "persona 5", {
    legendario: [["Joker (Ren Amamiya)", "Joker"], ["Goro Akechi", "Akechi"], ["Makoto Niijima", "Makoto Niijima"], ["Futaba Sakura", "Futaba"]],
    epico: [["Ann Takamaki", "Ann Takamaki"], ["Haru Okumura", "Haru"], ["Yusuke Kitagawa", "Yusuke"], ["Kasumi Yoshizawa", "Kasumi"], "Morgana", "Lavenza"],
    raro: [["Ryuji Sakamoto", "Ryuji"], ["Takuto Maruki", "Maruki"], ["Sae Niijima", "Sae Niijima"], ["Caroline y Justine", "Caroline Justine"]],
    comun: [["Sojiro Sakura", "Sojiro"], ["Tae Takemi", "Takemi"], ["Sadayo Kawakami", "Kawakami"]],
  }),
  pack("onepiece", "One Piece", "one piece", {
    legendario: [["Monkey D. Luffy", "Luffy"], ["Roronoa Zoro", "Zoro"], "Shanks", ["Gol D. Roger", "Gol D Roger"], ["Edward Newgate (Barbablanca)", "Whitebeard"], "Kaido", ["Luffy Gear 5", "Luffy gear 5"]],
    epico: [
      "Nami", "Sanji", ["Nico Robin", "Nico Robin"], ["Portgas D. Ace", "Ace"], "Sabo", ["Trafalgar Law", "Law"], ["Boa Hancock", "Boa Hancock"],
      ["Dracule Mihawk", "Mihawk"], ["Marshall D. Teach (Barbanegra)", "Blackbeard"], ["Charlotte Linlin (Big Mom)", "Big Mom"], "Yamato",
      ["Donquixote Doflamingo", "Doflamingo"], ["Silvers Rayleigh", "Rayleigh"], "Uta", ["Monkey D. Garp", "Garp"],
    ],
    raro: [
      ["Tony Tony Chopper", "Chopper"], "Usopp", "Franky", "Brook", "Jinbe", ["Eustass Kid", "Eustass Kid"], ["Sakazuki (Akainu)", "Akainu"],
      ["Borsalino (Kizaru)", "Kizaru"], ["Kuzan (Aokiji)", "Aokiji"], "Crocodile", ["Rob Lucci", "Rob Lucci"],
    ],
    comun: ["Buggy", "Koby", ["Nefertari Vivi", "Vivi"], "Smoker", "Tashigi", "Perona", ["Bon Clay (Mr. 2)", "Bon Clay"], "Carrot"],
  }),
]

module.exports = { PACKS }
