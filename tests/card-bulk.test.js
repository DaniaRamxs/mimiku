const test = require("node:test")
const assert = require("node:assert/strict")
const { rarityFromPath, nameFromFile, isImageFile, parseList, nameKey } = require("../src/core/card-bulk.js")

test("crear en masa: la rareza sale de la carpeta mas cercana o de un prefijo del archivo", () => {
  assert.equal(rarityFromPath("personajes/Legendarios/dragon.png"), "legendario")
  assert.equal(rarityFromPath("epico/raros/gato.png"), "raro", "manda la carpeta mas cercana")
  assert.equal(rarityFromPath("C:\\fotos\\Común\\buho.png"), "comun")
  assert.equal(rarityFromPath("epico_hada.png"), "epico")
  assert.equal(rarityFromPath("raro - gato.png"), "raro")
  assert.equal(rarityFromPath("rarito.png"), null, "solo palabras completas")
  assert.equal(rarityFromPath("fotos/gato.png"), null)
})

test("crear en masa: el nombre sale del archivo, sin extension ni prefijo de rareza", () => {
  assert.equal(nameFromFile("epico_hada-del-bosque.png"), "Hada del bosque")
  assert.equal(nameFromFile("carpeta/gato__negro.JPG"), "Gato negro")
  assert.equal(nameFromFile("Rey Dorado.webp"), "Rey Dorado")
  assert.equal(nameFromFile("legendario.png"), "Legendario", "si solo es la palabra, se queda")
  assert.equal(nameFromFile("x".repeat(200) + ".png").length, 120)
  assert.ok(isImageFile("a.jpeg") && isImageFile("b.PNG") && !isImageFile("notas.txt"))
})

test("crear en masa: lista pegada con rareza y descripcion opcionales", () => {
  const rows = parseList("Gato\nDragon, legendario, Escupe fuego\n# comentario\n\nHada;Épico\nBuho\tcomun\tSabio, muy sabio\nRobot, un robot", "raro")
  assert.deepEqual(rows, [
    { name: "Gato", rarity: "raro", description: "" },
    { name: "Dragon", rarity: "legendario", description: "Escupe fuego" },
    { name: "Hada", rarity: "epico", description: "" },
    { name: "Buho", rarity: "comun", description: "Sabio, muy sabio" },
    { name: "Robot", rarity: "raro", description: "un robot" },
  ])
})

test("crear en masa: los repetidos se reconocen sin tildes ni mayusculas", () => {
  assert.equal(nameKey("  Dragón   Rojo "), nameKey("dragon rojo"))
})

const { similarName, imageKey } = require("../src/core/card-bulk.js")

test("crear en masa: nombres parecidos y el mismo GIF se reconocen como repetidos", () => {
  assert.equal(similarName("Luffy", "Monkey D. Luffy"), true)
  assert.equal(similarName("monkey d luffy", "Monkey D. Luffy"), true)
  assert.equal(similarName("Ann", "Ann Takamaki"), false, "palabras muy cortas no bastan")
  assert.equal(similarName("Kafka", "Blade"), false)
  const a = imageKey("https://media2.giphy.com/media/v1.Y2lkPTc5/AbC123xyz/giphy.gif?cid=1")
  const b = imageKey("https://i.giphy.com/media/AbC123xyz/200.gif")
  assert.equal(a, "giphy:AbC123xyz")
  assert.equal(a, b)
  const sha = "a".repeat(64)
  assert.equal(imageKey(`http://127.0.0.1:7777/assets/${sha}.gif`), "sha:" + sha)
  assert.equal(imageKey(""), "")
})
