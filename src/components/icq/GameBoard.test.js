/*
 * Tests for the GameBoard component.
 *
 * The engine tests in src/games/engine.test.js already prove that applyMove,
 * isOwnersTurn and the win detector work correctly with raw objects. These tests
 * are about the component's own behaviour: that it renders from the session
 * prop rather than its own state, that illegal clicks produce a visible message
 * rather than silence, and that keyboard navigation works as a grid widget.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import GameBoard from './GameBoard';
import { createSession, applyMove } from '../../games/engine';

// Two stable test UINs. 100 < 200 numerically, so UIN_SMALL is always player1.
const UIN_SMALL = '100';
const UIN_LARGE = '200';

function freshTtt(owner = UIN_SMALL, contact = UIN_LARGE) {
  return createSession('ttt', owner, contact);
}

function freshQuatro(owner = UIN_SMALL, contact = UIN_LARGE) {
  return createSession('quatro', owner, contact);
}

// Advance the timer that clears rejection messages.
jest.useFakeTimers();

// ---------------------------------------------------------------------------
// Tic-Tac-Toe rendering
// ---------------------------------------------------------------------------

describe('Tic-Tac-Toe rendering', () => {
  it('renders nine cells in the grid', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(9);
  });

  it('shows the game name in the header', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    expect(screen.getByText('Tic-Tac-Toe')).toBeInTheDocument();
  });

  it('shows the Contact name in the header', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} contactName="Alice" onMove={() => {}} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('marks played cells with X or O', () => {
    // After player1 takes centre, cell 4 should show X.
    let s = freshTtt();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    render(<GameBoard session={s} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells[4]).toHaveTextContent('X');
    expect(cells[0]).toHaveTextContent('');
  });

  it('marks player2 cells as O', () => {
    let s = freshTtt();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_LARGE));
    render(<GameBoard session={s} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells[0]).toHaveTextContent('O');
  });
});

// ---------------------------------------------------------------------------
// Quatro rendering
// ---------------------------------------------------------------------------

describe('Quatro rendering', () => {
  it('renders seven drop buttons', () => {
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    expect(screen.getAllByRole('button', { name: /Drop in column/ })).toHaveLength(7);
  });

  it('renders 42 piece cells in the grid', () => {
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    // The drop buttons are role="button" not role="gridcell". The piece grid
    // cells are role="gridcell". 6 rows × 7 cols = 42.
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  });

  it('shows the game name Quatro in the header', () => {
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    expect(screen.getByText('Quatro')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Status line
// ---------------------------------------------------------------------------

describe('status line', () => {
  it('says "Your move." when it is the Owner\'s turn', () => {
    // Owner = UIN_SMALL = player1 → their turn first.
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Your move.');
  });

  it('says "Waiting for Contact…" when it is the Contact\'s turn', () => {
    // Session where the Owner is player2 (larger UIN) so they wait for player1 first.
    render(<GameBoard session={freshTtt(UIN_LARGE, UIN_SMALL)} ownerUin={UIN_LARGE} onMove={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Waiting for/);
  });

  it('includes the Contact\'s name in the waiting message', () => {
    render(<GameBoard session={freshTtt(UIN_LARGE, UIN_SMALL)} ownerUin={UIN_LARGE} contactName="Bob" onMove={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Bob');
  });

  it('announces the winner when the game ends', () => {
    // Player1 wins top row: cells 0, 1, 2.
    let s = freshTtt();
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 3 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 1 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 2 }, UIN_SMALL));
    render(<GameBoard session={s} ownerUin={UIN_SMALL} contactName="Bob" onMove={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('You won!');
  });

  it('says "Draw!" on a filled board with no winner', () => {
    // Fill TTT without a winner.
    // p1 ends with {0,1,5,6,7} and p2 with {2,3,4,8} — neither set contains
    // a win line, and every cell is occupied.
    let s = freshTtt();
    const moveSeq = [
      [0, UIN_SMALL], [2, UIN_LARGE], [1, UIN_SMALL], [3, UIN_LARGE],
      [5, UIN_SMALL], [4, UIN_LARGE], [6, UIN_SMALL], [8, UIN_LARGE], [7, UIN_SMALL],
    ];
    for (const [cell, uin] of moveSeq) {
      ({ session: s } = applyMove(s, { cell }, uin));
    }
    expect(s.state.result).toBe('draw');
    render(<GameBoard session={s} ownerUin={UIN_SMALL} onMove={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Draw!');
  });

  it('names the Contact as the winner when they win', () => {
    // Player2 wins — Owner is player1 (UIN_SMALL) and lost.
    let s = freshTtt();
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 3 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 1 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 8 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 5 }, UIN_LARGE)); // player2 wins column 3-4-5
    render(<GameBoard session={s} ownerUin={UIN_SMALL} contactName="Bob" onMove={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Bob won!');
  });

  it('says who resigned when the game ends by resignation', () => {
    const { session: s } = { session: { ...freshTtt(), resigned: UIN_SMALL } };
    render(<GameBoard session={s} ownerUin={UIN_SMALL} onMove={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('You resigned.');
  });
});

// ---------------------------------------------------------------------------
// Move interaction — the engine test
// ---------------------------------------------------------------------------

describe('move interaction', () => {
  it('calls onMove with the correct move when the Owner clicks a cell', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMove = jest.fn();
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={onMove} />);
    const cells = screen.getAllByRole('gridcell');
    await user.click(cells[2]);
    expect(onMove).toHaveBeenCalledWith({ cell: 2 });
  });

  it('calls onMove with { col } when the Owner drops a Quatro piece', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMove = jest.fn();
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={onMove} />);
    const drops = screen.getAllByRole('button', { name: /Drop in column/ });
    await user.click(drops[3]);
    expect(onMove).toHaveBeenCalledWith({ col: 3 });
  });

  it('does not mutate the board when onMove is called — the board comes from the session prop', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMove = jest.fn();
    const session = freshTtt();
    render(<GameBoard session={session} ownerUin={UIN_SMALL} onMove={onMove} />);

    const cells = screen.getAllByRole('gridcell');
    await user.click(cells[4]);

    // onMove was called, but the board still shows the original empty state
    // because the component reads from session.state.board, not its own state.
    expect(onMove).toHaveBeenCalled();
    expect(cells[4]).toHaveTextContent(''); // cell is still empty
  });

  it('reflects the updated board after the parent passes a new session', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    let capturedMove;
    const onMove = (move) => { capturedMove = move; };

    const { rerender } = render(
      <GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={onMove} />,
    );

    const cells = screen.getAllByRole('gridcell');
    await user.click(cells[4]);

    // Simulate the parent applying the move through the engine and re-rendering.
    let s = freshTtt();
    ({ session: s } = applyMove(s, capturedMove, UIN_SMALL));
    rerender(<GameBoard session={s} ownerUin={UIN_SMALL} onMove={onMove} />);

    expect(screen.getAllByRole('gridcell')[4]).toHaveTextContent('X');
  });
});

// ---------------------------------------------------------------------------
// Rejection messages
// ---------------------------------------------------------------------------

describe('rejection messages', () => {
  it('shows a rejection when the Owner clicks out of turn and does not call onMove', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMove = jest.fn();
    // Owner is UIN_LARGE = player2, so it is player1's turn first.
    render(<GameBoard session={freshTtt()} ownerUin={UIN_LARGE} onMove={onMove} />);
    const cells = screen.getAllByRole('gridcell');
    await user.click(cells[0]);
    expect(screen.getByRole('status')).toHaveTextContent(/Waiting for/);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('shows a rejection when the Owner clicks an occupied cell', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMove = jest.fn();
    let s = freshTtt();
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_SMALL));
    // Now it is player2's turn, but we render with Owner=UIN_LARGE so it is their turn.
    render(<GameBoard session={s} ownerUin={UIN_LARGE} onMove={onMove} />);
    const cells = screen.getAllByRole('gridcell');
    await user.click(cells[4]); // cell 4 is already taken
    expect(screen.getByRole('status')).toHaveTextContent(/occupied/i);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('clears the rejection message after a delay', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<GameBoard session={freshTtt()} ownerUin={UIN_LARGE} onMove={() => {}} />);
    await user.click(screen.getAllByRole('gridcell')[0]);
    // The rejection message is specific: "Waiting for Contact to move."
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Contact to move.');

    act(() => { jest.advanceTimersByTime(2001); });
    // After the timer fires the rejection is gone and the normal status returns.
    // The normal status for this scenario is "Waiting for Contact…" — the ellipsis
    // distinguishes it from the rejection's "to move." suffix.
    expect(screen.getByRole('status')).not.toHaveTextContent('to move.');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Contact…');
  });

  it('shows a rejection when the Owner tries to drop into a full Quatro column', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMove = jest.fn();
    let s = freshQuatro();
    // Fill column 0 by alternating players so no four-in-a-row forms vertically.
    // Pieces fall from bottom (row 5) to top (row 0). Six drops fill the column.
    // Turn sequence: P1, P2, P1, P2, P1, P2 → column full, now P1's turn.
    for (let i = 0; i < 6; i++) {
      const uin = i % 2 === 0 ? UIN_SMALL : UIN_LARGE;
      ({ session: s } = applyMove(s, { col: 0 }, uin));
    }
    // It is now UIN_SMALL's (player1) turn. Column 0 is completely full.
    render(<GameBoard session={s} ownerUin={UIN_SMALL} onMove={onMove} />);
    const drops = screen.getAllByRole('button', { name: /Drop in column/ });
    await user.click(drops[0]);
    expect(screen.getByRole('status')).toHaveTextContent(/column is full/i);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('shows a rejection when the Owner tries to move after the game is over', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onMove = jest.fn();
    let s = freshTtt();
    ({ session: s } = applyMove(s, { cell: 0 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 3 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 1 }, UIN_SMALL));
    ({ session: s } = applyMove(s, { cell: 4 }, UIN_LARGE));
    ({ session: s } = applyMove(s, { cell: 2 }, UIN_SMALL)); // player1 wins
    render(<GameBoard session={s} ownerUin={UIN_SMALL} onMove={onMove} />);
    await user.click(screen.getAllByRole('gridcell')[5]);
    expect(screen.getByRole('status')).toHaveTextContent(/already over/i);
    expect(onMove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation — Tic-Tac-Toe
// ---------------------------------------------------------------------------

describe('keyboard navigation in Tic-Tac-Toe', () => {
  it('gives cell 4 (centre) tabIndex 0 by default', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells[4].tabIndex).toBe(0);
    expect(cells[0].tabIndex).toBe(-1);
  });

  it('moves the focusable cell right with ArrowRight', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Tic-Tac-Toe' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    const cells = screen.getAllByRole('gridcell');
    expect(cells[5].tabIndex).toBe(0);
    expect(cells[4].tabIndex).toBe(-1);
  });

  it('moves the focusable cell left with ArrowLeft', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Tic-Tac-Toe' });
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    const cells = screen.getAllByRole('gridcell');
    expect(cells[3].tabIndex).toBe(0);
  });

  it('moves the focusable cell down with ArrowDown', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Tic-Tac-Toe' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    const cells = screen.getAllByRole('gridcell');
    expect(cells[7].tabIndex).toBe(0);
  });

  it('moves the focusable cell up with ArrowUp', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Tic-Tac-Toe' });
    fireEvent.keyDown(grid, { key: 'ArrowUp' });
    const cells = screen.getAllByRole('gridcell');
    expect(cells[1].tabIndex).toBe(0);
  });

  it('does not move past the right edge', () => {
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Tic-Tac-Toe' });
    // Start at 4, move right twice — should stop at 5 (right edge of middle row).
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    const cells = screen.getAllByRole('gridcell');
    expect(cells[5].tabIndex).toBe(0);
  });

  it('submits the focused cell on Enter', () => {
    const onMove = jest.fn();
    render(<GameBoard session={freshTtt()} ownerUin={UIN_SMALL} onMove={onMove} />);
    const grid = screen.getByRole('grid', { name: 'Tic-Tac-Toe' });
    // focusIdx starts at 4; Enter should submit cell 4.
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith({ cell: 4 });
  });
});

// ---------------------------------------------------------------------------
// Keyboard navigation — Quatro
// ---------------------------------------------------------------------------

describe('keyboard navigation in Quatro', () => {
  it('gives column 3 (centre) tabIndex 0 by default', () => {
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const drops = screen.getAllByRole('button', { name: /Drop in column/ });
    expect(drops[3].tabIndex).toBe(0);
    expect(drops[0].tabIndex).toBe(-1);
  });

  it('moves the focusable column right with ArrowRight', () => {
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Quatro' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    const drops = screen.getAllByRole('button', { name: /Drop in column/ });
    expect(drops[4].tabIndex).toBe(0);
  });

  it('moves the focusable column left with ArrowLeft', () => {
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Quatro' });
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    const drops = screen.getAllByRole('button', { name: /Drop in column/ });
    expect(drops[2].tabIndex).toBe(0);
  });

  it('does not move past column 6 (the rightmost)', () => {
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={() => {}} />);
    const grid = screen.getByRole('grid', { name: 'Quatro' });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(grid, { key: 'ArrowRight' });
    const drops = screen.getAllByRole('button', { name: /Drop in column/ });
    expect(drops[6].tabIndex).toBe(0);
  });

  it('submits the focused column on Enter', () => {
    const onMove = jest.fn();
    render(<GameBoard session={freshQuatro()} ownerUin={UIN_SMALL} onMove={onMove} />);
    const grid = screen.getByRole('grid', { name: 'Quatro' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onMove).toHaveBeenCalledWith({ col: 3 });
  });
});
