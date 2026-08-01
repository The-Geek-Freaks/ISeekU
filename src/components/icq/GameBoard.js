/*
 * The in-window board for Tic-Tac-Toe and Quatro.
 *
 * ICQ shipped both games as Flash peer-to-peer applets over OSCAR's rendezvous
 * channel. Flash died in 2020 and the originals cannot be distributed. What is
 * honest to rebuild is the gameplay itself — the same rules, the same board,
 * the same feel — running as pure logic over the text connection that already
 * exists. This component is the visual half of that rebuild.
 *
 * The firm boundary between this file and engine.js is the point of the design.
 * The engine handles rules, turn order, win detection and the move list. This
 * component handles pixels, keyboard focus and one narrow piece of state: the
 * short-lived rejection message shown when a click is refused. The board it
 * draws is always session.state.board from the prop. After the Owner clicks a
 * cell it calls onMove(move) and stops there; the parent is responsible for
 * running applyMove and passing back the updated session. That separation is
 * what makes the "a move goes through the engine" test possible: if the board
 * ever updated its own board state directly, the test would not be able to
 * catch the difference.
 *
 * The hard part in the UI is the illegal-click path. Silently ignoring a click
 * on an occupied cell — or during the Contact's turn — looks like a lag spike.
 * The player repeats it, nothing moves, and the game seems broken. So a
 * rejected click sets a short-lived status message. The component can determine
 * two rejection reasons itself without calling the engine: whose turn it is
 * (from isOwnersTurn) and whether a TTT cell or Quatro column is already taken
 * (directly from the board array). Anything beyond that goes through onMove.
 *
 * Keyboard play uses the roving tabIndex pattern. Only one cell in the grid has
 * tabIndex 0 at any moment; arrow keys move it; Enter submits the focused cell.
 * This is the standard ARIA grid widget behaviour and the least surprising thing
 * for anyone not using a mouse.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { activePlayerUin } from '../../games/engine';
import './GameBoard.css';

/** How long a rejection message stays before the status line returns. */
const ERROR_CLEAR_MS = 2000;

// ---------------------------------------------------------------------------
// Tic-Tac-Toe sub-board
// ---------------------------------------------------------------------------

function TttBoard({ session, onMove }) {
  // Centre cell is the natural starting focus — it is where most openings begin.
  const [focusIdx, setFocusIdx] = useState(4);
  const gridRef = useRef(null);
  const { board } = session.state;

  // Sync the real DOM focus to match the tracked index whenever it changes via
  // keyboard. Not on mount — only user navigation should pull focus into the grid.
  useEffect(() => {
    const btn = gridRef.current?.querySelector(`[data-cell="${focusIdx}"]`);
    btn?.focus();
  }, [focusIdx]);

  const handleKeyDown = useCallback((e) => {
    const col = focusIdx % 3;
    const row = Math.floor(focusIdx / 3);

    if (e.key === 'ArrowRight' && col < 2) {
      e.preventDefault();
      setFocusIdx(focusIdx + 1);
    } else if (e.key === 'ArrowLeft' && col > 0) {
      e.preventDefault();
      setFocusIdx(focusIdx - 1);
    } else if (e.key === 'ArrowDown' && row < 2) {
      e.preventDefault();
      setFocusIdx(focusIdx + 3);
    } else if (e.key === 'ArrowUp' && row > 0) {
      e.preventDefault();
      setFocusIdx(focusIdx - 3);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onMove({ cell: focusIdx });
    }
  }, [focusIdx, onMove]);

  return (
    <div
      ref={gridRef}
      className="icq-game-board icq-game-board--ttt"
      role="grid"
      aria-label="Tic-Tac-Toe"
      onKeyDown={handleKeyDown}
    >
      {board.map((value, idx) => (
        <button
          key={idx}
          type="button"
          role="gridcell"
          className={`icq-game-cell${value ? ` icq-game-cell--${value}` : ''}`}
          data-cell={idx}
          data-value={value || ''}
          aria-label={value === 'player1' ? 'X' : value === 'player2' ? 'O' : `Cell ${idx + 1}`}
          tabIndex={focusIdx === idx ? 0 : -1}
          onClick={() => onMove({ cell: idx })}
          onFocus={() => setFocusIdx(idx)}
        >
          <span aria-hidden="true">
            {value === 'player1' ? 'X' : value === 'player2' ? 'O' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quatro sub-board
// ---------------------------------------------------------------------------

function QuatroBoard({ session, onMove }) {
  // Middle column as default: gravity-based games draw the eye to the centre.
  const [focusCol, setFocusCol] = useState(3);
  const dropsRef = useRef(null);
  const { board } = session.state;
  const COLS = 7;

  useEffect(() => {
    const btn = dropsRef.current?.querySelector(`[data-col="${focusCol}"]`);
    btn?.focus();
  }, [focusCol]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFocusCol((c) => Math.min(c + 1, COLS - 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFocusCol((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onMove({ col: focusCol });
    }
  }, [focusCol, onMove]);

  return (
    <div
      className="icq-game-board icq-game-board--quatro"
      role="grid"
      aria-label="Quatro"
      onKeyDown={handleKeyDown}
    >
      {/* One drop button per column — the piece falls under gravity from there. */}
      <div ref={dropsRef} className="icq-game-drops" role="row">
        {Array.from({ length: COLS }, (_, col) => (
          <button
            key={col}
            type="button"
            className={`icq-game-drop${board[0][col] !== null ? ' icq-game-drop--full' : ''}`}
            data-col={col}
            aria-label={`Drop in column ${col + 1}`}
            tabIndex={focusCol === col ? 0 : -1}
            onClick={() => onMove({ col })}
            onFocus={() => setFocusCol(col)}
          >
            ▼
          </button>
        ))}
      </div>

      {/* The 6 × 7 piece grid, rows from the top down. */}
      {board.map((row, r) => (
        <div key={r} className="icq-game-row" role="row">
          {row.map((value, c) => (
            <div
              key={c}
              role="gridcell"
              aria-label={value === 'player1' ? 'X' : value === 'player2' ? 'O' : 'empty'}
              className={`icq-game-piece${value ? ` icq-game-piece--${value}` : ''}`}
              data-value={value || ''}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

/**
 * Renders a Tic-Tac-Toe or Quatro board from a live session.
 *
 * Props:
 *   session      — the current session from engine.createSession / applyMove
 *   ownerUin     — the Owner's UIN as a decimal string
 *   contactName  — display name for the Contact (used in the status line)
 *   onMove(move) — called when the Owner makes a move that passes local
 *                  validation; the parent calls applyMove and returns the
 *                  updated session as a new prop
 */
export default function GameBoard({ session, ownerUin, contactName = 'Contact', onMove }) {
  const [rejection, setRejection] = useState(null);
  const rejectTimer = useRef(null);

  // Cancel any pending clear on unmount — setState after unmount is a warning.
  useEffect(() => () => clearTimeout(rejectTimer.current), []);

  const refuse = useCallback((msg) => {
    setRejection(msg);
    clearTimeout(rejectTimer.current);
    rejectTimer.current = setTimeout(() => setRejection(null), ERROR_CLEAR_MS);
  }, []);

  const handleMove = useCallback((move) => {
    if (session.state.result !== null || session.resigned !== null) {
      refuse('The game is already over.');
      return;
    }
    if (activePlayerUin(session) !== ownerUin) {
      refuse(`Waiting for ${contactName} to move.`);
      return;
    }
    // Immediate feedback for the two most common illegal cases. The engine
    // would catch them anyway, but showing the message here avoids the parent
    // round-trip and makes the UI feel instant.
    if (session.game === 'ttt' && move.cell !== undefined) {
      if (session.state.board[move.cell] !== null) {
        refuse('That cell is already occupied.');
        return;
      }
    }
    if (session.game === 'quatro' && move.col !== undefined) {
      if (session.state.board[0][move.col] !== null) {
        refuse('That column is full.');
        return;
      }
    }
    onMove?.(move);
  }, [session, ownerUin, contactName, onMove, refuse]);

  const { result } = session.state;
  const over = result !== null || session.resigned !== null;
  // Use the ownerUin prop rather than session.ownerUin so the component's view
  // of "whose turn is it" matches the caller's declaration of who the Owner is.
  const ownersTurn = activePlayerUin(session) === ownerUin;

  let statusLine;
  if (session.resigned !== null) {
    const resignerName = session.resigned === ownerUin ? 'You' : contactName;
    statusLine = `${resignerName} resigned.`;
  } else if (result === 'draw') {
    statusLine = 'Draw!';
  } else if (result !== null) {
    const winnerUin = result === 'player1' ? session.player1Uin : session.player2Uin;
    const winnerName = winnerUin === ownerUin ? 'You' : contactName;
    statusLine = `${winnerName} won!`;
  } else if (ownersTurn) {
    statusLine = 'Your move.';
  } else {
    statusLine = `Waiting for ${contactName}…`;
  }

  const BoardComponent = session.game === 'quatro' ? QuatroBoard : TttBoard;
  const gameName = session.game === 'quatro' ? 'Quatro' : 'Tic-Tac-Toe';

  return (
    <div
      className="icq-gameboard"
      data-game={session.game}
      data-over={over ? 'true' : undefined}
    >
      <div className="icq-gameboard-header">
        <span className="icq-gameboard-title">{gameName}</span>
        <span className="icq-gameboard-vs">vs {contactName}</span>
      </div>

      <div
        className={`icq-gameboard-status${rejection ? ' icq-gameboard-status--rejected' : ''}`}
        role="status"
        aria-live="polite"
      >
        {rejection || statusLine}
      </div>

      <BoardComponent session={session} onMove={handleMove} />
    </div>
  );
}
