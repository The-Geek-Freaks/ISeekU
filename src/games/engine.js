/**
 * The turn protocol for peer-to-peer ICQ games.
 *
 * Both peers run the same code and the same rules. The core problem is that
 * neither can trust the other: a move that arrives over the wire might be
 * out of turn, reference a cell that is already occupied, or claim the game
 * ended differently than the local board shows. So every move — whether it
 * came from the keyboard or arrived from the Contact — passes through the same
 * isLegal check before touching the board. The remote end is untrusted input,
 * not a trusted coordinator.
 *
 * Deciding who moves first without a coordinator is the other problem. Two
 * clients who both think of themselves as the Owner cannot both roll a coin
 * and expect to agree. The rule here is symmetric: the player whose UIN is
 * numerically smaller is always Player 1 and moves first. Both peers compute
 * this from the same two UINs and always arrive at the same answer, with no
 * message exchange required.
 *
 * Reproducibility is the hard constraint that validates everything else. If
 * the two peers' boards ever diverge — a bug, a dropped message, a bad client
 * — there is no way to detect it unless the state can be rebuilt from scratch.
 * This engine records every accepted move. Replaying that list through
 * reconstruct() from the initial session reproduces the exact board position.
 * That is what the reconstruction test guards.
 */

import { GAMES_BY_ID } from './rules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Which UIN is Player 1 (moves first)?
 *
 * UINs are strings of decimal digits. The comparison converts them to BigInt
 * so that '9' < '10' rather than '9' > '1' (lexicographic order would flip
 * the answer for numeric near-neighbours).
 */
function player1Uin(uinA, uinB) {
  return BigInt(uinA) <= BigInt(uinB) ? uinA : uinB;
}

function player2Uin(uinA, uinB) {
  return BigInt(uinA) <= BigInt(uinB) ? uinB : uinA;
}

/** Map a UIN to the 'player1' / 'player2' token the rules module uses. */
function uinToRole(session, uin) {
  if (uin === session.player1Uin) return 'player1';
  if (uin === session.player2Uin) return 'player2';
  return null;
}

/** Map a 'player1' / 'player2' token back to the UIN. */
function roleToUin(session, role) {
  return role === 'player1' ? session.player1Uin : session.player2Uin;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a new game session.
 *
 * ownerUin and contactUin are the two UINs as decimal strings. The game
 * argument is 'ttt' or 'quatro'. Both ends call this with the same two UINs
 * and always get the same Player 1.
 */
export function createSession(game, ownerUin, contactUin) {
  const rules = GAMES_BY_ID[game];
  if (!rules) throw new Error(`Unknown game: ${game}`);
  if (!ownerUin || !contactUin) throw new Error('Both UINs are required.');
  if (ownerUin === contactUin) throw new Error('A game requires two different UINs.');

  const p1 = player1Uin(ownerUin, contactUin);
  const p2 = player2Uin(ownerUin, contactUin);

  return {
    game,
    ownerUin,
    contactUin,
    player1Uin: p1,
    player2Uin: p2,
    state: rules.initialState(),
    moves: [],
    resigned: null,       // null | UIN of whoever resigned
    rematchCount: 0,
  };
}

/**
 * Apply a move from the player identified by moverUin.
 *
 * Validates turn order first, then legality. Returns { session } on success
 * or { error } on any rejection. The session is always a new object; the
 * original is never modified.
 */
export function applyMove(session, move, moverUin) {
  if (session.state.result !== null) {
    return { error: 'The game is already over.' };
  }
  if (session.resigned !== null) {
    return { error: 'The game ended by resignation.' };
  }

  const moverRole = uinToRole(session, moverUin);
  if (moverRole === null) {
    return { error: 'Unrecognised player.' };
  }

  // Turn order: the state's .turn field says whose turn it is.
  if (session.state.turn !== moverRole) {
    return { error: 'It is not that player\'s turn.' };
  }

  const rules = GAMES_BY_ID[session.game];
  if (!rules.isLegal(session.state, move)) {
    return { error: 'That move is not legal in the current position.' };
  }

  const newState = rules.applyMove(session.state, move);
  const newMoves = [...session.moves, move];

  return {
    session: { ...session, state: newState, moves: newMoves },
  };
}

/**
 * The UIN of whoever should move next. Returns null when the game is over
 * or has been resigned.
 */
export function activePlayerUin(session) {
  if (session.state.result !== null || session.resigned !== null) return null;
  return roleToUin(session, session.state.turn);
}

/**
 * Record that a player has resigned. The session is marked finished; no
 * further moves can be applied to it.
 */
export function resign(session, resigningUin) {
  const role = uinToRole(session, resigningUin);
  if (role === null) return { error: 'Unrecognised player.' };
  if (session.resigned !== null) return { error: 'The game has already ended.' };
  if (session.state.result !== null) return { error: 'The game has already ended.' };

  return { session: { ...session, resigned: resigningUin } };
}

/**
 * Start a fresh game between the same two players.
 *
 * Player 1 is always the same person (the one with the smaller UIN), so the
 * rematch is fair rather than alternating. rematchCount increments so each
 * session is distinguishable by its full identity.
 */
export function rematch(session) {
  const rules = GAMES_BY_ID[session.game];
  return {
    game: session.game,
    ownerUin: session.ownerUin,
    contactUin: session.contactUin,
    player1Uin: session.player1Uin,
    player2Uin: session.player2Uin,
    state: rules.initialState(),
    moves: [],
    resigned: null,
    rematchCount: session.rematchCount + 1,
  };
}

/**
 * Rebuild the exact board position from a session's move list.
 *
 * reconstruct(session, session.moves) must always equal session.state,
 * because the state is defined entirely by the move sequence. Both peers can
 * call this at any point to verify they agree on the position.
 */
export function reconstruct(session, moves) {
  const rules = GAMES_BY_ID[session.game];
  let state = rules.initialState();
  for (const move of moves) {
    state = rules.applyMove(state, move);
  }
  return state;
}

/**
 * Whether the Owner is the one who should move next.
 *
 * Convenience predicate for the UI: the compose area should be active when
 * this returns true, and should show "waiting for Contact" when it returns false.
 */
export function isOwnersTurn(session) {
  return activePlayerUin(session) === session.ownerUin;
}
