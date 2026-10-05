const test = require("node:test")
const assert = require("node:assert/strict")
const { initialBoard, legalMoves, applyMove, count, loserIfStuck } = require("../src/core/checkers.js")

function empty() { return Array.from({ length: 8 }, () => Array(8).fill("")) }

test("damas: tablero inicial con 12 fichas por bando en casillas oscuras", () => {
  const board = initialBoard()
  assert.equal(count(board, "a"), 12)
  assert.equal(count(board, "b"), 12)
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c]) assert.equal((r + c) % 2, 1)
  // Al empezar, "a" tiene 7 movimientos (las 4 fichas de la fila 5).
  assert.equal(legalMoves(board, "a").length, 7)
})

test("damas: la ficha avanza en diagonal hacia delante, no hacia atras", () => {
  const board = empty()
  board[5][2] = "a"
  assert.deepEqual(legalMoves(board, "a").map(m => m.to), [[4, 1], [4, 3]])
  assert.equal(applyMove(board, "a", [5, 2], [6, 1]), null, "hacia atras no")
  const next = applyMove(board, "a", [5, 2], [4, 3])
  assert.equal(next.board[4][3], "a")
  assert.equal(board[5][2], "a", "no modifica el tablero anterior")
})

test("damas: comer es obligatorio y se encadena con la misma pieza", () => {
  const board = empty()
  board[5][0] = "a"
  board[4][1] = "b"
  board[2][3] = "b"
  board[6][7] = "a"
  // Hay captura: solo vale comer.
  assert.deepEqual(legalMoves(board, "a").map(m => [m.from, m.to]), [[[5, 0], [3, 2]]])
  assert.equal(applyMove(board, "a", [6, 7], [5, 6]), null)
  const first = applyMove(board, "a", [5, 0], [3, 2])
  assert.deepEqual([first.captured, first.continueFrom], [true, [3, 2]])
  assert.deepEqual(legalMoves(first.board, "a", first.continueFrom).map(m => m.to), [[1, 4]])
  const second = applyMove(first.board, "a", [3, 2], [1, 4], first.continueFrom)
  assert.equal(second.continueFrom, null)
  assert.equal(count(second.board, "b"), 0)
  assert.equal(loserIfStuck(second.board, "b"), "b")
})

test("damas: al llegar al fondo se corona, termina el turno y la dama va hacia atras", () => {
  const board = empty()
  board[1][2] = "a"
  board[6][1] = "b"
  const crowned = applyMove(board, "a", [1, 2], [0, 1])
  assert.deepEqual([crowned.promoted, crowned.board[0][1], crowned.continueFrom], [true, "A", null])
  assert.deepEqual(legalMoves(crowned.board, "a").map(m => m.to).sort(), [[1, 0], [1, 2]])
  // La dama de "b" come hacia atras.
  const kings = empty()
  kings[3][3] = "B"
  kings[2][2] = "a"
  assert.deepEqual(legalMoves(kings, "b").map(m => m.to), [[1, 1]])
})

test("damas: pierde quien no puede mover", () => {
  const board = empty()
  board[0][1] = "b"
  board[1][0] = "a"
  board[1][2] = "a"
  board[2][3] = "a"
  // "b" esta bloqueada: (1,0) no se puede comer (saldria del tablero) y detras de (1,2) esta (2,3) ocupada.
  assert.equal(legalMoves(board, "b").length, 0)
  assert.equal(loserIfStuck(board, "b"), "b")
  assert.equal(loserIfStuck(board, "a"), null)
})
