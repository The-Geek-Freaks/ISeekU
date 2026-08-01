/*
 * Tests for GameSession.
 *
 * The four scenarios the task requires:
 *   1. An invitation arriving and being accepted.
 *   2. A move arriving and being applied.
 *   3. An illegal move arriving and being refused.
 *   4. Resignation.
 *
 * Each is exercised through the rendered component — no unit-testing of the
 * signal handler in isolation, because the point is that inbound signals
 * produce visible UI changes and that the engine's rejection surfaces as a
 * board that has not changed.
 *
 * Owner UIN = '100', contact UIN = '200'. 100 < 200 numerically, so the Owner
 * is always player1 and moves first.
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import GameSession from './GameSession';

const OWNER_UIN  = '100';
const CONTACT_UIN = '200';
const CONTACT_JID = `${CONTACT_UIN}@icq.im`;

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Set up window.api with the ICQ stubs GameSession needs.
 * Returns `sendSignal` (a mock fn) and `getSignalCallback` (returns the
 * callback registered by onSignal, so tests can fire signals directly).
 */
function buildApi({ ownerUin = OWNER_UIN } = {}) {
  let signalCallback = null;
  const sendSignal = jest.fn().mockResolvedValue({});
  window.api = {
    icq: {
      getStatus: jest.fn().mockResolvedValue({ account: { uin: ownerUin } }),
      sendSignal,
      onSignal: jest.fn().mockImplementation((cb) => {
        signalCallback = cb;
        return () => { signalCallback = null; };
      }),
    },
  };
  return {
    sendSignal,
    getSignalCallback: () => signalCallback,
  };
}

/**
 * Deliver a game signal from the Contact. Wrapped in act so React flushes the
 * resulting state updates before any assertion runs.
 */
function fireSignal(getCallback, signal, { from = CONTACT_JID, family = 'game' } = {}) {
  act(() => {
    getCallback()?.({ signal, from, family });
  });
}

/**
 * Render a fresh GameSession and wait for the owner UIN to be resolved from
 * the mocked getStatus call before returning. All tests that exercise inbound
 * signals need the UIN to be ready first.
 */
async function renderAndWaitForUin(props = {}) {
  const controls = buildApi(props);
  render(
    <GameSession
      jid={CONTACT_JID}
      contactName="Bob"
      {...props}
    />,
  );
  await waitFor(() => expect(window.api.icq.getStatus).toHaveBeenCalled());
  return controls;
}

afterEach(() => {
  delete window.api;
});

// ── 1. Invitation arriving and being accepted ─────────────────────────────────

describe('invitation arriving and being accepted', () => {
  it('shows an Accept and Decline button when a game-invite arrives', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, { type: 'game-invite', game: 'ttt' });

    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });

  it('names the game in the invitation dialogue', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, { type: 'game-invite', game: 'quatro' });

    expect(screen.getByText(/Quatro/)).toBeInTheDocument();
  });

  it('names the Contact in the invitation dialogue', async () => {
    const controls = buildApi();
    render(<GameSession jid={CONTACT_JID} contactName="Alice" />);
    await waitFor(() => expect(window.api.icq.getStatus).toHaveBeenCalled());

    fireSignal(controls.getSignalCallback, { type: 'game-invite', game: 'ttt' });

    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('sends game-accept and shows the board when the Owner accepts', async () => {
    const user = userEvent.setup();
    const { getSignalCallback, sendSignal } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, { type: 'game-invite', game: 'ttt' });
    await user.click(screen.getByRole('button', { name: /accept/i }));

    expect(sendSignal).toHaveBeenCalledWith(CONTACT_JID, { type: 'game-accept' });
    // A nine-cell TTT grid means the board is visible.
    expect(screen.getAllByRole('gridcell')).toHaveLength(9);
  });

  it('sends game-accept for a Quatro invite and shows the Quatro board', async () => {
    const user = userEvent.setup();
    const { getSignalCallback, sendSignal } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, { type: 'game-invite', game: 'quatro' });
    await user.click(screen.getByRole('button', { name: /accept/i }));

    expect(sendSignal).toHaveBeenCalledWith(CONTACT_JID, { type: 'game-accept' });
    // 42 grid cells (6 × 7) confirm it is a Quatro board.
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  });

  it('sends game-decline and hides the dialogue when the Owner declines', async () => {
    const user = userEvent.setup();
    const { getSignalCallback, sendSignal } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, { type: 'game-invite', game: 'ttt' });
    await user.click(screen.getByRole('button', { name: /decline/i }));

    expect(sendSignal).toHaveBeenCalledWith(CONTACT_JID, { type: 'game-decline' });
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('ignores a game-invite for an unknown game id', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, { type: 'game-invite', game: 'chess' });

    // Nothing surfaces — an unknown game is dropped.
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('ignores signals from a different Contact', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    // Signal from a JID that is NOT the one this GameSession watches.
    fireSignal(getSignalCallback, { type: 'game-invite', game: 'ttt' }, {
      from: '999@icq.im',
    });

    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('strips the resource from the sender JID before comparing', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    // The stanza's from attribute may carry a resource.
    fireSignal(getSignalCallback, { type: 'game-invite', game: 'ttt' }, {
      from: `${CONTACT_JID}/ISeekU-hostname`,
    });

    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
  });
});

// ── 2. A move arriving and being applied ─────────────────────────────────────

describe('a move arriving and being applied', () => {
  /**
   * Put the component into the 'playing' phase by simulating an invite
   * from the Contact followed by the Owner accepting.
   */
  async function reachPlayingPhase() {
    const user = userEvent.setup();
    const controls = await renderAndWaitForUin();

    fireSignal(controls.getSignalCallback, { type: 'game-invite', game: 'ttt' });
    await user.click(screen.getByRole('button', { name: /accept/i }));

    return { user, ...controls };
  }

  it('applies a valid move from the Contact and marks the cell on the board', async () => {
    const { user, getSignalCallback } = await reachPlayingPhase();

    // Owner (player1) moves first — click cell 0 on the board.
    const cells = screen.getAllByRole('gridcell');
    await user.click(cells[0]);

    // Now it is player2's (Contact's) turn. Deliver a valid move.
    fireSignal(getSignalCallback, { type: 'game-move', move: { cell: 4 } });

    // Cell 4 should now show 'O' (player2).
    expect(screen.getAllByRole('gridcell')[4]).toHaveTextContent('O');
  });

  it('sends game-move when the Owner makes a valid move', async () => {
    const { user, sendSignal } = await reachPlayingPhase();

    // Owner (player1) clicks cell 3.
    const cells = screen.getAllByRole('gridcell');
    await user.click(cells[3]);

    expect(sendSignal).toHaveBeenCalledWith(CONTACT_JID, { type: 'game-move', move: { cell: 3 } });
  });
});

// ── 3. An illegal move arriving and being refused ─────────────────────────────

describe('an illegal move arriving and being refused', () => {
  async function reachPlayingPhase() {
    const user = userEvent.setup();
    const controls = await renderAndWaitForUin();

    fireSignal(controls.getSignalCallback, { type: 'game-invite', game: 'ttt' });
    await user.click(screen.getByRole('button', { name: /accept/i }));

    return { user, ...controls };
  }

  it('does not update the board when the Contact moves out of turn', async () => {
    // Owner = player1, starts first. Contact = player2 cannot legally move yet.
    const { getSignalCallback } = await reachPlayingPhase();

    // Contact tries to move to cell 4 before the Owner has moved — out of turn.
    fireSignal(getSignalCallback, { type: 'game-move', move: { cell: 4 } });

    // Board must still be completely empty.
    const cells = screen.getAllByRole('gridcell');
    expect(cells.every((c) => c.textContent === '')).toBe(true);
  });

  it('does not update the board when the Contact sends a non-object move', async () => {
    const { getSignalCallback } = await reachPlayingPhase();

    // A string in the move field is a protocol error from a bad client.
    fireSignal(getSignalCallback, { type: 'game-move', move: 'hack' });

    const cells = screen.getAllByRole('gridcell');
    expect(cells.every((c) => c.textContent === '')).toBe(true);
  });

  it('does not update the board when the Contact sends an occupied cell', async () => {
    const { user, getSignalCallback } = await reachPlayingPhase();

    // Owner takes cell 4 first.
    await user.click(screen.getAllByRole('gridcell')[4]);

    // Contact takes their turn at cell 0.
    fireSignal(getSignalCallback, { type: 'game-move', move: { cell: 0 } });

    // Owner takes cell 1.
    await user.click(screen.getAllByRole('gridcell')[1]);

    // Contact tries to replay cell 0 — that cell is already occupied.
    fireSignal(getSignalCallback, { type: 'game-move', move: { cell: 0 } });

    // Cell 0 must still show 'O' (player2's first move), not change again.
    expect(screen.getAllByRole('gridcell')[0]).toHaveTextContent('O');
    // Only three cells should be filled (4 = X, 0 = O, 1 = X).
    const cells = screen.getAllByRole('gridcell');
    const filled = cells.filter((c) => c.textContent !== '');
    expect(filled).toHaveLength(3);
  });
});

// ── 4. Resignation ────────────────────────────────────────────────────────────

describe('resignation', () => {
  async function reachPlayingPhase() {
    const user = userEvent.setup();
    const controls = await renderAndWaitForUin();

    fireSignal(controls.getSignalCallback, { type: 'game-invite', game: 'ttt' });
    await user.click(screen.getByRole('button', { name: /accept/i }));

    return { user, ...controls };
  }

  it('marks the game as over when the Contact resigns', async () => {
    const { getSignalCallback } = await reachPlayingPhase();

    fireSignal(getSignalCallback, { type: 'game-resign' });

    // GameBoard's status element should reflect the resignation.
    expect(screen.getByRole('status')).toHaveTextContent(/resigned/i);
  });

  it('shows the Rematch button after the Contact resigns', async () => {
    const { getSignalCallback } = await reachPlayingPhase();

    fireSignal(getSignalCallback, { type: 'game-resign' });

    expect(screen.getByRole('button', { name: /rematch/i })).toBeInTheDocument();
  });

  it('sends game-resign and ends the game when the Owner resigns', async () => {
    const { user, sendSignal } = await reachPlayingPhase();

    await user.click(screen.getByRole('button', { name: /resign/i }));

    expect(sendSignal).toHaveBeenCalledWith(CONTACT_JID, { type: 'game-resign' });
    expect(screen.getByRole('status')).toHaveTextContent(/resigned/i);
    expect(screen.getByRole('button', { name: /rematch/i })).toBeInTheDocument();
  });

  it('sends game-rematch and resets the board when the Owner requests a rematch', async () => {
    const { user, sendSignal } = await reachPlayingPhase();

    // End the game via the Owner's resignation.
    await user.click(screen.getByRole('button', { name: /resign/i }));

    await user.click(screen.getByRole('button', { name: /rematch/i }));

    expect(sendSignal).toHaveBeenCalledWith(CONTACT_JID, { type: 'game-rematch' });
    // After rematch the board resets to nine empty cells.
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(9);
    expect(cells.every((c) => c.textContent === '')).toBe(true);
  });
});
