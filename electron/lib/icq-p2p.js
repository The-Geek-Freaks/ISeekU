/**
 * Protocol and state machine for peer-to-peer file transfer over a WebRTC data channel.
 *
 * A data channel gives two peers a reliable, ordered byte stream, but nothing
 * in the WebRTC spec says how to carve a 2 GB file into that stream, what to
 * do when the send buffer runs ahead of the network, or how to know the file
 * arrived uncorrupted. This module is that layer — the framing, chunking,
 * integrity checking, backpressure model, and state machine that sit between
 * the application and the channel.
 *
 * The biggest trap with data channels is `bufferedAmount`. The spec allows
 * single messages of any size, but several implementations — Firefox 63 and
 * older mobile WebViews being the most widely encountered — silently close the
 * channel when a message exceeds 64 KiB. The send buffer is also unbounded:
 * if the sender never pauses to let it drain, a large transfer exhausts memory
 * before the first megabyte leaves the machine. The safe interoperable chunk
 * size is 16 KiB; `canSendNext()` encodes the drain check as a pure predicate
 * so the sending loop can pause without any timer or callback inside this module.
 *
 * Chunk order cannot be assumed even though a data channel is nominally
 * ordered, because the *caller* might send chunks from multiple channels or
 * dispatch them across event boundaries that fire out of sequence. The receiver
 * stores every chunk in a map keyed by sequence number and reassembles only
 * when the last chunk arrives. A missing or duplicated chunk is caught before
 * any bytes are written.
 *
 * Timestamps are injected by the caller rather than read from `Date.now()` so
 * that progress calculations in tests are fully deterministic. This module
 * never reads the clock.
 *
 * This module is pure logic. It never opens a channel, never calls `Date.now()`,
 * and has no I/O. The caller is responsible for: negotiating WebRTC and opening
 * the data channel, routing XMPP signalling messages to the right session, and
 * running the send loop with `canSendNext()` as the gate.
 *
 * ── Signal shapes (plain serialisable objects, sent over XMPP before the
 *    data channel opens) ──────────────────────────────────────────────────────
 *
 *   Offer  (sender → receiver):
 *     { type: 'p2p-offer', transferId: string, fromUin: string, toUin: string,
 *       filename: string, size: number, totalChunks: number, sha256: string }
 *
 *   Accept (receiver → sender):
 *     { type: 'p2p-accept', transferId: string }
 *
 *   Reject (receiver → sender):
 *     { type: 'p2p-reject', transferId: string, reason: string }
 *
 *   Cancel (either party → the other):
 *     { type: 'p2p-cancel', transferId: string, reason: string }
 *
 * ── Chunk packets (plain objects, sent over the WebRTC data channel) ─────────
 *
 *   Chunk:
 *     { type: 'chunk', transferId: string, seq: number, total: number,
 *       chunkHash: string, data: Buffer }
 *     `chunkHash` is the SHA-256 hex digest of `data` alone.
 *
 *   Transfer done (sender → receiver, after the last chunk):
 *     { type: 'transfer-done', transferId: string, sha256: string }
 *     `sha256` is the SHA-256 of the complete file, which the receiver checks
 *     against the reassembled buffer. Sent over the data channel (not XMPP)
 *     so it arrives after the last chunk in channel order.
 */

'use strict';

const crypto = require('crypto');

/**
 * 16 KiB per chunk — the largest single message that passes reliably across
 * all WebRTC data channel implementations. The spec allows larger messages,
 * but several implementations (Firefox before ~63, older Android WebViews)
 * silently close the channel on receipt of a message exceeding 64 KiB. 16 KiB
 * is conservative enough that no implementation objects to it, and the overhead
 * of an extra round of sequencing is negligible compared to the cost of a
 * failed transfer.
 */
const CHUNK_SIZE = 16 * 1024;

/**
 * Once `bufferedAmount` exceeds this level the sender should stop until the
 * channel drains. 256 KiB is 16 chunks in flight — enough to saturate the
 * channel on a LAN without letting the internal buffer run away on slow links.
 */
const DEFAULT_DRAIN_THRESHOLD = 256 * 1024;

/** Every state the session can be in, named as the interface will see them. */
const STATES = Object.freeze({
  IDLE:              'idle',               // created, no offer made
  OFFERING:          'offering',           // sender waiting for the receiver's decision
  AWAITING_DECISION: 'awaiting-decision',  // receiver has seen offer, Owner must decide
  TRANSFERRING:      'transferring',       // transfer active on both sides
  DONE:              'done',               // completed and integrity-verified
  REJECTED:          'rejected',           // receiver refused the offer
  CANCELLED:         'cancelled',          // cancelled by either party (mid-flight or pre-transfer)
  ERROR:             'error',              // integrity check failed or protocol violation
});

/** Terminal states: once reached, no further transitions are expected. */
const TERMINAL_STATES = new Set([
  STATES.DONE, STATES.REJECTED, STATES.CANCELLED, STATES.ERROR,
]);

/** SHA-256 of a Buffer, as a lowercase hex string. */
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * Split a file buffer into CHUNK_SIZE slices and compute the whole-file
 * SHA-256 in a single sequential pass.
 *
 * Running the hash over chunks in order produces the same digest as hashing
 * the original buffer, so the whole-file check at the receiver does not need
 * to re-read anything — the sender simply includes the digest from this call
 * in the offer.
 *
 * An empty file is valid: it yields one zero-length chunk and a defined hash.
 */
function splitFile(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer)) {
    throw new Error('splitFile: fileBuffer must be a Buffer.');
  }
  const hash = crypto.createHash('sha256');
  const chunks = [];
  let offset = 0;
  while (offset < fileBuffer.length) {
    const slice = fileBuffer.slice(offset, Math.min(offset + CHUNK_SIZE, fileBuffer.length));
    hash.update(slice);
    chunks.push(slice);
    offset += CHUNK_SIZE;
  }
  if (chunks.length === 0) {
    // Empty file: emit one empty chunk so `totalChunks` is never zero.
    hash.update(Buffer.alloc(0));
    chunks.push(Buffer.alloc(0));
  }
  return { chunks, sha256: hash.digest('hex') };
}

/** Throw when a transition is attempted from the wrong state. */
function refuseTransition(session, action) {
  throw new Error(
    `Cannot "${action}" when session is in state "${session.state}" (role: ${session.role}).`
  );
}

/** Guard: throw if the session is not in one of the allowed states. */
function requireState(session, action, ...allowed) {
  if (!allowed.includes(session.state)) refuseTransition(session, action);
}

/**
 * Create a new sender session.
 *
 * The file buffer is split and hashed here so chunk building later is O(1)
 * per chunk and the whole module remains free of I/O.
 */
function createSenderSession({ transferId, fromUin, toUin, filename, fileBuffer }) {
  if (!transferId || !fromUin || !toUin || !filename) {
    throw new Error('createSenderSession: transferId, fromUin, toUin and filename are required.');
  }
  if (!Buffer.isBuffer(fileBuffer)) {
    throw new Error('createSenderSession: fileBuffer must be a Buffer.');
  }
  const { chunks, sha256 } = splitFile(fileBuffer);
  return Object.freeze({
    role:        'sender',
    state:       STATES.IDLE,
    transferId:  String(transferId),
    fromUin:     String(fromUin),
    toUin:       String(toUin),
    filename:    String(filename),
    totalBytes:  fileBuffer.length,
    totalChunks: chunks.length,
    sha256,
    chunks,        // Buffer[] — pre-sliced, never mutated
    nextChunk:   0,
    bytesDone:   0,
    chunksDone:  0,
    startedAt:   null,
    reason:      null,
  });
}

/**
 * Create a new receiver session from a received offer signal.
 *
 * The session starts in `awaiting-decision` because the Owner must explicitly
 * accept or reject before any data channel activity begins.
 */
function createReceiverSession(signal) {
  if (!signal || signal.type !== 'p2p-offer') {
    throw new Error('createReceiverSession: expected a p2p-offer signal.');
  }
  const { transferId, fromUin, toUin, filename, size, totalChunks, sha256 } = signal;
  if (!transferId || !fromUin || !toUin || !filename ||
      typeof size !== 'number' || typeof totalChunks !== 'number' || !sha256) {
    throw new Error('createReceiverSession: offer is missing required fields.');
  }
  return Object.freeze({
    role:           'receiver',
    state:          STATES.AWAITING_DECISION,
    transferId:     String(transferId),
    fromUin:        String(fromUin),
    toUin:          String(toUin),
    filename:       String(filename),
    totalBytes:     size,
    totalChunks,
    sha256,
    receivedChunks: {},   // seq → Buffer, accumulated as chunks arrive
    bytesDone:      0,
    chunksDone:     0,
    startedAt:      null,
    reason:         null,
    fileBuffer:     null, // set when transfer completes successfully
  });
}

/**
 * Sender: move from `idle` to `offering` and return the offer signal.
 *
 * The signal is sent via XMPP to the receiver before the data channel opens.
 */
function makeOffer(session) {
  requireState(session, 'make offer', STATES.IDLE);
  const signal = {
    type:        'p2p-offer',
    transferId:  session.transferId,
    fromUin:     session.fromUin,
    toUin:       session.toUin,
    filename:    session.filename,
    size:        session.totalBytes,
    totalChunks: session.totalChunks,
    sha256:      session.sha256,
  };
  return {
    session: Object.freeze({ ...session, state: STATES.OFFERING }),
    signal,
  };
}

/**
 * Sender: the receiver accepted — move to `transferring`.
 *
 * `nowMs` is the caller's current timestamp; it becomes `startedAt` so that
 * `progress()` can compute a transfer rate without reading the clock itself.
 */
function onOfferAccepted(session, nowMs) {
  requireState(session, 'mark offer accepted', STATES.OFFERING);
  return {
    session: Object.freeze({ ...session, state: STATES.TRANSFERRING, startedAt: nowMs }),
  };
}

/**
 * Sender: the receiver rejected the offer.
 */
function onOfferRejected(session, signal) {
  requireState(session, 'mark offer rejected', STATES.OFFERING);
  return {
    session: Object.freeze({
      ...session,
      state:  STATES.REJECTED,
      reason: signal && signal.reason ? String(signal.reason) : 'Rejected.',
    }),
  };
}

/**
 * Receiver: accept the offer and return the accept signal to send via XMPP.
 *
 * `nowMs` is the caller's current timestamp.
 */
function acceptOffer(session, nowMs) {
  requireState(session, 'accept offer', STATES.AWAITING_DECISION);
  const signal = { type: 'p2p-accept', transferId: session.transferId };
  return {
    session: Object.freeze({ ...session, state: STATES.TRANSFERRING, startedAt: nowMs }),
    signal,
  };
}

/**
 * Receiver: decline the offer and return the reject signal to send via XMPP.
 */
function rejectOffer(session, reason) {
  requireState(session, 'reject offer', STATES.AWAITING_DECISION);
  const msg = reason ? String(reason) : 'Declined.';
  const signal = { type: 'p2p-reject', transferId: session.transferId, reason: msg };
  return {
    session: Object.freeze({ ...session, state: STATES.REJECTED, reason: msg }),
    signal,
  };
}

/**
 * Sender: build the next chunk packet for the data channel.
 *
 * Returns the packet and a new session with the chunk cursor advanced and
 * `bytesDone` updated. The caller is responsible for calling `canSendNext()`
 * before each call and `onAllChunksSent()` after the cursor reaches the end.
 */
function buildChunk(session) {
  requireState(session, 'build chunk', STATES.TRANSFERRING);
  if (session.role !== 'sender') {
    throw new Error('buildChunk can only be called on a sender session.');
  }
  if (session.nextChunk >= session.totalChunks) {
    throw new Error(
      `buildChunk: all ${session.totalChunks} chunks have already been built.`
    );
  }
  const seq = session.nextChunk;
  const data = session.chunks[seq];
  const packet = {
    type:       'chunk',
    transferId: session.transferId,
    seq,
    total:      session.totalChunks,
    chunkHash:  sha256hex(data),
    data,
  };
  return {
    session: Object.freeze({
      ...session,
      nextChunk:  seq + 1,
      bytesDone:  session.bytesDone + data.length,
      chunksDone: session.chunksDone + 1,
    }),
    packet,
  };
}

/**
 * Sender: produce the "transfer done" packet after all chunks have been sent.
 *
 * This is sent over the data channel (not XMPP) so it arrives after the last
 * chunk in channel order. The receiver compares its `sha256` against the hash
 * of whatever it reassembled.
 */
function onAllChunksSent(session) {
  requireState(session, 'mark all chunks sent', STATES.TRANSFERRING);
  if (session.role !== 'sender') {
    throw new Error('onAllChunksSent can only be called on a sender session.');
  }
  if (session.nextChunk < session.totalChunks) {
    throw new Error(
      `onAllChunksSent: ${session.totalChunks - session.nextChunk} chunks have not been sent yet.`
    );
  }
  const packet = { type: 'transfer-done', transferId: session.transferId, sha256: session.sha256 };
  return {
    session: Object.freeze({ ...session, state: STATES.DONE }),
    packet,
  };
}

/**
 * Receiver: process an incoming chunk packet from the data channel.
 *
 * Each chunk is verified against its `chunkHash` before being stored. Only
 * once every sequence number is accounted for does reassembly run, so a
 * missing or corrupt chunk is caught before any bytes are written to disk.
 *
 * Returned `event` values:
 *   'progress'      — chunk accepted, transfer still in flight
 *   'duplicate'     — seq already received; session is unchanged
 *   'corrupt'       — hash mismatch or protocol error; state moves to 'error'
 *   'hash-mismatch' — all chunks reassembled but whole-file hash failed; 'error'
 *   'complete'      — all chunks verified; `session.fileBuffer` holds the file
 */
function receiveChunk(session, packet) {
  requireState(session, 'receive chunk', STATES.TRANSFERRING);
  if (session.role !== 'receiver') {
    throw new Error('receiveChunk can only be called on a receiver session.');
  }

  const { seq, total, chunkHash, data } = packet;

  // `data` arrives from a network peer and may be absent or the wrong type.
  // Buffer.from() throws on null, undefined, and numbers, so coerce defensively
  // rather than letting an unguarded throw escape the state machine.
  let buf;
  try {
    buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  } catch (_) {
    return {
      session: Object.freeze({
        ...session, state: STATES.ERROR,
        reason: 'Chunk data field is not a valid buffer.',
      }),
      event: 'corrupt',
    };
  }

  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq >= session.totalChunks) {
    return {
      session: Object.freeze({
        ...session, state: STATES.ERROR,
        reason: `Chunk seq ${seq} is out of range [0, ${session.totalChunks - 1}].`,
      }),
      event: 'corrupt',
    };
  }
  if (total !== session.totalChunks) {
    return {
      session: Object.freeze({
        ...session, state: STATES.ERROR,
        reason: `Chunk claims total ${total} but session expects ${session.totalChunks}.`,
      }),
      event: 'corrupt',
    };
  }

  // A duplicate arrives when the sender retransmits — accept it silently rather
  // than corrupting bytesDone or chunksDone.
  if (session.receivedChunks[seq] !== undefined) {
    return { session, event: 'duplicate' };
  }

  // Per-chunk integrity check: catches a corrupted message before it pollutes
  // the map. Corruption discovered here is unrecoverable without a retransmit.
  const actualHash = sha256hex(buf);
  if (actualHash !== chunkHash) {
    return {
      session: Object.freeze({
        ...session, state: STATES.ERROR,
        reason: `Chunk ${seq} integrity check failed (expected ${chunkHash}, got ${actualHash}).`,
      }),
      event: 'corrupt',
    };
  }

  const newReceived   = { ...session.receivedChunks, [seq]: buf };
  const newBytesDone  = session.bytesDone + buf.length;
  const newChunksDone = session.chunksDone + 1;

  if (newChunksDone < session.totalChunks) {
    return {
      session: Object.freeze({
        ...session,
        receivedChunks: newReceived,
        bytesDone:      newBytesDone,
        chunksDone:     newChunksDone,
      }),
      event: 'progress',
    };
  }

  // All chunks present — reassemble in sequence order.
  const parts = [];
  for (let i = 0; i < session.totalChunks; i++) {
    const chunk = newReceived[i];
    if (chunk === undefined) {
      // chunksDone reached totalChunks yet a slot is empty: the counter and
      // the map are inconsistent, which should never happen in normal operation
      // but must be caught rather than producing a silently truncated file.
      return {
        session: Object.freeze({
          ...session,
          receivedChunks: newReceived,
          bytesDone:      newBytesDone,
          chunksDone:     newChunksDone,
          state:          STATES.ERROR,
          reason:         `Reassembly failed: chunk ${i} is missing from the map.`,
        }),
        event: 'corrupt',
      };
    }
    parts.push(chunk);
  }

  const fileBuffer = Buffer.concat(parts);
  const fileHash   = sha256hex(fileBuffer);

  if (fileHash !== session.sha256) {
    return {
      session: Object.freeze({
        ...session,
        receivedChunks: newReceived,
        bytesDone:      newBytesDone,
        chunksDone:     newChunksDone,
        state:          STATES.ERROR,
        reason:         `Whole-file hash mismatch (expected ${session.sha256}, got ${fileHash}).`,
      }),
      event: 'hash-mismatch',
    };
  }

  return {
    session: Object.freeze({
      ...session,
      receivedChunks: newReceived,
      bytesDone:      newBytesDone,
      chunksDone:     newChunksDone,
      state:          STATES.DONE,
      fileBuffer,
    }),
    event: 'complete',
  };
}

/**
 * Either party: cancel the transfer.
 *
 * Returns the cancel signal to send via XMPP and a new session in the
 * `cancelled` state. The `reason` and `bytesDone` on the cancelled session
 * give the interface everything it needs to render a useful status message.
 *
 * Calling cancel from a terminal state is refused: a completed or already-
 * cancelled transfer should not silently reset to `cancelled`.
 */
function cancel(session, reason) {
  if (TERMINAL_STATES.has(session.state)) {
    refuseTransition(session, 'cancel');
  }
  const msg    = reason ? String(reason) : 'Cancelled.';
  const signal = { type: 'p2p-cancel', transferId: session.transferId, reason: msg };
  return {
    session: Object.freeze({ ...session, state: STATES.CANCELLED, reason: msg }),
    signal,
  };
}

/**
 * Either party: the other side has cancelled.
 *
 * A cancel signal can arrive late — after the session has already reached a
 * terminal state — because XMPP delivery is not synchronised with the data
 * channel. In that case the session is returned unchanged rather than
 * overwriting a successfully completed transfer with `cancelled`.
 */
function onCancel(session, signal) {
  if (TERMINAL_STATES.has(session.state)) {
    return { session };
  }
  const reason = signal && signal.reason ? String(signal.reason) : 'Cancelled by peer.';
  return {
    session: Object.freeze({ ...session, state: STATES.CANCELLED, reason }),
  };
}

/**
 * Can the sender push the next chunk right now?
 *
 * The data channel's `bufferedAmount` property is the number of bytes queued
 * but not yet handed to the network. Sending without checking it is the most
 * common cause of broken large transfers: the queue outpaces the network,
 * exhausting memory or causing the implementation to drop the connection.
 *
 * The caller should call this before every `buildChunk()` and wait for the
 * channel's `bufferedamountlow` event when it returns `false`. Passing `state`
 * lets the loop stop cleanly if the session moved to a terminal state while
 * waiting for a drain.
 */
function canSendNext(bufferedAmount, drainThreshold, state) {
  if (state !== STATES.TRANSFERRING) return false;
  return bufferedAmount <= drainThreshold;
}

/**
 * Compute progress for display.
 *
 * `nowMs` is the caller's current timestamp — `Date.now()` in production, a
 * fixed value in tests. Rate is bytes per second; `eta` is the estimated
 * milliseconds remaining. Both are `null` until there is enough data to
 * compute them meaningfully.
 */
function progress(session, nowMs) {
  const elapsed = (session.startedAt !== null && nowMs > session.startedAt)
    ? nowMs - session.startedAt
    : 0;

  const rate = (elapsed > 0 && session.bytesDone > 0)
    ? (session.bytesDone / elapsed) * 1000   // bytes per second
    : null;

  const remaining = session.totalBytes - session.bytesDone;
  const eta = (rate !== null && rate > 0)
    ? (remaining / rate) * 1000              // milliseconds
    : null;

  return {
    bytesDone:   session.bytesDone,
    totalBytes:  session.totalBytes,
    chunksDone:  session.chunksDone,
    totalChunks: session.totalChunks,
    rate,     // bytes per second, or null
    elapsed,  // milliseconds since startedAt
    eta,      // estimated ms remaining, or null
  };
}

module.exports = {
  CHUNK_SIZE,
  DEFAULT_DRAIN_THRESHOLD,
  STATES,
  splitFile,
  createSenderSession,
  createReceiverSession,
  makeOffer,
  onOfferAccepted,
  onOfferRejected,
  acceptOffer,
  rejectOffer,
  buildChunk,
  onAllChunksSent,
  receiveChunk,
  cancel,
  onCancel,
  canSendNext,
  progress,
};
