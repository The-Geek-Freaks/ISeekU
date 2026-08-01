/**
 * Peer-to-peer file transfer, sender and receiver side, for one Contact.
 *
 * ── Why this lives in the renderer ──────────────────────────────────────────
 *
 * The WebRTC data channel that carries the file bytes is opened by
 * createPeerConnection (src/peerConnection.js), which also lives in the
 * renderer because the renderer is Chromium and already has RTCPeerConnection.
 * All of the actual transfer logic therefore runs here.
 *
 * ── Why icq-p2p.js is not imported directly ─────────────────────────────────
 *
 * electron/lib/icq-p2p.js calls `require('crypto')` at module level. The
 * renderer runs with nodeIntegration: false and contextIsolation: true, so
 * Node.js built-ins are not available, and CRA/webpack does not polyfill
 * `crypto` as a module. Importing the file would therefore fail at bundle
 * time. The solution used here: window.crypto.subtle (SubtleCrypto), which
 * Chromium provides natively and which produces identical SHA-256 output.
 *
 * The constants (CHUNK_SIZE, DRAIN_THRESHOLD) and the state-machine strings
 * are copied verbatim from icq-p2p.js so both sides of any future mixed
 * Node/browser scenario stay in sync.
 *
 * ── Signal protocol ──────────────────────────────────────────────────────────
 *
 * Transfer-layer (XMPP, before the data channel opens):
 *   p2p-offer   sender → receiver   propose the transfer
 *   p2p-accept  receiver → sender   agree to receive
 *   p2p-reject  receiver → sender   refuse
 *   p2p-cancel  either → other      abort at any point
 *
 * WebRTC-layer (XMPP, to negotiate the data channel):
 *   call-offer  sender → receiver   SDP offer with callId = transferId
 *   call-answer receiver → sender   SDP answer with callId = transferId
 *   call-ice    either → other      ICE candidate with callId = transferId
 *
 * Data-channel messages (JSON strings over WebRTC):
 *   { type:'chunk', transferId, seq, total, chunkHash, data:base64 }
 *   { type:'transfer-done', transferId, sha256 }
 *
 * All signal payloads are validated before being acted on. A peer controls
 * every byte we receive from it.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPeerConnection, iceConfiguration } from '../../peerConnection';
import './FileTransfer.css';

// ── Constants — must match icq-p2p.js exactly ─────────────────────────────────

/** 16 KiB per chunk — the largest single message that passes reliably across
 *  all WebRTC data channel implementations. Matches icq-p2p.js CHUNK_SIZE. */
const CHUNK_SIZE = 16 * 1024;

/** Once bufferedAmount exceeds this the sender waits for a drain event.
 *  Matches icq-p2p.js DEFAULT_DRAIN_THRESHOLD. */
const DRAIN_THRESHOLD = 256 * 1024;

/** Transfer states — string values match icq-p2p.js STATES. */
const S = Object.freeze({
  OFFERING:          'offering',           // sender waiting for decision
  AWAITING_DECISION: 'awaiting-decision',  // receiver, Owner must decide
  TRANSFERRING:      'transferring',       // data channel open, bytes moving
  DONE:              'done',               // completed and integrity-verified
  REJECTED:          'rejected',           // receiver refused
  CANCELLED:         'cancelled',          // cancelled by either party
  ERROR:             'error',              // integrity failure or route problem
});

const TERMINAL = new Set([S.DONE, S.REJECTED, S.CANCELLED, S.ERROR]);

// ── SHA-256 helpers ───────────────────────────────────────────────────────────

/** SHA-256 of a Uint8Array as a lowercase hex string.
 *  Uses window.crypto.subtle instead of Node.js crypto (unavailable here). */
async function sha256hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const hashBuf = await window.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Split a Uint8Array into CHUNK_SIZE slices and compute the whole-file SHA-256.
 *  Mirrors icq-p2p.js splitFile() but uses the async Web Crypto API. */
async function prepareFile(fileBytes) {
  const chunks = [];
  let offset = 0;
  while (offset < fileBytes.length) {
    chunks.push(fileBytes.slice(offset, offset + CHUNK_SIZE));
    offset += CHUNK_SIZE;
  }
  // An empty file yields one zero-length chunk so totalChunks is never zero.
  if (chunks.length === 0) chunks.push(new Uint8Array(0));
  const fileSha256 = await sha256hex(fileBytes);
  return { chunks, sha256: fileSha256 };
}

/** Wait until the peer connection's send buffer has drained below the threshold.
 *  icq-p2p.js exposes canSendNext() as a predicate; we poll because
 *  peerConnection.js does not expose the data channel's bufferedamountlow event. */
function waitForDrain(conn) {
  return new Promise(resolve => {
    const check = () => {
      if (conn.bufferedAmount() <= DRAIN_THRESHOLD) { resolve(); return; }
      setTimeout(check, 20);
    };
    check();
  });
}

/** Encode a Uint8Array to a base64 string without TextDecoder to stay
 *  within the range btoa() accepts. */
function uint8ToBase64(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str);
}

/** Decode a base64 string back to a Uint8Array. */
function base64ToUint8(b64) {
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

/** The local-part of an ICQ JID is the UIN. */
function uinFromJid(jid) {
  return typeof jid === 'string' ? jid.split('@')[0] : '';
}

/** Strip the resource from a full JID before comparing against a bare JID. */
function bareJid(jid) {
  return typeof jid === 'string' ? jid.split('/')[0] : '';
}

/** Format bytes/s as a human-readable rate string. */
function fmtRate(bytesPerSec) {
  if (bytesPerSec === null) return '';
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

/** Format bytes as a human-readable size string. */
function fmtSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Owns the full lifecycle of one peer-to-peer file transfer with a Contact.
 *
 * Props:
 *   jid           — bare JID of the Contact (e.g. "123456@icq.im")
 *   contactName   — display name for the Contact
 *   triggerFile   — null normally; set to a file path to initiate a send
 *   onTriggerClear — called once the trigger file has been handled
 */
export default function FileTransfer({ jid, contactName = 'Contact', triggerFile, onTriggerClear }) {
  const [ownerUin, setOwnerUin] = useState(null);

  // UI-visible session state. null means no active transfer.
  const [xfer, setXfer] = useState(null);

  // Holds the SHA-256 and transferId from a transfer-done packet when it
  // arrives before all chunks have been processed. The useEffect below watches
  // for all chunks to arrive and then triggers reassembly.
  const [pendingDone, setPendingDone] = useState(null);

  // Non-serialisable transfer data: the peer connection (complex mutable object
  // with callbacks) and the pre-split chunk array (potentially large Uint8Array
  // slice objects). Neither belongs in React state.
  const connRef      = useRef(null);
  const chunksRef    = useRef(null);   // Uint8Array[] for the current send session
  const loopActiveRef = useRef(false); // prevents two concurrent send loops

  // Fetch the Owner's UIN once. Needed to author the p2p-offer signal.
  useEffect(() => {
    window.api?.icq?.getStatus?.()
      .then(status => { if (status?.account?.uin) setOwnerUin(String(status.account.uin)); })
      .catch(() => {});
  }, []);

  // Send an XMPP signal to this Contact.
  const sendSignal = useCallback((payload) => {
    window.api?.icq?.sendSignal?.(jid, payload);
  }, [jid]);

  // ── Sender: open the WebRTC connection and run the send loop ─────────────────

  const startSenderConn = useCallback(async (session) => {
    if (connRef.current) connRef.current.close();

    const conn = createPeerConnection({
      contactJid: jid,
      caller: true,
      iceConfig: iceConfiguration(),
      // ICE candidates use call-ice with the transferId as callId so the
      // receiver can route them to this session rather than a voice call.
      sendSignal: p => sendSignal({ ...p, callId: session.transferId }),
      label: 'iseeku-xfer',
    });
    connRef.current = conn;

    conn.on('onOpen', async () => {
      // Data channel is open. Run the send loop guarded by the active ref
      // so a second call (impossible under normal operation) cannot overlap.
      if (loopActiveRef.current) return;
      loopActiveRef.current = true;
      try {
        await runSendLoop(conn, session);
      } finally {
        loopActiveRef.current = false;
      }
    });

    conn.on('onFailed', ({ reason }) => {
      setXfer(s => s && !TERMINAL.has(s.state) ? { ...s, state: S.ERROR, reason } : s);
    });

    conn.on('onClosed', () => {
      setXfer(s => {
        if (!s || TERMINAL.has(s.state)) return s;
        return { ...s, state: S.ERROR, reason: 'The connection closed before the transfer finished.' };
      });
    });

    const { sdp, error } = await conn.start();
    if (error) {
      setXfer(s => s ? { ...s, state: S.ERROR, reason: error } : s);
      return;
    }
    sendSignal({ type: 'call-offer', callId: session.transferId, sdp });
  }, [jid, sendSignal]);

  // ── Receiver: open the WebRTC connection and wait for chunks ─────────────────

  const startAnswererConn = useCallback(async (session, remoteSdp) => {
    if (connRef.current) connRef.current.close();

    const conn = createPeerConnection({
      contactJid: jid,
      caller: false,
      iceConfig: iceConfiguration(),
      sendSignal: p => sendSignal({ ...p, callId: session.transferId }),
      label: 'iseeku-xfer',
    });
    connRef.current = conn;

    conn.on('onFailed', ({ reason }) => {
      setXfer(s => s && !TERMINAL.has(s.state) ? { ...s, state: S.ERROR, reason } : s);
    });

    conn.on('onClosed', () => {
      setXfer(s => {
        if (!s || TERMINAL.has(s.state)) return s;
        return { ...s, state: S.ERROR, reason: 'The connection closed before the transfer finished.' };
      });
    });

    conn.on('onMessage', (raw) => {
      let packet;
      try { packet = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); }
      catch { return; }
      if (!packet || typeof packet !== 'object') return;
      handleDataMessage(packet);
    });

    const { sdp, error } = await conn.accept(remoteSdp);
    if (error) {
      setXfer(s => s ? { ...s, state: S.ERROR, reason: error } : s);
      return;
    }
    sendSignal({ type: 'call-answer', callId: session.transferId, sdp });
  }, [jid, sendSignal]);
  // ── Send loop (sender side) ──────────────────────────────────────────────────

  async function runSendLoop(conn, session) {
    const chunks = chunksRef.current;
    if (!chunks) return;

    let nextChunk = 0;
    let bytesDone = 0;

    while (nextChunk < chunks.length) {
      // icq-p2p.js canSendNext() predicate: stop until the buffer drains.
      if (conn.bufferedAmount() > DRAIN_THRESHOLD) {
        await waitForDrain(conn);
      }
      // If the session moved to a terminal state while we were waiting, stop.
      // We can't read xfer state here (closure), so use loopActiveRef as a
      // cooperative cancellation flag.
      if (!loopActiveRef.current) return;

      const chunkBytes = chunks[nextChunk];
      const chunkHash = await sha256hex(chunkBytes);

      const msg = JSON.stringify({
        type: 'chunk',
        transferId: session.transferId,
        seq: nextChunk,
        total: chunks.length,
        chunkHash,
        data: uint8ToBase64(chunkBytes),
      });

      const result = conn.send(msg);
      if (result.error) {
        setXfer(s => s && !TERMINAL.has(s.state)
          ? { ...s, state: S.ERROR, reason: result.error }
          : s);
        return;
      }

      bytesDone += chunkBytes.length;
      nextChunk += 1;

      setXfer(s => s && s.state === S.TRANSFERRING
        ? { ...s, bytesDone, chunksDone: nextChunk }
        : s);
    }

    // All chunks sent. Send the integrity marker over the data channel so it
    // arrives after the last chunk in channel order.
    conn.send(JSON.stringify({ type: 'transfer-done', transferId: session.transferId, sha256: session.sha256 }));
    setXfer(s => s && s.state === S.TRANSFERRING ? { ...s, state: S.DONE } : s);
  }

  // ── Incoming data channel messages (receiver side) ───────────────────────────

  const handleDataMessage = useCallback(async (packet) => {
    if (!packet || typeof packet.type !== 'string') return;

    if (packet.type === 'chunk') {
      const { transferId, seq, total, chunkHash, data } = packet;

      // A peer controls every field in this message.
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return;
      if (typeof total !== 'number' || typeof chunkHash !== 'string') return;
      if (typeof data !== 'string') return;

      let chunkBytes;
      try { chunkBytes = base64ToUint8(data); }
      catch {
        setXfer(s => s && s.transferId === transferId && !TERMINAL.has(s.state)
          ? { ...s, state: S.ERROR, reason: 'A chunk arrived with data that cannot be decoded.' }
          : s);
        return;
      }

      // Per-chunk integrity check — mirrors icq-p2p.js receiveChunk().
      const actualHash = await sha256hex(chunkBytes);
      if (actualHash !== chunkHash) {
        setXfer(s => s && s.transferId === transferId && !TERMINAL.has(s.state)
          ? { ...s, state: S.ERROR,
              reason: `Chunk ${seq} integrity check failed. The transfer cannot be trusted.` }
          : s);
        return;
      }

      setXfer(s => {
        if (!s || s.transferId !== transferId || s.state !== S.TRANSFERRING) return s;
        if (s.receivedChunks[seq] !== undefined) return s; // duplicate: ignore
        if (seq >= s.totalChunks || total !== s.totalChunks) {
          return { ...s, state: S.ERROR,
            reason: `Chunk sequence ${seq} is out of range for this transfer.` };
        }
        const newChunks = { ...s.receivedChunks, [seq]: chunkBytes };
        const newBytesDone = s.bytesDone + chunkBytes.length;
        const newChunksDone = s.chunksDone + 1;
        return {
          ...s,
          receivedChunks: newChunks,
          bytesDone: newBytesDone,
          chunksDone: newChunksDone,
        };
      });
      return;
    }

    if (packet.type === 'transfer-done') {
      const { transferId, sha256: expectedHash } = packet;
      if (typeof expectedHash !== 'string') return;

      // Store the completion signal via React state so the useEffect below can
      // observe it after all chunk state updates have been committed to the DOM.
      // The direct scheduleReassembly call also handles the common case where
      // all chunks are already in by the time done arrives.
      setPendingDone({ transferId, expectedHash });
      scheduleReassembly(transferId, expectedHash);
    }
  }, []);
  // We store a ref to the latest xfer so handleDataMessage can read it without
  // being in the re-assignment cycle (it's a useCallback, not a plain function).
  const xferRef = useRef(null);
  xferRef.current = xfer;

  const scheduleReassembly = useCallback((transferId, expectedHash) => {
    const s = xferRef.current;
    if (!s || s.transferId !== transferId || s.state !== S.TRANSFERRING) return;
    if (s.chunksDone < s.totalChunks) return; // not all chunks in yet

    const parts = [];
    for (let i = 0; i < s.totalChunks; i++) {
      if (!s.receivedChunks[i]) {
        setXfer(cur => cur ? {
          ...cur, state: S.ERROR,
          reason: `Reassembly failed: chunk ${i} is missing.`,
        } : cur);
        return;
      }
      parts.push(s.receivedChunks[i]);
    }

    const totalLength = parts.reduce((n, c) => n + c.length, 0);
    const fileBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) { fileBuffer.set(part, offset); offset += part.length; }

    sha256hex(fileBuffer).then(actualHash => {
      if (actualHash !== expectedHash) {
        setXfer(cur => cur ? {
          ...cur, state: S.ERROR,
          reason: 'Whole-file integrity check failed. The file may have been tampered with.',
        } : cur);
        return;
      }
      const blob = new Blob([fileBuffer]);
      const fileUrl = URL.createObjectURL(blob);
      setXfer(cur => cur && cur.transferId === transferId
        ? { ...cur, state: S.DONE, fileBuffer, fileUrl }
        : cur);
    });
  }, []);

  // If the done packet arrives before the chunk's async SHA-256 verification
  // has finished (a timing race between the data-channel message handler and the
  // crypto microtask queue), the direct scheduleReassembly call above will see
  // chunksDone = 0 and return early. This effect re-tries once all chunks are
  // committed to the component's state. setPendingDone(null) clears it so only
  // one reassembly attempt fires per transfer.
  useEffect(() => {
    if (!pendingDone || !xfer) return;
    if (xfer.transferId !== pendingDone.transferId) return;
    if (xfer.state !== S.TRANSFERRING) return;
    if (xfer.chunksDone < xfer.totalChunks) return;
    const { transferId, expectedHash } = pendingDone;
    setPendingDone(null);
    scheduleReassembly(transferId, expectedHash);
  }, [pendingDone, xfer, scheduleReassembly]);

  // ── Incoming XMPP signal handling ────────────────────────────────────────────

  // The signal handler is re-assigned each render so it always closes over the
  // latest xfer state, following the same pattern as GameSession.
  const signalHandlerRef = useRef(null);
  signalHandlerRef.current = ({ signal, from, family }) => {
    if (family !== 'transfer' && family !== 'call') return;
    if (bareJid(from) !== bareJid(jid)) return;

    switch (signal.type) {

      // ── Transfer-layer signals ──────────────────────────────────────────────

      case 'p2p-offer': {
        // A Contact is proposing a direct file transfer. Reject immediately
        // if we are already in the middle of one.
        if (xfer && !TERMINAL.has(xfer.state)) {
          sendSignal({ type: 'p2p-reject', transferId: signal.transferId, reason: 'Busy with another transfer.' });
          return;
        }

        // Every field comes from an untrusted peer. Validate strictly before
        // entering any state — a malformed offer is dropped silently.
        //
        // totalChunks must be a positive integer: the sender's prepareFile()
        // always emits at least 1 (even for an empty file), so 0 is always
        // a protocol violation. We also cap it so a huge value cannot keep
        // the receiver in TRANSFERRING indefinitely. At CHUNK_SIZE = 16 KiB
        // the cap is ~1 GiB; larger files should not be offered over a data
        // channel without a dedicated flow-control protocol.
        const MAX_CHUNKS = 65_535;
        const validTotalChunks = (
          typeof signal.totalChunks === 'number' &&
          Number.isInteger(signal.totalChunks) &&
          signal.totalChunks >= 1 &&
          signal.totalChunks <= MAX_CHUNKS
        );
        // size is informational for the UI; it must be a non-negative integer.
        const validSize = (
          typeof signal.size === 'number' &&
          Number.isInteger(signal.size) &&
          signal.size >= 0
        );
        // sha256 must be a 64-character lowercase hex string — the only form
        // SubtleCrypto and Node crypto ever produce. Accepting an arbitrary
        // string would pass the offer check but guarantee ERROR at reassembly.
        const validSha256 = (
          typeof signal.sha256 === 'string' &&
          /^[0-9a-f]{64}$/.test(signal.sha256)
        );
        if (!signal.transferId || !signal.filename ||
            !validSize || !validTotalChunks || !validSha256) {
          return; // malformed offer from a peer — ignore silently
        }
        setXfer({
          role: 'receiver',
          state: S.AWAITING_DECISION,
          transferId: String(signal.transferId),
          filename: String(signal.filename),
          size: signal.size,
          totalChunks: signal.totalChunks,
          sha256: String(signal.sha256),
          fromUin: String(signal.fromUin || uinFromJid(from)),
          toUin: ownerUin || '',
          receivedChunks: {},
          bytesDone: 0,
          chunksDone: 0,
          startedAt: null,
          reason: null,
          fileUrl: null,
          fileBuffer: null,
        });
        break;
      }

      case 'p2p-accept': {
        if (!xfer || xfer.state !== S.OFFERING || xfer.transferId !== signal.transferId) break;
        // The receiver accepted. Transition to TRANSFERRING and open the
        // WebRTC connection as the caller (the sender always dials).
        const nowMs = Date.now();
        const session = { ...xfer, state: S.TRANSFERRING, startedAt: nowMs };
        setXfer(session);
        startSenderConn(session);
        break;
      }

      case 'p2p-reject': {
        if (!xfer || xfer.state !== S.OFFERING || xfer.transferId !== signal.transferId) break;
        setXfer(s => ({ ...s, state: S.REJECTED, reason: signal.reason || 'Declined.' }));
        break;
      }

      case 'p2p-cancel': {
        if (!xfer || xfer.transferId !== signal.transferId) break;
        if (TERMINAL.has(xfer.state)) break;
        connRef.current?.close();
        connRef.current = null;
        loopActiveRef.current = false;
        setXfer(s => s ? { ...s, state: S.CANCELLED, reason: signal.reason || 'Cancelled by peer.' } : s);
        break;
      }

      // ── WebRTC-layer signals ────────────────────────────────────────────────
      // The `call-*` types carry SDP and ICE for the data channel. The `callId`
      // field ties each signal to the matching transfer session.

      case 'call-offer': {
        if (!xfer || xfer.role !== 'receiver' || xfer.transferId !== signal.callId) break;
        if (xfer.state !== S.TRANSFERRING) break;
        startAnswererConn(xfer, signal.sdp);
        break;
      }

      case 'call-answer': {
        if (!xfer || xfer.role !== 'sender' || xfer.transferId !== signal.callId) break;
        if (!connRef.current) break;
        connRef.current.complete(signal.sdp).catch(() => {});
        break;
      }

      case 'call-ice': {
        if (!connRef.current) break;
        if (xfer && signal.callId && xfer.transferId !== signal.callId) break;
        connRef.current.addCandidate(signal.candidate).catch(() => {});
        break;
      }

      default:
        break;
    }
  };

  // Register one signal listener per JID for the lifetime of this component.
  useEffect(() => {
    if (!window.api?.icq?.onSignal) return;
    const unsub = window.api.icq.onSignal((data) => signalHandlerRef.current?.(data));
    return unsub;
  }, [jid]);

  // ── Trigger: the Owner picked a file to send ─────────────────────────────────

  const handledTriggerRef = useRef(null);
  useEffect(() => {
    if (!triggerFile || triggerFile === handledTriggerRef.current || !ownerUin) return;
    if (xfer && !TERMINAL.has(xfer.state)) {
      // Already busy — do not start a second transfer.
      onTriggerClear?.();
      return;
    }
    handledTriggerRef.current = triggerFile;
    onTriggerClear?.();

    (async () => {
      let fileBytes;
      try {
        const dataUrl = await window.api?.readFileDataUrl?.(triggerFile);
        if (!dataUrl) return;
        const base64 = dataUrl.split(',')[1];
        if (!base64) return;
        fileBytes = base64ToUint8(base64);
      } catch (err) {
        return;
      }

      const { chunks, sha256 } = await prepareFile(fileBytes);
      const filename = triggerFile.replace(/.*[\\/]/, '');
      const toUin = uinFromJid(jid);
      const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      chunksRef.current = chunks;

      const offer = {
        type: 'p2p-offer',
        transferId,
        fromUin: ownerUin,
        toUin,
        filename,
        size: fileBytes.length,
        totalChunks: chunks.length,
        sha256,
      };
      sendSignal(offer);

      setXfer({
        role: 'sender',
        state: S.OFFERING,
        transferId,
        fromUin: ownerUin,
        toUin,
        filename,
        size: fileBytes.length,
        totalChunks: chunks.length,
        sha256,
        bytesDone: 0,
        chunksDone: 0,
        startedAt: null,
        reason: null,
        fileUrl: null,
        fileBuffer: null,
      });
    })();
  }, [triggerFile, ownerUin, jid, xfer, onTriggerClear, sendSignal]);

  // ── Owner actions ─────────────────────────────────────────────────────────────

  const handleAccept = () => {
    if (!xfer || xfer.state !== S.AWAITING_DECISION) return;
    const nowMs = Date.now();
    sendSignal({ type: 'p2p-accept', transferId: xfer.transferId });
    const accepting = { ...xfer, state: S.TRANSFERRING, startedAt: nowMs };
    setXfer(accepting);
    // The sender will now send call-offer; the signal handler picks it up.
  };

  const handleDecline = () => {
    if (!xfer || xfer.state !== S.AWAITING_DECISION) return;
    sendSignal({ type: 'p2p-reject', transferId: xfer.transferId, reason: 'Declined.' });
    setXfer(s => s ? { ...s, state: S.REJECTED, reason: 'Declined.' } : s);
  };

  const handleCancel = () => {
    if (!xfer || TERMINAL.has(xfer.state)) return;
    sendSignal({ type: 'p2p-cancel', transferId: xfer.transferId, reason: 'Cancelled.' });
    connRef.current?.close();
    connRef.current = null;
    loopActiveRef.current = false;
    setXfer(s => s ? { ...s, state: S.CANCELLED, reason: 'Cancelled.' } : s);
  };

  const handleDismiss = () => {
    if (xfer?.fileUrl) URL.revokeObjectURL(xfer.fileUrl);
    setXfer(null);
    connRef.current?.close();
    connRef.current = null;
  };

  // ── Progress computation ─────────────────────────────────────────────────────

  const progressInfo = (() => {
    if (!xfer || xfer.state !== S.TRANSFERRING) return null;
    const elapsed = xfer.startedAt ? Date.now() - xfer.startedAt : 0;
    const rate = elapsed > 0 && xfer.bytesDone > 0
      ? (xfer.bytesDone / elapsed) * 1000
      : null;
    const pct = xfer.size > 0 ? Math.round((xfer.bytesDone / xfer.size) * 100) : 0;
    return { pct, rate };
  })();

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!xfer) return null;

  const label = xfer.role === 'sender' ? 'Sending' : 'Receiving';

  if (xfer.state === S.OFFERING) {
    return (
      <div className="ft ft--offering" role="status">
        <span className="ft-icon">📎</span>
        <span className="ft-info">
          Offering <strong>{xfer.filename}</strong> ({fmtSize(xfer.size)}) to {contactName}…
        </span>
        <button className="ft-btn" onClick={handleCancel}>Cancel</button>
      </div>
    );
  }

  if (xfer.state === S.AWAITING_DECISION) {
    return (
      <div className="ft ft--decision" role="dialog" aria-label="File transfer offer">
        <span className="ft-icon">📎</span>
        <span className="ft-info">
          <strong>{contactName}</strong> wants to send you{' '}
          <strong>{xfer.filename}</strong> ({fmtSize(xfer.size)}).
        </span>
        <div className="ft-actions">
          <button className="win98-btn" onClick={handleAccept}>Accept</button>
          <button className="win98-btn" onClick={handleDecline}>Decline</button>
        </div>
      </div>
    );
  }

  if (xfer.state === S.TRANSFERRING) {
    const pct = progressInfo?.pct ?? 0;
    const rate = progressInfo?.rate ?? null;
    return (
      <div className="ft ft--transferring" role="status">
        <span className="ft-icon">📎</span>
        <div className="ft-body">
          <span className="ft-label">{label} <strong>{xfer.filename}</strong></span>
          <div className="ft-progress-wrap" aria-label={`${pct}%`}>
            <div className="ft-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="ft-bytes">
            {fmtSize(xfer.bytesDone)} / {fmtSize(xfer.size)}
            {rate !== null && ` — ${fmtRate(rate)}`}
          </span>
        </div>
        <button className="ft-btn" onClick={handleCancel}>Cancel</button>
      </div>
    );
  }

  if (xfer.state === S.DONE) {
    return (
      <div className="ft ft--done" role="status">
        <span className="ft-icon">✓</span>
        <span className="ft-info">
          {xfer.role === 'sender'
            ? <><strong>{xfer.filename}</strong> sent to {contactName}.</>
            : <>
                <strong>{xfer.filename}</strong> received.{' '}
                {xfer.fileUrl && (
                  <a href={xfer.fileUrl} download={xfer.filename} className="ft-download">
                    Save file
                  </a>
                )}
              </>
          }
        </span>
        <button className="ft-btn" onClick={handleDismiss}>Dismiss</button>
      </div>
    );
  }

  if (xfer.state === S.REJECTED) {
    return (
      <div className="ft ft--rejected" role="status">
        <span className="ft-icon">✕</span>
        <span className="ft-info">{contactName} declined the transfer.</span>
        <button className="ft-btn" onClick={handleDismiss}>Dismiss</button>
      </div>
    );
  }

  if (xfer.state === S.CANCELLED) {
    return (
      <div className="ft ft--cancelled" role="status">
        <span className="ft-icon">✕</span>
        <span className="ft-info">Transfer cancelled.</span>
        <button className="ft-btn" onClick={handleDismiss}>Dismiss</button>
      </div>
    );
  }

  if (xfer.state === S.ERROR) {
    return (
      <div className="ft ft--error" role="alert">
        <span className="ft-icon">⚠</span>
        <span className="ft-info">{xfer.reason || 'Transfer failed.'}</span>
        <button className="ft-btn" onClick={handleDismiss}>Dismiss</button>
      </div>
    );
  }

  return null;
}
