/**
 * Turn-protocol tests for the game engine.
 *
 * These verify the things the rules tests do not: who moves first, whose turn
 * it is after a move, what happens when the wrong player tries to move, and
 * whether a position reconstructed from the move list is identical to the one
 * built move-by-move. That last point is the key invariant — without it, the
 * two peers have no way to detect a divergence.
 */

import {
  createSession,
  applyMove,
  activePlayerUin,
  resign,
  rematch,
  reconstruct,
  isOwnersTurn,
} from './engine';

// Stable test UINs. 100 < 200, so 100 is always player1.
const UIN_SMALL = '100';
const UIN_LARGE = '200';

function freshTTT(owner = UIN_SMALL, contact = UIN_LARGE) {
  return createSession('ttt', owner, contact);
}

function freshQuatro(owner = UIN_SMALL, contact = UIN_LARGE) {
  return createSession('quatro', owner, contact);
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('assigns the smaller UIN as player1 regardless of which is Owner', () => {
    const s1 = createSession('ttt', UIN_SMALL, UIN_LARGE);
    expect(s1.player1Uin).toBe(UIN_SMALL);
    expect(s1.player2Uin).toBe(UIN_LARGE);

    // Swap who is the Owner — the assignment must be identical.
    const s2 = createSession('ttt', UIN_LARGE, UIN_SMALL);
    expect(s2.player1Uin).toBe(UIN_SMALL);
    expect(s2.player2Uin).toBe(UIN_LARGE);
  });

  it('works correctly when the Owner has the larger UIN', () => {
    const s = createSession('ttt', UIN_LARGE, UIN_SMALL);
    // The Owner is player2 in this case.
    expect(s.player1Uin).toBe(UIN_SMALL);
    expect(s.ownerUin).toBe(UIN_LARGE);
  });

  it('uses numeric comparison, not lexicographic, for UIN ordering', () => {
    // '9' > '10' lexicographically, but 9 < 10 numerically.
    const s = createSession('ttt', '9', '10');
    expect(s.player1Uin).toBe('9');
  });

  it('starts with an empty move list', () => {
    expect(freshTTT().moves).toEqual([]);
  });

  it('starts with no resignation', () => {
    expect(freshTTT().resigned).toBe(null);
  });

  it('throws if both UINs are the same', () => {
    expect(() => createSession('ttt', '100', '100')).toThrow();
  });

  it('throws for an unknown game id', () => {
    expect(() => createSession('nonexistent', UIN_SMALL, UIN_LARGE)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Turn order
// ---------------------------------------------------------------------------

describe('turn order', () => {
  it('starts with player1 to move', () => {
    const s = freshTTT();
    expect(activePlayerUin(s)).toBe(UIN_SMALL);
  });

  it('switches to player2 after player1 moves', () => {
    const s = freshTTT();
    const { session } = applyMove(s, { cell: 4 }, UIN_SMALL);
    expect(activePlayerUin(session)).toBe(UIN_LARGE);
  });

  it('switches back to player1 after player2 moves', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_LARGE));
    expect(activePlayerUin(s)).toBe(UIN_SMALL);
  });

  it('reports no active player once the game ends', () => {
    // player1 wins top row
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 3 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 1 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 2 }, UIN_SMALL));
    expect(s.state.result).toBe('player1');
    expect(activePlayerUin(s)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// isOwnersTurn
// ---------------------------------------------------------------------------

describe('isOwnersTurn', () => {
  it('returns true when the Owner is player1 and the game just started', () => {
    // Owner = UIN_SMALL = player1 → their turn first.
    const s = createSession('ttt', UIN_SMALL, UIN_LARGE);
    expect(isOwnersTurn(s)).toBe(true);
  });

  it('returns false when the Owner is player2 and the game just started', () => {
    // Owner = UIN_LARGE = player2 → they wait for player1 first.
    const s = createSession('ttt', UIN_LARGE, UIN_SMALL);
    expect(isOwnersTurn(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Out-of-turn rejection
// ---------------------------------------------------------------------------

describe('out-of-turn rejection', () => {
  it('rejects a move from player2 when it is player1\'s turn', () => {
    const s = freshTTT();
    const result = applyMove(s, { cell: 0 }, UIN_LARGE);
    expect(result.error).toBeTruthy();
    expect(result.session).toBeUndefined();
  });

  it('rejects a move from player1 when it is player2\'s turn', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    const result = applyMove(s, { cell: 0 }, UIN_SMALL);
    expect(result.error).toBeTruthy();
    expect(result.session).toBeUndefined();
  });

  it('rejects a move from an unrecognised UIN', () => {
    const result = applyMove(freshTTT(), { cell: 0 }, '999');
    expect(result.error).toBeTruthy();
  });

  it('does not alter the session when rejecting an out-of-turn move', () => {
    const s = freshTTT();
    applyMove(s, { cell: 0 }, UIN_LARGE); // rejected
    // The original session is unchanged (immutability).
    expect(s.state.board[0]).toBe(null);
    expect(s.moves).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Illegal-move rejection
// ---------------------------------------------------------------------------

describe('illegal-move rejection', () => {
  it('rejects an occupied cell in TTT', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    const result = applyMove(s, { cell: 4 }, UIN_LARGE);
    expect(result.error).toBeTruthy();
  });

  it('rejects an out-of-bounds cell in TTT', () => {
    const result = applyMove(freshTTT(), { cell: 99 }, UIN_SMALL);
    expect(result.error).toBeTruthy();
  });

  it('rejects a full column in Quatro', () => {
    let s = freshQuatro();
    // Alternate so turns are valid; fill column 0 in 6 moves.
    for (let i = 0; i < 6; i++) {
      const mover = i % 2 === 0 ? UIN_SMALL : UIN_LARGE;
      ({ session: s } = applyMove(s, { col: 0 }, mover));
    }
    // Next move from the current player tries the full column.
    const mover = s.state.turn === 'player1' ? UIN_SMALL : UIN_LARGE;
    const result = applyMove(s, { col: 0 }, mover);
    expect(result.error).toBeTruthy();
  });

  it('rejects any move after the game has ended', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 3 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 1 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 2 }, UIN_SMALL)); // p1 wins
    const result = applyMove(s, { cell: 5 }, UIN_LARGE);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Move list
// ---------------------------------------------------------------------------

describe('move list', () => {
  it('records each accepted move in order', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_LARGE));
    expect(s.moves).toEqual([{ cell: 4 }, { cell: 0 }]);
  });

  it('does not grow the move list when a move is rejected', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    applyMove(s, { cell: 4 }, UIN_LARGE); // rejected (occupied)
    applyMove(s, { cell: 0 }, UIN_SMALL); // rejected (wrong turn)
    expect(s.moves).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Resignation
// ---------------------------------------------------------------------------

describe('resign', () => {
  it('records the resigning player\'s UIN', () => {
    const { session: s } = resign(freshTTT(), UIN_SMALL);
    expect(s.resigned).toBe(UIN_SMALL);
  });

  it('prevents further moves after resignation', () => {
    const { session: s } = resign(freshTTT(), UIN_SMALL);
    const result = applyMove(s, { cell: 0 }, UIN_LARGE);
    expect(result.error).toBeTruthy();
  });

  it('reports no active player after resignation', () => {
    const { session: s } = resign(freshTTT(), UIN_SMALL);
    expect(activePlayerUin(s)).toBe(null);
  });

  it('rejects resignation from an unrecognised UIN', () => {
    const result = resign(freshTTT(), '999');
    expect(result.error).toBeTruthy();
  });

  it('does not mutate the original session', () => {
    const s = freshTTT();
    resign(s, UIN_SMALL);
    expect(s.resigned).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Rematch
// ---------------------------------------------------------------------------

describe('rematch', () => {
  it('returns a fresh session with the same players', () => {
    const s0 = freshTTT();
    const s1 = rematch(s0);
    expect(s1.ownerUin).toBe(s0.ownerUin);
    expect(s1.contactUin).toBe(s0.contactUin);
    expect(s1.player1Uin).toBe(s0.player1Uin);
  });

  it('increments rematchCount', () => {
    const s0 = freshTTT();
    const s1 = rematch(s0);
    expect(s1.rematchCount).toBe(1);
    const s2 = rematch(s1);
    expect(s2.rematchCount).toBe(2);
  });

  it('resets the board and move list', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    const s1 = rematch(s);
    expect(s1.moves).toHaveLength(0);
    expect(s1.state.board.every((c) => c === null)).toBe(true);
  });

  it('clears a previous resignation', () => {
    const { session: resigned } = resign(freshTTT(), UIN_SMALL);
    const s1 = rematch(resigned);
    expect(s1.resigned).toBe(null);
  });

  it('keeps the same player1 assignment — the smaller UIN always goes first', () => {
    const s0 = freshTTT();
    const s1 = rematch(s0);
    expect(s1.player1Uin).toBe(UIN_SMALL);
  });
});

// ---------------------------------------------------------------------------
// Move-list reconstruction
// ---------------------------------------------------------------------------

describe('move-list reconstruction', () => {
  it('reconstructs a Tic-Tac-Toe position identically from its move list', () => {
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 8 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 2 }, UIN_LARGE));

    const rebuilt = reconstruct(s, s.moves);
    expect(rebuilt.board).toEqual(s.state.board);
    expect(rebuilt.turn).toBe(s.state.turn);
    expect(rebuilt.result).toBe(s.state.result);
  });

  it('reconstructs a Quatro position identically from its move list', () => {
    let s = freshQuatro();
    ({ session: s } = applyMove(s, { col: 3 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { col: 3 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { col: 4 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { col: 2 }, UIN_LARGE));

    const rebuilt = reconstruct(s, s.moves);
    expect(rebuilt.board).toEqual(s.state.board);
    expect(rebuilt.turn).toBe(s.state.turn);
  });

  it('reconstructs a finished game, including the result', () => {
    // player1 wins TTT top row.
    let s = freshTTT();
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 3 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 1 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 2 }, UIN_SMALL));

    expect(s.state.result).toBe('player1');
    const rebuilt = reconstruct(s, s.moves);
    expect(rebuilt.result).toBe('player1');
    expect(rebuilt.board).toEqual(s.state.board);
  });

  it('two peers starting with the same UINs reconstruct the same position', () => {
    // Simulate: peer A is Owner=UIN_SMALL, peer B is Owner=UIN_LARGE.
    // Both receive the same moves in the same order.
    const moves = [{ cell: 4 }, { cell: 0 }, { cell: 8 }];

    const sessionA = createSession('ttt', UIN_SMALL, UIN_LARGE);
    const sessionB = createSession('ttt', UIN_LARGE, UIN_SMALL);

    const stateA = reconstruct(sessionA, moves);
    const stateB = reconstruct(sessionB, moves);

    expect(stateA.board).toEqual(stateB.board);
    expect(stateA.turn).toBe(stateB.turn);
    expect(stateA.result).toBe(stateB.result);
  });

  it('an empty move list reconstructs the initial state', () => {
    const s = freshTTT();
    const rebuilt = reconstruct(s, []);
    expect(rebuilt.board).toEqual(s.state.board);
    expect(rebuilt.turn).toBe('player1');
    expect(rebuilt.result).toBe(null);
  });
});
