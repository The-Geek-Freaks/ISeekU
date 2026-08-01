/**
 * Tests for CallPanel.
 *
 * getUserMedia and RTCPeerConnection do not exist in jsdom, so both are stubbed
 * here — the same approach src/peerConnection.test.js uses for RTCPeerConnection.
 * What these tests cover is the part CallPanel actually decides: state transitions
 * via icq-call.js, signal dispatch, and the UI that results.
 *
 * Scenarios:
 *   1. An offer arriving and ringing.
 *   2. The Owner accepting — call-answer sent, phase advances to connecting.
 *   3. The Owner declining — call-reject sent, UI clears.
 *   4. The ring timeout — call ends without Owner input.
 *   5. Mute announced — call-mute sent with the correct flag.
 *   6. Hang up — call-hangup sent, call ends.
 *   7. Glare: lower UIN wins, stays offering, sends glare-reject.
 *   8. Glare: higher UIN loses, transitions to ringing (becomes callee).
 *
 * Owner UIN = '100', Contact UIN = '200'. 100 < 200 so the Owner wins glare
 * in the default case; test 8 swaps UINs.
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CallPanel from './CallPanel';
// Import resolveGlare from the same module CallPanel uses so the glare test
// verifies the renderer-accessible copy, not just the CJS original.
import { resolveGlare } from '../../lib/icq-call';

const OWNER_UIN   = '100';
const CONTACT_UIN = '200';
const CONTACT_JID = `${CONTACT_UIN}@icq.im`;

// ── RTCPeerConnection stub ────────────────────────────────────────────────────

let lastFakePC = null;

class FakeChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'connecting';
    this.bufferedAmount = 0;
    this.binaryType = 'blob';
  }
  send() {}
  close() { this.readyState = 'closed'; if (this.onclose) this.onclose(); }
}

class FakePeerConnection {
  constructor(config) {
    this.config = config;
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.candidates = [];
    this.tracks = [];
    this.channels = [];
    this.closed = false;
    lastFakePC = this;
  }

  addTrack(track, stream) { this.tracks.push({ track, stream }); }

  createDataChannel(label) {
    const ch = new FakeChannel(label);
    this.channels.push(ch);
    return ch;
  }

  async createOffer()  { return { type: 'offer',  sdp: 'v=0\r\noffer'  }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\nanswer' }; }

  async setLocalDescription(desc)  { this.localDescription  = desc; }
  async setRemoteDescription(desc) { this.remoteDescription = desc; }

  async addIceCandidate(c) { this.candidates.push(c); }

  close() { this.closed = true; }

  /** Drive the connection state machine the way the browser would. */
  setState(state) {
    this.connectionState = state;
    if (this.onconnectionstatechange) this.onconnectionstatechange();
  }
}

// ── getUserMedia stub ─────────────────────────────────────────────────────────

let mockAudioTrack;
let mockVideoTrack;
let mockStream;

function buildMockStream({ withVideo = false } = {}) {
  mockAudioTrack = { kind: 'audio', enabled: true, stop: jest.fn() };
  mockVideoTrack = { kind: 'video', enabled: true, stop: jest.fn() };
  const tracks = withVideo ? [mockAudioTrack, mockVideoTrack] : [mockAudioTrack];
  mockStream = {
    getTracks:      () => tracks,
    getAudioTracks: () => [mockAudioTrack],
    getVideoTracks: () => (withVideo ? [mockVideoTrack] : []),
    addTrack:       jest.fn(),
  };
  return mockStream;
}

// ── window.api stub ───────────────────────────────────────────────────────────

/**
 * Set up window.api with ICQ stubs. Returns sendSignal (a jest mock) and
 * getSignalCallback (which returns the callback registered by onSignal so tests
 * can fire signals directly into the component).
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
 * Render CallPanel and wait for the owner UIN to be fetched before returning.
 * All tests that exercise inbound signals need the UIN ready first.
 */
async function renderAndWaitForUin({ ownerUin = OWNER_UIN, ...props } = {}) {
  const controls = buildApi({ ownerUin });
  render(
    <CallPanel
      jid={CONTACT_JID}
      contactName="Bob"
      initiateCall={null}
      onInitiateCallClear={jest.fn()}
      {...props}
    />,
  );
  await waitFor(() => expect(window.api.icq.getStatus).toHaveBeenCalled());
  return controls;
}

/**
 * Fire a call signal from the Contact, wrapped in act() so React flushes
 * state updates before any assertion runs.
 */
function fireSignal(getCallback, signal, { from = CONTACT_JID, family = 'call' } = {}) {
  act(() => {
    getCallback()?.({ signal, from, family });
  });
}

/** A minimal call-offer signal from the Contact. */
function makeOffer(overrides = {}) {
  return {
    type:   'call-offer',
    callId: 'call-test-1',
    from:   CONTACT_JID,
    to:     `${OWNER_UIN}@icq.im`,
    media:  { audio: true, video: false },
    sdp:    { type: 'offer', sdp: 'v=0\r\noffer' },
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  lastFakePC = null;
  global.RTCPeerConnection = FakePeerConnection;
  buildMockStream();

  // Define mediaDevices; jsdom does not provide it.
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: jest.fn().mockResolvedValue(mockStream),
    },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  delete global.RTCPeerConnection;
  jest.useRealTimers();
  delete window.api;
});

// ── 1. Offer arriving and ringing ─────────────────────────────────────────────

describe('an offer arriving and ringing', () => {
  it('shows Accept and Decline buttons when a call-offer arrives', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());

    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });

  it('names the Contact in the ringing UI', async () => {
    const { getSignalCallback } = await renderAndWaitForUin({ contactName: 'Alice' });

    fireSignal(getSignalCallback, makeOffer());

    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it('labels an incoming audio call as "Audio Call"', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer({ media: { audio: true, video: false } }));

    expect(screen.getByRole('dialog')).toHaveTextContent(/audio/i);
  });

  it('labels an incoming video call as "Video Call"', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer({ media: { audio: true, video: true } }));

    expect(screen.getByRole('dialog')).toHaveTextContent(/video/i);
  });

  it('ignores a signal from a different Contact', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer(), { from: '999@icq.im' });

    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });

  it('strips the resource from the sender JID before comparing', async () => {
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer(), { from: `${CONTACT_JID}/ISeekU-host` });

    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
  });
});

// ── 2. Accept ─────────────────────────────────────────────────────────────────

describe('accepting an incoming call', () => {
  it('sends call-answer when the Owner accepts', async () => {
    const user = userEvent.setup();
    const { getSignalCallback, sendSignal } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());
    await user.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(sendSignal).toHaveBeenCalledWith(
        CONTACT_JID,
        expect.objectContaining({ type: 'call-answer' }),
      );
    });
  });

  it('removes the Accept button after accepting', async () => {
    const user = userEvent.setup();
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());
    await user.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    });
  });

  it('transitions to connecting then active when the connection is established', async () => {
    const user = userEvent.setup();
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());
    await user.click(screen.getByRole('button', { name: /accept/i }));

    // Wait until the connecting phase is reached (answer sent, machine in 'connecting').
    await waitFor(() => expect(lastFakePC).not.toBeNull());

    // Drive the connection state to 'connected' so the machine calls connectionEstablished().
    act(() => { lastFakePC.setState('connected'); });

    // The Mute and Hang Up buttons appear only in the active phase.
    await screen.findByRole('button', { name: /mute/i });
    await screen.findByRole('button', { name: /hang up/i });
  });
});

// ── 3. Reject ─────────────────────────────────────────────────────────────────

describe('rejecting an incoming call', () => {
  it('sends call-reject when the Owner declines', async () => {
    const user = userEvent.setup();
    const { getSignalCallback, sendSignal } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());
    await user.click(screen.getByRole('button', { name: /decline/i }));

    expect(sendSignal).toHaveBeenCalledWith(
      CONTACT_JID,
      expect.objectContaining({ type: 'call-reject' }),
    );
  });

  it('removes the ringing dialogue after the Owner declines', async () => {
    const user = userEvent.setup();
    const { getSignalCallback } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());
    await user.click(screen.getByRole('button', { name: /decline/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ── 4. Ring timeout ───────────────────────────────────────────────────────────

describe('ring timeout', () => {
  it('ends the call when the ring timeout elapses without an answer', async () => {
    jest.useFakeTimers();

    const controls = buildApi({ ownerUin: OWNER_UIN });
    render(
      <CallPanel
        jid={CONTACT_JID}
        contactName="Bob"
        initiateCall={null}
        onInitiateCallClear={jest.fn()}
      />,
    );

    // Flush microtasks so the getStatus promise resolves and ownerUin is set.
    await act(async () => {});

    // Deliver the incoming offer.
    act(() => {
      controls.getSignalCallback()?.({
        signal: makeOffer(),
        from: CONTACT_JID,
        family: 'call',
      });
    });

    // The ringing UI must be visible before advancing time.
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();

    // Advance past the default 30 000 ms ring timeout.
    act(() => { jest.advanceTimersByTime(31_000); });

    // Flush any state-update microtasks triggered by the timeout callback.
    await act(async () => {});

    // The ringing UI must be gone — the call timed out.
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
  });
});

// ── 5. Mute announced ────────────────────────────────────────────────────────

describe('mute', () => {
  /** Reach the active state (receive offer → accept → connection established). */
  async function reachActive() {
    const user = userEvent.setup();
    const { getSignalCallback, sendSignal } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());
    await user.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => expect(lastFakePC).not.toBeNull());
    act(() => { lastFakePC.setState('connected'); });
    await screen.findByRole('button', { name: /mute/i });

    return { user, sendSignal, getSignalCallback };
  }

  it('sends call-mute with muted: true when the Owner clicks Mute', async () => {
    const { user, sendSignal } = await reachActive();

    await user.click(screen.getByRole('button', { name: /^mute$/i }));

    expect(sendSignal).toHaveBeenCalledWith(
      CONTACT_JID,
      expect.objectContaining({ type: 'call-mute', muted: true }),
    );
  });

  it('sends call-mute with muted: false when the Owner unmutes', async () => {
    const { user, sendSignal } = await reachActive();

    await user.click(screen.getByRole('button', { name: /^mute$/i }));   // mute
    await user.click(screen.getByRole('button', { name: /unmute/i }));  // unmute

    expect(sendSignal).toHaveBeenLastCalledWith(
      CONTACT_JID,
      expect.objectContaining({ type: 'call-mute', muted: false }),
    );
  });

  it('reflects the remote mute state when the Contact sends call-mute', async () => {
    const { getSignalCallback } = await reachActive();

    fireSignal(getSignalCallback, {
      type: 'call-mute', callId: 'call-test-1', muted: true,
    });

    expect(screen.getByText(/contact muted/i)).toBeInTheDocument();
  });
});

// ── 6. Hang up ────────────────────────────────────────────────────────────────

describe('hang up', () => {
  /** Reach the active state. */
  async function reachActive() {
    const user = userEvent.setup();
    const { getSignalCallback, sendSignal } = await renderAndWaitForUin();

    fireSignal(getSignalCallback, makeOffer());
    await user.click(screen.getByRole('button', { name: /accept/i }));

    await waitFor(() => expect(lastFakePC).not.toBeNull());
    act(() => { lastFakePC.setState('connected'); });
    await screen.findByRole('button', { name: /hang up/i });

    return { user, sendSignal, getSignalCallback };
  }

  it('sends call-hangup when the Owner clicks Hang Up', async () => {
    const { user, sendSignal } = await reachActive();

    await user.click(screen.getByRole('button', { name: /hang up/i }));

    expect(sendSignal).toHaveBeenCalledWith(
      CONTACT_JID,
      expect.objectContaining({ type: 'call-hangup' }),
    );
  });

  it('removes the call controls after hanging up', async () => {
    const { user } = await reachActive();

    await user.click(screen.getByRole('button', { name: /hang up/i }));

    // Hang Up button must disappear — the call is over.
    expect(screen.queryByRole('button', { name: /hang up/i })).not.toBeInTheDocument();
  });

  it('ends the call when the Contact sends call-hangup during an active call', async () => {
    const { getSignalCallback } = await reachActive();

    fireSignal(getSignalCallback, { type: 'call-hangup', callId: 'call-test-1' });

    // The Hang Up button disappears once the call ends.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /hang up/i })).not.toBeInTheDocument();
    });
  });
});

// ── 7 & 8. Glare resolution ───────────────────────────────────────────────────

describe('glare resolution', () => {
  /**
   * Start an outgoing call, wait for the call-offer to be sent (so the machine
   * is in 'offering' state), then return controls for further assertions.
   */
  async function startOutgoingCall({ ownerUin = OWNER_UIN } = {}) {
    const controls = buildApi({ ownerUin });
    render(
      <CallPanel
        jid={CONTACT_JID}
        contactName="Bob"
        initiateCall="audio"
        onInitiateCallClear={jest.fn()}
      />,
    );
    await waitFor(() => expect(window.api.icq.getStatus).toHaveBeenCalled());

    // Wait for the outgoing call-offer to be dispatched.
    await waitFor(() => {
      expect(controls.sendSignal).toHaveBeenCalledWith(
        CONTACT_JID,
        expect.objectContaining({ type: 'call-offer' }),
      );
    });

    return controls;
  }

  it('stays in "offering" and sends a call-reject when the Owner wins glare (lower UIN)', async () => {
    // Owner UIN = '100', Contact UIN = '200' → resolveGlare('100','200') = 'win'.
    const controls = await startOutgoingCall({ ownerUin: OWNER_UIN });

    // The Contact simultaneously sends an offer (glare).
    fireSignal(controls.getSignalCallback, makeOffer({ callId: 'call-contact-1' }));

    // The Owner won: a glare-reject is sent, and the offering UI is still showing.
    expect(controls.sendSignal).toHaveBeenCalledWith(
      CONTACT_JID,
      expect.objectContaining({ type: 'call-reject', reason: 'glare' }),
    );
    // The Cancel button is the offering-phase control — still present.
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('transitions to "ringing" when the Owner loses glare (higher UIN)', async () => {
    // Owner UIN = '300', Contact UIN = '200' → resolveGlare('300','200') = 'lose'.
    const controls = await startOutgoingCall({ ownerUin: '300' });

    // Contact sends an offer simultaneously.
    fireSignal(controls.getSignalCallback, makeOffer({ callId: 'call-contact-1' }));

    // The Owner lost: no reject was sent; the Owner is now the callee.
    const callRejectCalls = controls.sendSignal.mock.calls.filter(
      ([, payload]) => payload.type === 'call-reject',
    );
    expect(callRejectCalls).toHaveLength(0);

    // Accept and Decline buttons appear — the Owner is now ringing.
    await screen.findByRole('button', { name: /accept/i });
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
  });

  it('resolves glare symmetrically: both sides run the same function', () => {
    // Verify resolveGlare from src/lib/icq-call (the module CallPanel imports)
    // to document the contract. Both sides compare (ourUin, theirUin) and
    // reach opposite conclusions.
    expect(resolveGlare('100', '200')).toBe('win');  // lower UIN wins
    expect(resolveGlare('200', '100')).toBe('lose'); // higher UIN loses
    // The same comparison from both sides: both agree on the outcome.
    expect(resolveGlare('100', '200')).not.toBe(resolveGlare('200', '100'));
  });
});
