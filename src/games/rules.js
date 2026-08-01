/**
 * The rules of Tic-Tac-Toe and Quatro, reimplemented from scratch.
 *
 * ICQ shipped games as Flash applets over OSCAR's peer-to-peer rendezvous.
 * Flash died in 2020 and OSCAR closed in June 2024. The Flash files are not
 * ours to distribute and cannot be run anyway. What can be brought back
 * honestly is the games themselves — the same rules, the same feel — running
 * as pure logic over the text connection that already exists between two peers.
 * This file says that plainly rather than implying the originals are here.
 *
 * Tic-Tac-Toe and Quatro (ICQ's name for Connect Four) were both in the
 * original games menu. They are the right choices for a reimplementation
 * because their rules are small enough to be provably correct, their state is
 * defined entirely by the sequence of moves played, and nothing about them
 * requires the two sides to share anything beyond those moves.
 *
 * The hard part in Quatro is the win detector. A Connect Four board has four
 * win directions and 42 cells; the naive approach visits each cell four times.
 * The version here anchors one scan per direction at each cell, exits as soon
 * as it finds a winner, and only after confirming the first cell is non-null —
 * so it is both correct and fast enough to run on every move without a second
 * thought.
 *
 * All exports are pure functions of their arguments. No I/O, no timers, no
 * React. The engine.js that calls these functions is equally free of side
 * effects, which is what makes the move-list reconstruction test possible.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The two player tokens used throughout: player1 always moves first. */
const P1 = 'player1';
const P2 = 'player2';

function opponent(player) {
  return player === P1 ? P2 : P1;
}

// ---------------------------------------------------------------------------
// Tic-Tac-Toe
// ---------------------------------------------------------------------------

/**
 * Cells are numbered 0–8, row-major:
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */
const TTT_WIN_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],             // diagonals
]);

function tttInitialState() {
  return {
    board: Object.freeze(Array(9).fill(null)),
    turn: P1,
    result: null,
  };
}

function tttIsLegal(state, move) {
  if (state.result !== null) return false;
  const { cell } = move;
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return false;
  return state.board[cell] === null;
}

function tttCheckResult(board) {
  for (const [a, b, c] of TTT_WIN_LINES) {
    if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) {
      return board[a];
    }
  }
  if (board.every((cell) => cell !== null)) return 'draw';
  return null;
}

function tttApplyMove(state, move) {
  const board = [...state.board];
  board[move.cell] = state.turn;
  const result = tttCheckResult(board);
  return {
    board: Object.freeze(board),
    turn: opponent(state.turn),
    result,
  };
}

/**
 * Tic-Tac-Toe.
 *
 * move shape: { cell: 0–8 }
 * result:     null | 'player1' | 'player2' | 'draw'
 */
export const TTT = Object.freeze({
  id: 'ttt',
  name: 'Tic-Tac-Toe',
  initialState: tttInitialState,
  isLegal: tttIsLegal,
  applyMove: tttApplyMove,
});

// ---------------------------------------------------------------------------
// Quatro (Connect Four)
// ---------------------------------------------------------------------------

const Q_ROWS = 6;
const Q_COLS = 7;

/**
 * board[row][col], row 0 = top, row 5 = bottom. Pieces fall to the lowest
 * unoccupied cell in a column, so the board fills from the bottom up.
 */
function quatroInitialState() {
  const board = Object.freeze(
    Array.from({ length: Q_ROWS }, () => Object.freeze(Array(Q_COLS).fill(null)))
  );
  return { board, turn: P1, result: null };
}

function quatroIsLegal(state, move) {
  if (state.result !== null) return false;
  const { col } = move;
  if (!Number.isInteger(col) || col < 0 || col >= Q_COLS) return false;
  // The column is full when the top cell is occupied.
  return state.board[0][col] === null;
}

/**
 * Check whether four cells starting at (r, c) in direction (dr, dc) are all
 * the same non-null value. Returns that value or null.
 */
function checkLine(board, r, c, dr, dc) {
  const first = board[r][c];
  if (first === null) return null;
  for (let i = 1; i < 4; i++) {
    const nr = r + dr * i;
    const nc = c + dc * i;
    if (nr < 0 || nr >= Q_ROWS || nc < 0 || nc >= Q_COLS) return null;
    if (board[nr][nc] !== first) return null;
  }
  return first;
}

function quatroCheckResult(board) {
  // Directions: right, down, down-right, down-left.
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < Q_ROWS; r++) {
    for (let c = 0; c < Q_COLS; c++) {
      for (const [dr, dc] of dirs) {
        const winner = checkLine(board, r, c, dr, dc);
        if (winner !== null) return winner;
      }
    }
  }
  // If the top row is completely filled, all 42 cells are occupied.
  if (board[0].every((cell) => cell !== null)) return 'draw';
  return null;
}

function quatroApplyMove(state, move) {
  // Find the lowest empty row in the column — pieces fall under gravity.
  let landingRow = -1;
  for (let r = Q_ROWS - 1; r >= 0; r--) {
    if (state.board[r][move.col] === null) {
      landingRow = r;
      break;
    }
  }

  const board = state.board.map((row, r) => {
    if (r !== landingRow) return row;
    const newRow = [...row];
    newRow[move.col] = state.turn;
    return Object.freeze(newRow);
  });

  const result = quatroCheckResult(board);
  return {
    board: Object.freeze(board),
    turn: opponent(state.turn),
    result,
  };
}

/**
 * Quatro — ICQ's name for Connect Four.
 *
 * move shape: { col: 0–6 }
 * result:     null | 'player1' | 'player2' | 'draw'
 */
export const QUATRO = Object.freeze({
  id: 'quatro',
  name: 'Quatro',
  initialState: quatroInitialState,
  isLegal: quatroIsLegal,
  applyMove: quatroApplyMove,
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All games in a lookup map for the engine. */
export const GAMES_BY_ID = Object.freeze({ ttt: TTT, quatro: QUATRO });
