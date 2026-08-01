/**
 * The state machine has no I/O of its own, so tests can exercise every
 * transition, every error path and every piece of arithmetic by constructing
 * plain objects and calling functions — no WebRTC, no XMPP, no timers.
 *
 * The most important tests here are the refusals. Each function must throw or
 * return a 'corrupt' event from any state it was not designed to run in, so
 * that a misbehaving peer or a caller that loses track of session state does
 * not silently corrupt a transfer or produce a half-assembled file. Equally,
 * the integrity paths — per-chunk SHA-256 and the whole-file hash — must
 * catch a single flipped bit before any bytes reach the caller.
 */

'use strict';

const crypto = require('crypto');
const {
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
} = require('./icq-p2p');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Make a deterministic Buffer of `size` bytes. */
function makeFileBuffer(size) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = i & 0xff;
  return buf;
}

/** Minimum valid sender session, ready to offer. */
function makeSenderSession(sizeBytes = CHUNK_SIZE * 3 + 500) {
  return createSenderSession({
    transferId: 'xfer-1',
    fromUin: '123456',
    toUin: '654321',
    filename: 'photo.jpg',
    fileBuffer: makeFileBuffer(sizeBytes),
  });
}

/** Derive a receiver session from a sender session's offer signal. */
function makeReceiverSession(senderSession) {
  const { signal } = makeOffer(senderSession);
  return createReceiverSession(signal);
}

/**
 * Send every chunk from `senderSession` and receive it in `receiverSession`,
 * returning the final receiver session.
 */
function pumpAllChunks(senderSession, receiverSession) {
  let s = senderSession;
  let r = receiverSession;
  while (s.nextChunk < s.totalChunks) {
    const built = buildChunk(s);
    s = built.session;
    const received = receiveChunk(r, built.packet);
    r = received.session;
  }
  return { senderSession: s, receiverSession: r };
}

// ── splitFile ─────────────────────────────────────────────────────────────────

describe('splitFile', () => {
  it('refuses anything that is not a Buffer', () => {
    expect(() => splitFile('hello')).toThrow('Buffer');
    expect(() => splitFile(null)).toThrow('Buffer');
    expect(() => splitFile(new Uint8Array(4))).toThrow('Buffer');
  });

  it('produces one empty chunk for an empty file', () => {
    const { chunks, sha256 } = splitFile(Buffer.alloc(0));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(0);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces one chunk for a file of exactly CHUNK_SIZE bytes', () => {
    const { chunks } = splitFile(makeFileBuffer(CHUNK_SIZE));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
  });

  it('produces the correct number of chunks for a file that is not a whole number of chunks', () => {
    // 3 full chunks + one partial chunk of 500 bytes.
    const { chunks } = splitFile(makeFileBuffer(CHUNK_SIZE * 3 + 500));
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
    expect(chunks[3]).toHaveLength(500);
  });

  it('makes a last chunk shorter than CHUNK_SIZE when the file does not divide evenly', () => {
    const { chunks } = splitFile(makeFileBuffer(CHUNK_SIZE + 1));
    expect(chunks[0]).toHaveLength(CHUNK_SIZE);
    expect(chunks[1]).toHaveLength(1);
  });

  it('computes the same SHA-256 as hashing the whole buffer at once', () => {
    const file = makeFileBuffer(CHUNK_SIZE * 2 + 77);
    const { sha256 } = splitFile(file);
    expect(sha256).toBe(crypto.createHash('sha256').update(file).digest('hex'));
  });
});

// ── createSenderSession ───────────────────────────────────────────────────────

describe('createSenderSession', () => {
  it('starts in the idle state', () => {
    expect(makeSenderSession().state).toBe(STATES.IDLE);
  });

  it('records the correct total byte count and chunk count', () => {
    const size = CHUNK_SIZE * 2 + 100;
    const s = makeSenderSession(size);
    expect(s.totalBytes).toBe(size);
    expect(s.totalChunks).toBe(3);
  });

  it('refuses to create a session without a filename', () => {
    expect(() => createSenderSession({
      transferId: 'x', fromUin: '1', toUin: '2', filename: '',
      fileBuffer: Buffer.alloc(1),
    })).toThrow();
  });

  it('refuses a non-Buffer fileBuffer', () => {
    expect(() => createSenderSession({
      transferId: 'x', fromUin: '1', toUin: '2', filename: 'f',
      fileBuffer: 'not a buffer',
    })).toThrow('Buffer');
  });
});

// ── createReceiverSession ─────────────────────────────────────────────────────

describe('createReceiverSession', () => {
  it('starts in the awaiting-decision state', () => {
    const s = makeSenderSession();
    expect(makeReceiverSession(s).state).toBe(STATES.AWAITING_DECISION);
  });

  it('refuses a signal that is not a p2p-offer', () => {
    expect(() => createReceiverSession({ type: 'p2p-accept', transferId: 'x' })).toThrow();
    expect(() => createReceiverSession(null)).toThrow();
  });

  it('refuses an offer with a missing required field', () => {
    expect(() => createReceiverSession({
      type: 'p2p-offer', transferId: 'x', fromUin: '1', toUin: '2',
      filename: 'f.jpg', totalChunks: 1,
      // missing: size, sha256
    })).toThrow();
  });
});

// ── State machine — offer and response ───────────────────────────────────────

describe('makeOffer', () => {
  it('moves the sender from idle to offering', () => {
    const s = makeSenderSession();
    const { session } = makeOffer(s);
    expect(session.state).toBe(STATES.OFFERING);
  });

  it('refuses to make an offer from offering state', () => {
    const s = makeSenderSession();
    const { session } = makeOffer(s);
    expect(() => makeOffer(session)).toThrow('"make offer"');
  });

  it('refuses to make an offer when transferring', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session: transferring } = onOfferAccepted(offering, 1000);
    expect(() => makeOffer(transferring)).toThrow('"make offer"');
  });

  it('returns a signal with the correct shape', () => {
    const s = makeSenderSession();
    const { signal } = makeOffer(s);
    expect(signal.type).toBe('p2p-offer');
    expect(signal.transferId).toBe('xfer-1');
    expect(signal.fromUin).toBe('123456');
    expect(signal.toUin).toBe('654321');
    expect(typeof signal.totalChunks).toBe('number');
    expect(signal.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('onOfferAccepted', () => {
  it('moves the sender from offering to transferring', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session } = onOfferAccepted(offering, 1000);
    expect(session.state).toBe(STATES.TRANSFERRING);
  });

  it('records startedAt from the injected timestamp', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session } = onOfferAccepted(offering, 42000);
    expect(session.startedAt).toBe(42000);
  });

  it('refuses to accept from idle state', () => {
    const s = makeSenderSession();
    expect(() => onOfferAccepted(s, 1000)).toThrow('"mark offer accepted"');
  });

  it('refuses to accept when already transferring', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session: transferring } = onOfferAccepted(offering, 1000);
    expect(() => onOfferAccepted(transferring, 2000)).toThrow('"mark offer accepted"');
  });
});

describe('onOfferRejected', () => {
  it('moves the sender to rejected', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session } = onOfferRejected(offering, { reason: 'No thanks.' });
    expect(session.state).toBe(STATES.REJECTED);
    expect(session.reason).toBe('No thanks.');
  });

  it('refuses to reject from idle state', () => {
    const s = makeSenderSession();
    expect(() => onOfferRejected(s, {})).toThrow('"mark offer rejected"');
  });
});

describe('acceptOffer', () => {
  it('moves the receiver from awaiting-decision to transferring', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { session } = acceptOffer(r, 2000);
    expect(session.state).toBe(STATES.TRANSFERRING);
    expect(session.startedAt).toBe(2000);
  });

  it('returns an accept signal with the correct transferId', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { signal } = acceptOffer(r, 0);
    expect(signal.type).toBe('p2p-accept');
    expect(signal.transferId).toBe('xfer-1');
  });

  it('refuses to accept when already transferring', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { session: transferring } = acceptOffer(r, 0);
    expect(() => acceptOffer(transferring, 1000)).toThrow('"accept offer"');
  });

  it('refuses to accept from a rejected state', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { session: rejected } = rejectOffer(r, 'nope');
    expect(() => acceptOffer(rejected, 0)).toThrow('"accept offer"');
  });
});

describe('rejectOffer', () => {
  it('moves the receiver to rejected and returns a reject signal', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { session, signal } = rejectOffer(r, 'File too large.');
    expect(session.state).toBe(STATES.REJECTED);
    expect(signal.type).toBe('p2p-reject');
    expect(signal.reason).toBe('File too large.');
  });

  it('uses a default reason when none is given', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { signal } = rejectOffer(r);
    expect(signal.reason).toBeTruthy();
  });

  it('refuses to reject when transferring', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { session: transferring } = acceptOffer(r, 0);
    expect(() => rejectOffer(transferring)).toThrow('"reject offer"');
  });
});

// ── buildChunk and onAllChunksSent ────────────────────────────────────────────

describe('buildChunk', () => {
  it('refuses to build before the offer is accepted', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    expect(() => buildChunk(offering)).toThrow('"build chunk"');
  });

  it('refuses to build on a receiver session', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session: transferring } = onOfferAccepted(offering, 0);
    const r = makeReceiverSession(s);
    const { session: rTransferring } = acceptOffer(r, 0);
    expect(() => buildChunk(rTransferring)).toThrow('sender session');
  });

  it('advances the chunk cursor on each call', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session: t0 } = onOfferAccepted(offering, 0);
    const { session: t1 } = buildChunk(t0);
    const { session: t2 } = buildChunk(t1);
    expect(t0.nextChunk).toBe(0);
    expect(t1.nextChunk).toBe(1);
    expect(t2.nextChunk).toBe(2);
  });

  it('accumulates bytesDone correctly', () => {
    const fileSize = CHUNK_SIZE + 77;
    const s = createSenderSession({
      transferId: 'x', fromUin: '1', toUin: '2', filename: 'f',
      fileBuffer: makeFileBuffer(fileSize),
    });
    const { session: offering } = makeOffer(s);
    const { session: t0 } = onOfferAccepted(offering, 0);
    const { session: t1 } = buildChunk(t0);  // first full chunk
    const { session: t2 } = buildChunk(t1);  // partial chunk
    expect(t1.bytesDone).toBe(CHUNK_SIZE);
    expect(t2.bytesDone).toBe(fileSize);
  });

  it('refuses to build past the last chunk', () => {
    const s = createSenderSession({
      transferId: 'x', fromUin: '1', toUin: '2', filename: 'f',
      fileBuffer: makeFileBuffer(1),
    });
    const { session: offering } = makeOffer(s);
    const { session: t } = onOfferAccepted(offering, 0);
    const { session: t1 } = buildChunk(t);
    expect(() => buildChunk(t1)).toThrow('already been built');
  });

  it('produces a chunk with a valid SHA-256 chunkHash', () => {
    const s = makeSenderSession(CHUNK_SIZE + 1);
    const { session: offering } = makeOffer(s);
    const { session: t } = onOfferAccepted(offering, 0);
    const { packet } = buildChunk(t);
    const expected = crypto.createHash('sha256').update(packet.data).digest('hex');
    expect(packet.chunkHash).toBe(expected);
  });

  it('does not mutate the previous session', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session: t0 } = onOfferAccepted(offering, 0);
    const beforeNext = t0.nextChunk;
    buildChunk(t0);
    expect(t0.nextChunk).toBe(beforeNext);
  });
});

describe('onAllChunksSent', () => {
  it('moves the sender to done after the last chunk', () => {
    const s = makeSenderSession(1);
    const { session: offering } = makeOffer(s);
    const { session: t0 } = onOfferAccepted(offering, 0);
    const { session: t1 } = buildChunk(t0);
    const { session: done, packet } = onAllChunksSent(t1);
    expect(done.state).toBe(STATES.DONE);
    expect(packet.type).toBe('transfer-done');
    expect(packet.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to mark done when chunks remain', () => {
    const s = makeSenderSession(CHUNK_SIZE * 2);
    const { session: offering } = makeOffer(s);
    const { session: t0 } = onOfferAccepted(offering, 0);
    const { session: t1 } = buildChunk(t0); // only one of two chunks sent
    expect(() => onAllChunksSent(t1)).toThrow('have not been sent yet');
  });

  it('refuses to mark done on a receiver session', () => {
    const s = makeSenderSession(1);
    const { session: offering, signal } = makeOffer(s);
    const { session: t } = onOfferAccepted(offering, 0);
    const { session: tAllSent } = buildChunk(t);
    const r = createReceiverSession(signal);
    const { session: rT } = acceptOffer(r, 0);
    expect(() => onAllChunksSent(rT)).toThrow('sender session');
  });
});

// ── receiveChunk ─────────────────────────────────────────────────────────────

describe('receiveChunk — happy path', () => {
  it('returns progress event while chunks are still outstanding', () => {
    const s = makeSenderSession(CHUNK_SIZE * 2);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const { session: rT } = acceptOffer(r, 0);

    const { session: s1, packet: p0 } = buildChunk(sT);
    const { session: r1, event } = receiveChunk(rT, p0);
    expect(event).toBe('progress');
    expect(r1.chunksDone).toBe(1);
    expect(r1.bytesDone).toBe(CHUNK_SIZE);
  });

  it('returns complete event when the last chunk arrives in order', () => {
    const file = makeFileBuffer(CHUNK_SIZE * 2 + 300);
    const s = createSenderSession({
      transferId: 'y', fromUin: '1', toUin: '2', filename: 'doc.pdf',
      fileBuffer: file,
    });
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const { session: rT } = acceptOffer(r, 0);

    const { receiverSession: rFinal } = pumpAllChunks(sT, rT);
    expect(rFinal.state).toBe(STATES.DONE);
    expect(rFinal.fileBuffer.equals(file)).toBe(true);
  });

  it('reassembles correctly when chunks arrive in reverse order', () => {
    const file = makeFileBuffer(CHUNK_SIZE * 3 + 500);
    const s = createSenderSession({
      transferId: 'z', fromUin: '1', toUin: '2', filename: 'video.mp4',
      fileBuffer: file,
    });
    const { session: sOffer, signal } = makeOffer(s);
    let sT = onOfferAccepted(sOffer, 0).session;

    // Build all packets first.
    const packets = [];
    while (sT.nextChunk < sT.totalChunks) {
      const built = buildChunk(sT);
      packets.push(built.packet);
      sT = built.session;
    }

    const r = createReceiverSession(signal);
    let rT = acceptOffer(r, 0).session;

    // Deliver in reverse order.
    let finalEvent;
    for (const packet of [...packets].reverse()) {
      const result = receiveChunk(rT, packet);
      rT = result.session;
      finalEvent = result.event;
    }

    expect(finalEvent).toBe('complete');
    expect(rT.state).toBe(STATES.DONE);
    expect(rT.fileBuffer.equals(file)).toBe(true);
  });

  it('accumulates bytesDone only for accepted chunks', () => {
    const s = makeSenderSession(CHUNK_SIZE + 1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    let rT = acceptOffer(r, 0).session;

    const { session: s1, packet: p0 } = buildChunk(sT);
    const { session: r1 } = receiveChunk(rT, p0);
    expect(r1.bytesDone).toBe(CHUNK_SIZE);
  });

  it('does not mutate the previous receiver session', () => {
    const s = makeSenderSession(CHUNK_SIZE * 2);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const rT = acceptOffer(r, 0).session;

    const { session: s1, packet: p0 } = buildChunk(sT);
    const prevDone = rT.chunksDone;
    receiveChunk(rT, p0);
    expect(rT.chunksDone).toBe(prevDone);
  });
});

describe('receiveChunk — corruption', () => {
  it('catches a chunk whose data does not match its chunkHash', () => {
    const s = makeSenderSession(CHUNK_SIZE + 1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const rT = acceptOffer(r, 0).session;

    const { packet } = buildChunk(sT);
    // Flip one byte in the data to corrupt it without touching chunkHash.
    const corrupted = { ...packet, data: Buffer.from(packet.data) };
    corrupted.data[0] ^= 0xff;

    const { session, event } = receiveChunk(rT, corrupted);
    expect(event).toBe('corrupt');
    expect(session.state).toBe(STATES.ERROR);
    expect(session.reason).toMatch(/integrity check failed/i);
  });

  it('catches a whole-file hash mismatch when the offer carried a wrong hash', () => {
    // Build sender and receiver sessions, but give the receiver a bogus expected
    // hash — every chunk is individually valid but the whole-file check fails.
    const s = makeSenderSession(CHUNK_SIZE + 1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);

    const badSignal = { ...signal, sha256: 'a'.repeat(64) };
    const r = createReceiverSession(badSignal);
    let rT = acceptOffer(r, 0).session;

    let lastResult;
    let curST = sT;
    while (curST.nextChunk < curST.totalChunks) {
      const built = buildChunk(curST);
      curST = built.session;
      lastResult = receiveChunk(rT, built.packet);
      rT = lastResult.session;
    }

    expect(lastResult.event).toBe('hash-mismatch');
    expect(rT.state).toBe(STATES.ERROR);
    expect(rT.reason).toMatch(/hash mismatch/i);
  });

  it('catches a chunk with an out-of-range seq', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const rT = acceptOffer(r, 0).session;

    const { packet } = buildChunk(sT);
    const bad = { ...packet, seq: 999 };
    const { event, session } = receiveChunk(rT, bad);
    expect(event).toBe('corrupt');
    expect(session.state).toBe(STATES.ERROR);
    expect(session.reason).toMatch(/out of range/i);
  });

  it('catches a chunk with a negative seq without throwing', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const rT = acceptOffer(r, 0).session;

    const { packet } = buildChunk(sT);
    const bad = { ...packet, seq: -1 };
    const { event, session } = receiveChunk(rT, bad);
    expect(event).toBe('corrupt');
    expect(session.state).toBe(STATES.ERROR);
  });

  it('returns a corrupt event rather than throwing when data is null', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const rT = acceptOffer(r, 0).session;

    const { packet } = buildChunk(sT);
    // A malicious or malformed peer sends a chunk packet with no data field.
    // Buffer.from(null) throws, so this must be caught inside receiveChunk and
    // returned as a 'corrupt' event rather than propagating as an unhandled error.
    const bad = { ...packet, data: null };
    const { event, session } = receiveChunk(rT, bad);
    expect(event).toBe('corrupt');
    expect(session.state).toBe(STATES.ERROR);
  });

  it('returns a corrupt event rather than throwing when data is undefined', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const rT = acceptOffer(r, 0).session;

    const { packet } = buildChunk(sT);
    const bad = { ...packet, data: undefined };
    const { event, session } = receiveChunk(rT, bad);
    expect(event).toBe('corrupt');
    expect(session.state).toBe(STATES.ERROR);
  });

  it('catches a chunk claiming a different total', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const rT = acceptOffer(r, 0).session;

    const { packet } = buildChunk(sT);
    const bad = { ...packet, total: 999 };
    const { event, session } = receiveChunk(rT, bad);
    expect(event).toBe('corrupt');
    expect(session.state).toBe(STATES.ERROR);
    expect(session.reason).toMatch(/total/i);
  });

  it('refuses to receive a chunk on a sender session', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { packet } = buildChunk(sT);

    expect(() => receiveChunk(sT, packet)).toThrow('receiver session');
  });

  it('refuses to receive a chunk when not transferring', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const r = createReceiverSession(signal);
    const { packet } = buildChunk(onOfferAccepted(sOffer, 0).session);

    expect(() => receiveChunk(r, packet)).toThrow('"receive chunk"');
  });
});

describe('receiveChunk — duplicates and ordering', () => {
  it('silently ignores a duplicate chunk without double-counting bytes', () => {
    const s = makeSenderSession(CHUNK_SIZE * 2);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    let rT = acceptOffer(r, 0).session;

    const { session: s1, packet: p0 } = buildChunk(sT);
    const { session: r1 } = receiveChunk(rT, p0);
    const { event, session: r2 } = receiveChunk(r1, p0); // duplicate

    expect(event).toBe('duplicate');
    expect(r2.chunksDone).toBe(1);                // not 2
    expect(r2.bytesDone).toBe(CHUNK_SIZE);         // not 2 × CHUNK_SIZE
    expect(Object.keys(r2.receivedChunks)).toHaveLength(1);
  });

  it('handles a file that is not a whole number of chunks end to end', () => {
    // 2 full chunks + a partial chunk of 1 byte — the reassembly must not
    // pad the last chunk or truncate the file.
    const file = makeFileBuffer(CHUNK_SIZE * 2 + 1);
    const s = createSenderSession({
      transferId: 'a', fromUin: '1', toUin: '2', filename: 'f', fileBuffer: file,
    });
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const r = createReceiverSession(signal);
    const { session: rT } = acceptOffer(r, 0);

    const { receiverSession: rFinal } = pumpAllChunks(sT, rT);
    expect(rFinal.state).toBe(STATES.DONE);
    expect(rFinal.fileBuffer.length).toBe(file.length);
    expect(rFinal.fileBuffer.equals(file)).toBe(true);
  });
});

// ── cancel and onCancel ───────────────────────────────────────────────────────

describe('cancel', () => {
  it('cancels from transferring with a reason and produces a cancel signal', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session, signal } = cancel(sT, 'User closed window.');

    expect(session.state).toBe(STATES.CANCELLED);
    expect(session.reason).toBe('User closed window.');
    expect(signal.type).toBe('p2p-cancel');
    expect(signal.transferId).toBe('xfer-1');
  });

  it('cancels from awaiting-decision', () => {
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { session } = cancel(r, 'Changed mind.');
    expect(session.state).toBe(STATES.CANCELLED);
  });

  it('cancels from offering state', () => {
    const s = makeSenderSession();
    const { session: offering } = makeOffer(s);
    const { session } = cancel(offering, 'Taking it back.');
    expect(session.state).toBe(STATES.CANCELLED);
  });

  it('uses a default reason when none is given', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { signal } = cancel(sT);
    expect(signal.reason).toBeTruthy();
  });

  it('preserves bytesDone on the cancelled session so the interface can show progress', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session: s1 } = buildChunk(sT);
    const { session: cancelled } = cancel(s1, 'Aborted.');
    expect(cancelled.bytesDone).toBe(CHUNK_SIZE);
  });

  it('refuses to cancel from a done state', () => {
    const s = makeSenderSession(1);
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session: s1 } = buildChunk(sT);
    const { session: done } = onAllChunksSent(s1);
    expect(() => cancel(done)).toThrow('"cancel"');
  });

  it('refuses to cancel from an already-cancelled state', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session: cancelled } = cancel(sT, 'first');
    expect(() => cancel(cancelled)).toThrow('"cancel"');
  });

  it('refuses to cancel from an error state', () => {
    const s = makeSenderSession(1);
    const { session: sOffer, signal } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { packet } = buildChunk(sT);
    const r = createReceiverSession(signal);
    let rT = acceptOffer(r, 0).session;
    const corrupted = { ...packet, chunkHash: 'a'.repeat(64) };
    const { session: errored } = receiveChunk(rT, corrupted);
    expect(() => cancel(errored)).toThrow('"cancel"');
  });

  it('refuses to cancel from a rejected state', () => {
    // REJECTED is a terminal state; cancel must refuse every terminal state,
    // not just DONE, CANCELLED and ERROR.
    const s = makeSenderSession();
    const r = makeReceiverSession(s);
    const { session: rejected } = rejectOffer(r, 'No.');
    expect(rejected.state).toBe(STATES.REJECTED);
    expect(() => cancel(rejected)).toThrow('"cancel"');
  });

  it('cancels from idle state — no offer has been sent yet', () => {
    // An IDLE session has not yet called makeOffer, so the peer has never seen
    // this transfer. The cancel signal should not be sent, but the state machine
    // itself moves to CANCELLED so the interface can update correctly.
    const s = makeSenderSession();
    expect(s.state).toBe(STATES.IDLE);
    const { session, signal } = cancel(s, 'Changed mind before sending.');
    expect(session.state).toBe(STATES.CANCELLED);
    expect(signal.type).toBe('p2p-cancel');
  });
});

describe('onCancel', () => {
  it('moves a transferring session to cancelled with the peer reason', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session } = onCancel(sT, { type: 'p2p-cancel', transferId: 'xfer-1', reason: 'Peer quit.' });
    expect(session.state).toBe(STATES.CANCELLED);
    expect(session.reason).toBe('Peer quit.');
  });

  it('ignores a late cancel signal when the transfer is already done', () => {
    const s = makeSenderSession(1);
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session: s1 } = buildChunk(sT);
    const { session: done } = onAllChunksSent(s1);
    const { session } = onCancel(done, { reason: 'Too late.' });
    expect(session.state).toBe(STATES.DONE); // unchanged
  });

  it('ignores a late cancel signal when already cancelled', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session: cancelled } = cancel(sT, 'first');
    const { session } = onCancel(cancelled, { reason: 'second' });
    expect(session.reason).toBe('first'); // first cancel's reason kept
  });

  it('uses a default reason when the signal carries none', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session } = onCancel(sT, { type: 'p2p-cancel', transferId: 'xfer-1' });
    expect(session.reason).toBeTruthy();
  });
});

// ── canSendNext ───────────────────────────────────────────────────────────────

describe('canSendNext', () => {
  it('allows sending when bufferedAmount is below the threshold', () => {
    expect(canSendNext(0, DEFAULT_DRAIN_THRESHOLD, STATES.TRANSFERRING)).toBe(true);
    expect(canSendNext(DEFAULT_DRAIN_THRESHOLD - 1, DEFAULT_DRAIN_THRESHOLD, STATES.TRANSFERRING)).toBe(true);
  });

  it('allows sending when bufferedAmount is exactly at the threshold', () => {
    // Equal-to is allowed: the channel is not yet overloaded.
    expect(canSendNext(DEFAULT_DRAIN_THRESHOLD, DEFAULT_DRAIN_THRESHOLD, STATES.TRANSFERRING)).toBe(true);
  });

  it('blocks sending when bufferedAmount exceeds the threshold', () => {
    expect(canSendNext(DEFAULT_DRAIN_THRESHOLD + 1, DEFAULT_DRAIN_THRESHOLD, STATES.TRANSFERRING)).toBe(false);
    expect(canSendNext(10_000_000, DEFAULT_DRAIN_THRESHOLD, STATES.TRANSFERRING)).toBe(false);
  });

  it('blocks sending in any non-transferring state', () => {
    const nonTransferring = [
      STATES.IDLE, STATES.OFFERING, STATES.AWAITING_DECISION,
      STATES.DONE, STATES.REJECTED, STATES.CANCELLED, STATES.ERROR,
    ];
    for (const state of nonTransferring) {
      expect(canSendNext(0, DEFAULT_DRAIN_THRESHOLD, state)).toBe(false);
    }
  });
});

// ── progress ──────────────────────────────────────────────────────────────────

describe('progress', () => {
  it('reports zero elapsed and null rate before the transfer has started', () => {
    const s = makeSenderSession();
    const p = progress(s, 5000);
    expect(p.elapsed).toBe(0);
    expect(p.rate).toBeNull();
    expect(p.eta).toBeNull();
  });

  it('reports the correct total bytes and chunk counts', () => {
    const size = CHUNK_SIZE * 2 + 100;
    const s = makeSenderSession(size);
    const p = progress(s, 0);
    expect(p.totalBytes).toBe(size);
    expect(p.totalChunks).toBe(3);
    expect(p.bytesDone).toBe(0);
  });

  it('computes rate from injected timestamps, not from the real clock', () => {
    const file = makeFileBuffer(CHUNK_SIZE);
    const s = createSenderSession({
      transferId: 'r', fromUin: '1', toUin: '2', filename: 'f', fileBuffer: file,
    });
    const { session: sOffer } = makeOffer(s);
    // Transfer started at t=1000, one full chunk sent.
    const { session: sT } = onOfferAccepted(sOffer, 1000);
    const { session: s1 } = buildChunk(sT);

    // Ask for progress at t=2000 (1 second elapsed).
    const p = progress(s1, 2000);
    expect(p.elapsed).toBe(1000);
    expect(p.bytesDone).toBe(CHUNK_SIZE);
    // Rate should be CHUNK_SIZE bytes per second.
    expect(p.rate).toBeCloseTo(CHUNK_SIZE, 0);
  });

  it('computes a finite eta when rate is known', () => {
    const file = makeFileBuffer(CHUNK_SIZE * 2);
    const s = createSenderSession({
      transferId: 'e', fromUin: '1', toUin: '2', filename: 'f', fileBuffer: file,
    });
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 0);
    const { session: s1 } = buildChunk(sT); // first of two chunks

    // At t=1000, one chunk of two done.
    const p = progress(s1, 1000);
    expect(p.eta).not.toBeNull();
    expect(p.eta).toBeGreaterThan(0);
    // At this rate (CHUNK_SIZE bytes in 1000 ms), one more chunk takes 1000 ms.
    expect(p.eta).toBeCloseTo(1000, 0);
  });

  it('returns null eta when no bytes have moved', () => {
    const s = makeSenderSession();
    const { session: sOffer } = makeOffer(s);
    const { session: sT } = onOfferAccepted(sOffer, 1000);
    // No chunks sent yet, progress at t=2000.
    const p = progress(sT, 2000);
    expect(p.eta).toBeNull();
  });
});

// ── end-to-end round-trip ─────────────────────────────────────────────────────

describe('full round-trip', () => {
  it('transfers a file of three full chunks plus a partial chunk without loss', () => {
    const file = makeFileBuffer(CHUNK_SIZE * 3 + 1);
    const s = createSenderSession({
      transferId: 't1', fromUin: '111', toUin: '222',
      filename: 'archive.tar', fileBuffer: file,
    });

    // Offer/accept handshake.
    const { session: sOffer, signal: offerSignal } = makeOffer(s);
    const r = createReceiverSession(offerSignal);
    const { session: rT, signal: acceptSignal } = acceptOffer(r, 1000);
    const { session: sT } = onOfferAccepted(sOffer, 1000);

    expect(acceptSignal.type).toBe('p2p-accept');

    // Transfer all chunks.
    const { senderSession: sFinal, receiverSession: rFinal } = pumpAllChunks(sT, rT);

    // Sender wraps up.
    const { session: sDone, packet: donePkt } = onAllChunksSent(sFinal);
    expect(sDone.state).toBe(STATES.DONE);
    expect(donePkt.type).toBe('transfer-done');

    // Receiver should already be done.
    expect(rFinal.state).toBe(STATES.DONE);
    expect(rFinal.fileBuffer.equals(file)).toBe(true);
  });

  it('transfers an empty file', () => {
    const file = Buffer.alloc(0);
    const s = createSenderSession({
      transferId: 'empty', fromUin: '1', toUin: '2', filename: 'empty.bin',
      fileBuffer: file,
    });
    const { session: sOffer, signal } = makeOffer(s);
    const r = createReceiverSession(signal);
    const { session: rT } = acceptOffer(r, 0);
    const { session: sT } = onOfferAccepted(sOffer, 0);

    const { receiverSession: rFinal } = pumpAllChunks(sT, rT);
    expect(rFinal.state).toBe(STATES.DONE);
    expect(rFinal.fileBuffer.length).toBe(0);
  });
});
