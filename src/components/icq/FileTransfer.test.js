/**
 * FileTransfer.test.js
 *
 * Stack: React 18 · @testing-library/react v15 · user-event v14 · Jest 27
 *
 * user-event v14 is async — every interaction returns a Promise and wraps
 * itself in act() internally. `await userEvent.click(el)` is the correct
 * idiom; wrapping in a separate act() is not needed and can hide ordering
 * bugs.
 *
 * jsdom does not supply window.crypto.subtle or URL.createObjectURL — both
 * are polyfilled below before any module is imported.
 *
 * @testing-library/jest-dom is not auto-imported (no setupTests.js in this
 * project), so it is imported explicitly at the top of this file.
 */

// ── Node polyfills — must precede all ES-module imports ──────────────────────

const nodeCrypto = require('crypto');
Object.defineProperty(global, 'crypto', {
  value: { subtle: nodeCrypto.webcrypto.subtle },
  writable: true,
  configurable: true,
});

global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// ── peerConnection mock ───────────────────────────────────────────────────────
// Placed before any import so Jest hoisting picks it up correctly.
// The live `lastConn` variable lets tests fire data-channel callbacks.

let lastConn = null;

jest.mock('../../peerConnection', () => ({
  DEFAULT_ICE_SERVERS: [],
  iceConfiguration: () => ({}),
  turnIsIncomplete: () => false,
  createPeerConnection: jest.fn(),
}));

// ── ES imports ────────────────────────────────────────────────────────────────

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FileTransfer from './FileTransfer';
import { createPeerConnection } from '../../peerConnection';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeFakeConn(caller) {
  const handlers = {};
  const conn = {
    caller,
    handlers,
    on:            jest.fn((name, fn) => { handlers[name] = fn; }),
    start:         jest.fn(async () => ({ sdp: 'mock-offer-sdp' })),
    accept:        jest.fn(async () => ({ sdp: 'mock-answer-sdp' })),
    complete:      jest.fn(async () => ({})),
    addCandidate:  jest.fn(async () => ({})),
    send:          jest.fn(() => ({})),
    bufferedAmount: jest.fn(() => 0),
    isOpen:        jest.fn(() => true),
    close:         jest.fn(),
  };
  lastConn = conn;
  return conn;
}

// ── window.api mock ───────────────────────────────────────────────────────────

let signalCb = null;
const sentSignals = [];

beforeEach(() => {
  lastConn = null;
  sentSignals.length = 0;
  signalCb = null;
  jest.clearAllMocks();

  // jest.clearAllMocks() resets .mock.calls etc. but can also clear return
  // values set via mockReturnValue — re-set these here to be safe.
  URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = jest.fn();

  createPeerConnection.mockImplementation(({ caller }) => makeFakeConn(caller));

  window.api = {
    icq: {
      getStatus:  jest.fn(async () => ({ account: { uin: '111111' } })),
      sendSignal: jest.fn((jid, payload) => { sentSignals.push({ jid, payload }); }),
      onSignal:   jest.fn((cb) => { signalCb = cb; return () => { signalCb = null; }; }),
    },
    // Simulate "ABC" (0x41 0x42 0x43) as a file.
    readFileDataUrl: jest.fn(async () =>
      'data:application/octet-stream;base64,' + btoa('\x41\x42\x43')),
    openFileDialog:  jest.fn(async () => '/tmp/test.txt'),
  };
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function sha256hex(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const h = await global.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deliver a signal to the component.
 * Uses async act so all state updates from signal handling are flushed.
 */
async function deliver(signal, from = '222222@icq.im', family = 'transfer') {
  await act(async () => { signalCb?.({ signal, from, family }); });
}

/**
 * Flush pending microtasks that live inside effects (e.g. the async
 * getStatus call that sets ownerUin).  Call once after render().
 */
async function flushAsync() {
  await act(async () => {});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FileTransfer — offer arriving and being accepted', () => {
  test('decision UI appears; accept sends p2p-accept and opens WebRTC as answerer', async () => {
    render(
      <FileTransfer
        jid="222222@icq.im"
        contactName="Bob"
        triggerFile={null}
        onTriggerClear={() => {}}
      />
    );

    await deliver({
      type: 'p2p-offer',
      transferId: 'xfer-1',
      fromUin: '222222',
      toUin: '111111',
      filename: 'hello.txt',
      size: 3,
      totalChunks: 1,
      // Any valid 64-char lowercase hex string satisfies the format check.
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    });

    // Decision dialog must appear.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/hello\.txt/i);
    expect(dialog.textContent).toMatch(/bob/i);

    // user-event v14: await the click — it wraps itself in act() internally.
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    expect(sentSignals.some(s =>
      s.payload.type === 'p2p-accept' && s.payload.transferId === 'xfer-1'
    )).toBe(true);

    // Sender sends call-offer — component opens WebRTC as answerer.
    await deliver(
      { type: 'call-offer', callId: 'xfer-1', sdp: 'remote-sdp' },
      '222222@icq.im',
      'call',
    );

    await waitFor(() => expect(lastConn).not.toBeNull(), { timeout: 2000 });
    expect(createPeerConnection).toHaveBeenCalledWith(
      expect.objectContaining({ caller: false })
    );
    expect(lastConn.accept).toHaveBeenCalledWith('remote-sdp');
  });
});

describe('FileTransfer — chunks reassembling into original bytes', () => {
  test('reaches DONE state and offers save link after all chunks verify', async () => {
    const fileBytes  = new Uint8Array([0x41, 0x42, 0x43]);
    const fileSha    = await sha256hex(fileBytes);
    const chunkHash  = await sha256hex(fileBytes); // one chunk equals whole file
    const transferId = 'xfer-reassemble';

    render(
      <FileTransfer
        jid="222222@icq.im"
        contactName="Bob"
        triggerFile={null}
        onTriggerClear={() => {}}
      />
    );

    await deliver({
      type: 'p2p-offer',
      transferId,
      fromUin: '222222',
      toUin: '111111',
      filename: 'abc.txt',
      size: 3,
      totalChunks: 1,
      sha256: fileSha,
    });

    // v14: await the click.
    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    // Sender opens the WebRTC data channel.
    await deliver(
      { type: 'call-offer', callId: transferId, sdp: 'offer-sdp' },
      '222222@icq.im',
      'call',
    );

    await waitFor(() => expect(lastConn).not.toBeNull(), { timeout: 2000 });

    // Data channel opens.
    await act(async () => { lastConn.handlers.onOpen?.(); });

    // One chunk arrives.
    await act(async () => {
      lastConn.handlers.onMessage?.(JSON.stringify({
        type: 'chunk',
        transferId,
        seq: 0,
        total: 1,
        chunkHash,
        data: bytesToBase64(fileBytes),
      }));
    });

    // transfer-done arrives.
    await act(async () => {
      lastConn.handlers.onMessage?.(JSON.stringify({
        type: 'transfer-done',
        transferId,
        sha256: fileSha,
      }));
    });

    // Reassembly includes an async SHA-256 — poll until the DONE state appears.
    // .ft--done only renders when scheduleReassembly has verified the whole-file
    // hash and called setXfer({ state: DONE }), which proves the bytes matched.
    await waitFor(
      () => expect(document.querySelector('.ft--done')).not.toBeNull(),
      { timeout: 3000 }
    );
    // The save-file link requires URL.createObjectURL — verify it's present too.
    const doneEl = document.querySelector('.ft--done');
    const link = doneEl?.querySelector('a.ft-download');
    expect(link).not.toBeNull();
    expect(link?.textContent).toMatch(/save file/i);
  });
});

describe('FileTransfer — corrupted chunk caught', () => {
  test('chunk with wrong hash surfaces an error', async () => {
    const fileBytes  = new Uint8Array([0x41, 0x42, 0x43]);
    const fileSha    = await sha256hex(fileBytes);
    const wrongHash  = '0'.repeat(64); // all-zeros is never a SHA-256 of 'ABC'
    const transferId = 'xfer-corrupt';

    render(
      <FileTransfer
        jid="222222@icq.im"
        contactName="Bob"
        triggerFile={null}
        onTriggerClear={() => {}}
      />
    );

    await deliver({
      type: 'p2p-offer',
      transferId,
      fromUin: '222222',
      toUin: '111111',
      filename: 'corrupt.txt',
      size: 3,
      totalChunks: 1,
      sha256: fileSha,
    });

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    await deliver(
      { type: 'call-offer', callId: transferId, sdp: 'offer-sdp' },
      '222222@icq.im',
      'call',
    );

    await waitFor(() => expect(lastConn).not.toBeNull(), { timeout: 2000 });
    await act(async () => { lastConn.handlers.onOpen?.(); });

    // Chunk whose hash deliberately does not match the data.
    await act(async () => {
      lastConn.handlers.onMessage?.(JSON.stringify({
        type: 'chunk',
        transferId,
        seq: 0,
        total: 1,
        chunkHash: wrongHash,
        data: bytesToBase64(fileBytes),
      }));
    });

    // Component must surface an error, not silently continue.
    await waitFor(
      () => {
        const el = screen.getByRole('alert');
        expect(el.textContent).toMatch(/integrity|check failed/i);
      },
      { timeout: 3000 }
    );
  });
});

describe('FileTransfer — cancellation', () => {
  test('Owner cancels an outbound offer: sends p2p-cancel and shows cancelled state', async () => {
    const onTriggerClear = jest.fn();
    const { rerender } = render(
      <FileTransfer
        jid="222222@icq.im"
        contactName="Bob"
        triggerFile={null}
        onTriggerClear={onTriggerClear}
      />
    );

    // Flush the async getStatus effect so ownerUin is set before triggerFile changes.
    // Without this, the triggerFile effect returns early (`!ownerUin`).
    await flushAsync();

    await act(async () => {
      rerender(
        <FileTransfer
          jid="222222@icq.im"
          contactName="Bob"
          triggerFile="/tmp/test.txt"
          onTriggerClear={onTriggerClear}
        />
      );
    });

    // The triggerFile effect is async (readFileDataUrl + sha256), so poll.
    await waitFor(
      () => expect(sentSignals.some(s => s.payload.type === 'p2p-offer')).toBe(true),
      { timeout: 3000 }
    );

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(sentSignals.some(s => s.payload.type === 'p2p-cancel')).toBe(true);
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });

  test('inbound p2p-cancel from peer aborts an accepted receive', async () => {
    const transferId = 'xfer-peer-cancel';

    render(
      <FileTransfer
        jid="222222@icq.im"
        contactName="Bob"
        triggerFile={null}
        onTriggerClear={() => {}}
      />
    );

    await deliver({
      type: 'p2p-offer',
      transferId,
      fromUin: '222222',
      toUin: '111111',
      filename: 'cancel.txt',
      size: 3,
      totalChunks: 1,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    });

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    // Peer cancels before WebRTC is up.
    await deliver({ type: 'p2p-cancel', transferId, reason: 'Changed mind.' });

    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });
});

describe('FileTransfer — malformed offer from untrusted peer is rejected', () => {
  const goodBase = {
    type: 'p2p-offer',
    transferId: 'xfer-bad',
    fromUin: '222222',
    toUin: '111111',
    filename: 'test.txt',
    size: 3,
    totalChunks: 1,
    sha256: 'ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469ad46c9b31f1c05555', // sha256('abc')
  };

  test.each([
    ['totalChunks: 0',          { ...goodBase, totalChunks: 0 }],
    ['totalChunks > MAX_CHUNKS',{ ...goodBase, totalChunks: 65_536 }],
    ['size: negative',          { ...goodBase, size: -1 }],
    ['size: NaN',               { ...goodBase, size: NaN }],
    ['sha256: short string',    { ...goodBase, sha256: 'abc' }],
    ['sha256: non-hex',         { ...goodBase, sha256: 'z'.repeat(64) }],
  ])('ignores offer with %s', async (_, signal) => {
    render(
      <FileTransfer
        jid="222222@icq.im"
        contactName="Bob"
        triggerFile={null}
        onTriggerClear={() => {}}
      />
    );

    await deliver(signal);

    // No UI for the malformed offer — the component should remain idle (null render).
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('FileTransfer — no-route failure surfaced', () => {
  test('WebRTC onFailed message appears in the error UI', async () => {
    const transferId = 'xfer-noroute';
    const noRouteMsg =
      'No route to this Contact. If either of you is on a mobile or office network, ' +
      'a direct connection may not be possible without a TURN relay.';

    render(
      <FileTransfer
        jid="222222@icq.im"
        contactName="Bob"
        triggerFile={null}
        onTriggerClear={() => {}}
      />
    );

    await deliver({
      type: 'p2p-offer',
      transferId,
      fromUin: '222222',
      toUin: '111111',
      filename: 'noroute.txt',
      size: 3,
      totalChunks: 1,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    });

    await userEvent.click(screen.getByRole('button', { name: /accept/i }));

    await deliver(
      { type: 'call-offer', callId: transferId, sdp: 'offer-sdp' },
      '222222@icq.im',
      'call',
    );

    await waitFor(() => expect(lastConn).not.toBeNull(), { timeout: 2000 });

    await act(async () => {
      lastConn.handlers.onFailed?.({ reason: noRouteMsg });
    });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/no route.*contact/i);
    }, { timeout: 2000 });
  });
});
