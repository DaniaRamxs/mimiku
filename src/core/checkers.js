// core/checkers.js — reglas de las Damas (duelos de la pagina de canje).
//
// Tablero 8x8, solo casillas oscuras ((fila + columna) impar). Bando "a"
// (quien reta) empieza abajo (filas 5-7) y avanza hacia arriba; bando "b"
// (el rival) empieza arriba (filas 0-2) y avanza hacia abajo. Celdas:
// "" vacia, "a"/"b" ficha, "A"/"B" dama.
// Reglas (damas clasicas):
// - La ficha avanza una casilla en diagonal; la dama, una en cualquier diagonal.
// - Comer es obligatorio; se salta la pieza contraria a la casilla libre de
//   detras. La ficha come solo hacia delante; la dama, en las cuatro.
// - Tras comer, si la misma pieza puede seguir comiendo, sigue (mismo turno).
// - Al llegar a la ultima fila la ficha se corona y el turno termina.
// - Pierde quien no tiene piezas o no puede mover.
const SIZE = 8
const SIDES = ["a", "b"]

function other(side) { return side === "a" ? "b" : "a" }
function owner(cell) { return cell ? cell.toLowerCase() : "" }
function isKing(cell) { return !!cell && cell === cell.toUpperCase() }
function inside(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE }
function forward(side) { return side === "a" ? -1 : 1 }

function initialBoard() {
  const board = []
  for (let r = 0; r < SIZE; r++) {
    const row = []
    for (let c = 0; c < SIZE; c++) row.push((r + c) % 2 === 1 ? (r < 3 ? "b" : r > 4 ? "a" : "") : "")
    board.push(row)
  }
  return board
}

function directions(cell) {
  const side = owner(cell)
  if (isKing(cell)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  return [[forward(side), -1], [forward(side), 1]]
}

// Saltos posibles de la pieza en (r, c).
function capturesFrom(board, r, c) {
  const cell = board[r][c]
  const side = owner(cell)
  const out = []
  for (const [dr, dc] of directions(cell)) {
    const mr = r + dr
    const mc = c + dc
    const tr = r + 2 * dr
    const tc = c + 2 * dc
    if (!inside(tr, tc)) continue
    const middle = board[mr][mc]
    if (middle && owner(middle) === other(side) && !board[tr][tc]) out.push({ from: [r, c], to: [tr, tc], capture: [mr, mc] })
  }
  return out
}

function stepsFrom(board, r, c) {
  const out = []
  for (const [dr, dc] of directions(board[r][c])) {
    const tr = r + dr
    const tc = c + dc
    if (inside(tr, tc) && !board[tr][tc]) out.push({ from: [r, c], to: [tr, tc], capture: null })
  }
  return out
}

// Movimientos legales de `side`. Con `continueFrom` (a mitad de una cadena
// de capturas) solo puede seguir comiendo esa pieza.
function legalMoves(board, side, continueFrom = null) {
  if (continueFrom) return capturesFrom(board, continueFrom[0], continueFrom[1])
  const captures = []
  const steps = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (owner(board[r][c]) !== side) continue
      captures.push(...capturesFrom(board, r, c))
      steps.push(...stepsFrom(board, r, c))
    }
  }
  return captures.length ? captures : steps
}

function sameSquare(a, b) { return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] }

// Aplica un movimiento (si es legal). Devuelve el tablero nuevo (sin tocar
// el anterior) y si la misma pieza debe seguir comiendo.
function applyMove(board, side, from, to, continueFrom = null) {
  const move = legalMoves(board, side, continueFrom).find(item => sameSquare(item.from, from) && sameSquare(item.to, to))
  if (!move) return null
  const next = board.map(row => row.slice())
  let piece = next[from[0]][from[1]]
  next[from[0]][from[1]] = ""
  if (move.capture) next[move.capture[0]][move.capture[1]] = ""
  const lastRow = side === "a" ? 0 : SIZE - 1
  const promoted = !isKing(piece) && to[0] === lastRow
  if (promoted) piece = piece.toUpperCase()
  next[to[0]][to[1]] = piece
  const chain = move.capture && !promoted && capturesFrom(next, to[0], to[1]).length ? [to[0], to[1]] : null
  return { board: next, captured: !!move.capture, promoted, continueFrom: chain }
}

function count(board, side) {
  let n = 0
  for (const row of board) for (const cell of row) if (owner(cell) === side) n += 1
  return n
}

// Ganador si la partida ha terminado para quien le toca mover (`toMove`).
function loserIfStuck(board, toMove) {
  return count(board, toMove) === 0 || legalMoves(board, toMove).length === 0 ? toMove : null
}

module.exports = { SIZE, SIDES, initialBoard, legalMoves, applyMove, count, loserIfStuck, other, owner, isKing }
