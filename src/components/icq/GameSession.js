/*
 * Wires the game engine to the peer signal channel.
 *
 * Both peers run identical code and identical rules. The engine validates every
 * move — including ones that arrive from the Contact — before they touch the
 * board. This component owns nothing about the rules themselves; it only
 * translates between the signal protocol (game-invite, game-move, etc.) and
 * the engine calls, then passes the resulting session to GameBoard as a prop.
 *
 * Signal listener lifetime: `onSignal` is registered once per jid. The
 * callback calls through `signalHandlerRef`, which is re-assigned on every
 * render so the handler always sees the latest state without the listener
 * needing to be torn down and re-registered whenever state changes.
 *
 * Sending an invite: the parent sets `initiateGame` to a game id, which
 * triggers the invite send in a useEffect. `handledInviteRef` prevents the
 * same invite being sent twice if the parent re-renders before clearing the
 * prop via `onInitiateClear`.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createSession, applyMove, resign, rematch } from '../../games/engine';
import { GAMES_BY_ID } from '../../games/rules';
import GameBoard from './GameBoard';

/** The local-part of an ICQ JID is the UIN. */
function uinFromJid(jid) {
  return typeof jid === 'string' ? jid.split('@')[0] : '';
}

/** Strip the resource from a full JID before comparing against a stored bare JID. */
function bareJid(jid) {
  return typeof jid === 'string' ? jid.split('/')[0] : '';
}

/**
 * Owns the full lifecycle of a single peer game session.
 *
 * Props:
 *   jid            — bare JID of the Contact (e.g. "123456@icq.im")
 *   contactName    — display name for the Contact
 *   initiateGame   — null normally; set to 'ttt' or 'quatro' to send an invite
 *   onInitiateClear — called once the invite has been sent, so the parent can
 *                    reset initiateGame to null
 */
export default function GameSession({ jid, contactName = 'Contact', initiateGame, onInitiateClear }) {
  const [ownerUin, setOwnerUin] = useState(null);
  const [phase, setPhase] = useState('idle');
  // 'idle' | 'inviting' | 'invited' | 'playing' | 'declined'
  const [session, setSession] = useState(null);
  const [inviteGameId, setInviteGameId] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');

  const contactUin = uinFromJid(jid);

  // Fetch the Owner's UIN once — the connection must already be up for the
  // games menu to be reachable, so the status call should resolve quickly.
  useEffect(() => {
    window.api?.icq?.getStatus?.()
      .then((status) => {
        if (status?.account?.uin) setOwnerUin(String(status.account.uin));
      })
      .catch(() => {});
  }, []);

  // Send an invite when the parent hands us a game id, but only once per value.
  // The ref prevents the effect from re-firing on re-renders that happen before
  // onInitiateClear resets the prop to null.
  const handledInviteRef = useRef(null);
  useEffect(() => {
    if (!initiateGame || initiateGame === handledInviteRef.current || !ownerUin) return;
    handledInviteRef.current = initiateGame;
    window.api?.icq?.sendSignal?.(jid, { type: 'game-invite', game: initiateGame });
    setInviteGameId(initiateGame);
    setPhase('inviting');
    onInitiateClear?.();
  }, [initiateGame, ownerUin, jid, onInitiateClear]);

  // The signal handler is re-assigned each render so it always closes over the
  // latest state. The registered listener just calls through the ref, which
  // means one registration lasts the entire lifetime of this jid.
  const signalHandlerRef = useRef(null);
  signalHandlerRef.current = ({ signal, from, family }) => {
    if (family !== 'game' || bareJid(from) !== jid) return;

    switch (signal.type) {
      case 'game-invite': {
        // Validate the game id before surfacing the invitation — an unknown
        // id is either a future game type or a malformed signal.
        const gameId = typeof signal.game === 'string' ? signal.game : '';
        if (!GAMES_BY_ID[gameId]) return;
        setInviteGameId(gameId);
        setPhase('invited');
        break;
      }
      case 'game-accept': {
        if (phase !== 'inviting' || !ownerUin || !inviteGameId) break;
        setSession(createSession(inviteGameId, ownerUin, contactUin));
        setPhase('playing');
        break;
      }
      case 'game-decline': {
        if (phase !== 'inviting') break;
        setStatusMsg(`${contactName} declined your invitation.`);
        setPhase('declined');
        break;
      }
      case 'game-move': {
        if (phase !== 'playing' || !session) break;
        const move = signal.move;
        // The move object is untrusted peer input — a non-object is a protocol error.
        if (!move || typeof move !== 'object' || Array.isArray(move)) break;
        const result = applyMove(session, move, contactUin);
        if (result.error) {
          // The engine rejected the peer's move: either a bug on the far end
          // or a deliberate attempt to play out of turn or into an illegal cell.
          // The boards are now out of sync; log it so a developer can investigate.
          console.warn('[GameSession] rejected peer move:', result.error);
          break;
        }
        setSession(result.session);
        break;
      }
      case 'game-resign': {
        if (phase !== 'playing' || !session) break;
        const result = resign(session, contactUin);
        if (!result.error) setSession(result.session);
        break;
      }
      case 'game-rematch': {
        // The contact wants to play again. Accept immediately — both peers
        // call rematch() independently when they send or receive this signal,
        // so no second handshake is needed.
        const over = session && (session.state.result !== null || session.resigned !== null);
        if (!over) break;
        setSession(rematch(session));
        setStatusMsg('');
        setPhase('playing');
        break;
      }
      default:
        break;
    }
  };

  // Register once per jid; call through the ref so state is always current.
  useEffect(() => {
    if (!window.api?.icq?.onSignal) return;
    const unsub = window.api.icq.onSignal((data) => signalHandlerRef.current?.(data));
    return unsub;
  }, [jid]);

  // ── Owner actions ──────────────────────────────────────────────────────────

  const handleAccept = () => {
    if (!ownerUin || !inviteGameId) return;
    window.api?.icq?.sendSignal?.(jid, { type: 'game-accept' });
    setSession(createSession(inviteGameId, ownerUin, contactUin));
    setPhase('playing');
  };

  const handleDecline = () => {
    window.api?.icq?.sendSignal?.(jid, { type: 'game-decline' });
    setPhase('idle');
    setInviteGameId(null);
  };

  const handleOwnerMove = (move) => {
    if (!session || !ownerUin) return;
    const result = applyMove(session, move, ownerUin);
    // GameBoard already showed a rejection message for the two most common
    // illegal cases; any remaining error is something the engine caught first.
    if (result.error) return;
    window.api?.icq?.sendSignal?.(jid, { type: 'game-move', move });
    setSession(result.session);
  };

  const handleResign = () => {
    if (!session || !ownerUin) return;
    const result = resign(session, ownerUin);
    if (result.error) return;
    window.api?.icq?.sendSignal?.(jid, { type: 'game-resign' });
    setSession(result.session);
  };

  const handleRematch = () => {
    if (!session) return;
    const over = session.state.result !== null || session.resigned !== null;
    if (!over) return;
    window.api?.icq?.sendSignal?.(jid, { type: 'game-rematch' });
    setSession(rematch(session));
    setStatusMsg('');
    setPhase('playing');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase === 'idle') return null;

  if (phase === 'inviting') {
    return (
      <div className="game-session game-session--inviting" role="status">
        Waiting for {contactName} to accept your invitation…
      </div>
    );
  }

  if (phase === 'invited') {
    const gameName = GAMES_BY_ID[inviteGameId]?.name || inviteGameId;
    return (
      <div className="game-session game-session--invited" role="dialog" aria-label="Game invitation">
        <p>
          <strong>{contactName}</strong> invites you to play <strong>{gameName}</strong>.
        </p>
        <div className="game-session-actions">
          <button className="win98-btn" onClick={handleAccept}>Accept</button>
          <button className="win98-btn" onClick={handleDecline}>Decline</button>
        </div>
      </div>
    );
  }

  if (phase === 'declined') {
    return (
      <div className="game-session game-session--declined" role="status">
        <p>{statusMsg}</p>
      </div>
    );
  }

  if (phase === 'playing' && session) {
    const over = session.state.result !== null || session.resigned !== null;
    return (
      <div className="game-session game-session--playing">
        <GameBoard
          session={session}
          ownerUin={ownerUin}
          contactName={contactName}
          onMove={handleOwnerMove}
        />
        <div className="game-session-actions">
          {!over && (
            <button className="win98-btn" onClick={handleResign}>Resign</button>
          )}
          {over && (
            <button className="win98-btn" onClick={handleRematch}>Rematch</button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
