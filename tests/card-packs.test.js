const test = require("node:test")
const assert = require("node:assert/strict")
const Database = require("better-sqlite3")

const { PACKS } = require("../src/core/card-packs.js")
const { nameKey } = require("../src/core/card-bulk.js")
const { createGifSearch, normalizeGif } = require("../src/services/gif-search.js")

test("packs: cada personaje tiene nombre, rareza valida y busqueda; sin repetidos dentro de cada pack", () => {
  const ids = PACKS.map(pack => pack.id)
  assert.deepEqual(ids, ["hsr", "genshin", "zzz", "p3", "p4", "p5", "onepiece"])
  for (const pack of PACKS) {
    const seen = new Set()
    for (const character of pack.characters) {
      assert.ok(character.name && character.search, pack.id)
      assert.ok(["comun", "raro", "epico", "legendario"].includes(character.rarity), `${pack.id}: ${character.name}`)
      assert.equal(character.description, pack.name)
      assert.ok(!seen.has(nameKey(character.name)), `${pack.id} repite ${character.name}`)
      seen.add(nameKey(character.name))
    }
    assert.ok(pack.characters.some(c => c.rarity === "legendario"), `${pack.id} sin legendarios`)
  }
})

function fakeSecrets() {
  const store = new Map()
  return { getSecret: name => store.get(name) || "", setSecret: (name, value) => store.set(name, value) }
}

test("gif: sin clave no busca; la clave se valida y se guarda", async () => {
  const search = createGifSearch({ secrets: fakeSecrets(), fetchImpl: async () => { throw new Error("no debe llamar") } })
  assert.equal(search.status().configured, false)
  await assert.rejects(search.search("kafka"), /Falta la clave/)
  assert.throws(() => search.setKey("con espacios no"), /GIPHY/)
  assert.equal(search.setKey("abcdefghij1234567890ABCD").configured, true)
})

test("gif: devuelve solo GIFs https de GIPHY con miniatura", async () => {
  let asked = ""
  const search = createGifSearch({
    secrets: fakeSecrets(),
    fetchImpl: async url => {
      asked = url
      return { ok: true, status: 200, json: async () => ({ data: [
        { id: "a1", title: "Kafka", images: { downsized_medium: { url: "https://media.giphy.com/media/a1/giphy.gif" }, fixed_height_small: { url: "https://media.giphy.com/media/a1/100.gif" } } },
        { id: "bad", title: "otro sitio", images: { original: { url: "https://evil.example/x.gif" } } },
      ] }) }
    },
  })
  search.setKey("abcdefghij1234567890ABCD")
  const results = await search.search("Kafka honkai star rail", 5)
  assert.match(asked, /q=Kafka\+honkai\+star\+rail/)
  assert.match(asked, /limit=5/)
  assert.deepEqual(results, [{ id: "a1", title: "Kafka", url: "https://media.giphy.com/media/a1/giphy.gif", preview: "https://media.giphy.com/media/a1/100.gif" }])
  assert.equal(normalizeGif({ images: {} }), null)
})

test("gif: una clave rechazada o el limite de GIPHY dan un mensaje claro", async () => {
  for (const [status, message] of [[403, /rechazó la clave/], [429, /demasiadas búsquedas/]]) {
    const search = createGifSearch({ secrets: fakeSecrets(), fetchImpl: async () => ({ ok: false, status }) })
    search.setKey("abcdefghij1234567890ABCD")
    await assert.rejects(search.search("luffy"), message)
  }
})

test("editar personaje: cambia solo lo que llega y no toca las copias de los viewers", () => {
  const { applyMigrations } = require("../src/db/migrations.js")
  const { createLocalPlatform } = require("../src/services/local-platform.js")
  const db = new Database(":memory:")
  applyMigrations(db)
  const platform = createLocalPlatform(db)
  const card = platform.profiles.createCard("canal", { name: "Kafak", rarity: "comun", imagePath: "https://media.giphy.com/media/x/giphy.gif" })
  const viewer = platform.identities.resolve({ platform: "twitch", platformUserId: "1", username: "luna" })
  platform.profiles.grantCard("canal", viewer.id, card.id, 2, "k1")
  const updated = platform.profiles.updateCard(card.id, { name: "Kafka", rarity: "legendario", imagePath: "https://media.giphy.com/media/y/giphy.gif" })
  assert.deepEqual([updated.name, updated.rarity, updated.image_path, updated.exclusive], ["Kafka", "legendario", "https://media.giphy.com/media/y/giphy.gif", ""])
  assert.equal(platform.profiles.updateCard(card.id, { rarity: "inventada" }).rarity, "legendario", "una rareza rara no se guarda")
  assert.equal(platform.profiles.getCards("canal", viewer.id).find(row => row.card_id === card.id).quantity, 2)
  assert.equal(platform.profiles.updateCard("no-existe", { name: "x" }), null)
})
