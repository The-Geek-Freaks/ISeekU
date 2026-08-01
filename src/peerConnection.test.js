/**
 * jsdom has no WebRTC, so `RTCPeerConnection` is stubbed here. That limits
 * what can honestly be tested: the handshake itself belongs to Chromium and
 * testing a stub of it proves nothing.
 *
 * What these tests do cover is the part this file actually decides — the ICE
 * configuration, the refusal paths, the size limit on inbound data, and the
 * timeout that turns "no route to this Contact" into a stated failure instead
 * of a connection that sits on `connecting` forever.
 */

import {
  iceConfiguration,
  turnIsIncomplete,
  createPeerConnection,
  DEFAULT_ICE_SERVERS,
} from './peerConnection';

/** Enough of RTCPeerConnection to exercise the wrapper's own decisions. */
class FakeChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'connecting';
    this.bufferedAmount = 0;
    this.sent = [];
    this.binaryType = 'blob';
  }

  open() {
    this.readyState = 'open';
    if (this.onopen) this.onopen();
  }

  send(data) {
    if (this.throwOnSend) throw new Error('channel gone');
    this.sent.push(data);
  }

  close() {
    this.readyState = 'closed';
    if (this.onclose) this.onclose();
  }

  receive(data) {
    if (this.onmessage) this.onmessage({ data });
  }
}

let lastConnection;

class FakePeerConnection {
  constructor(config) {
    this.config = config;
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.candidates = [];
    this.channels = [];
    this.closed = false;
    lastConnection = this;
  }

  createDataChannel(label) {
    const channel = new FakeChannel(label);
    this.channels.push(channel);
    return channel;
  }

  async createOffer() { return { type: 'offer', sdp: 'v=0 offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0 answer' }; }

  async setLocalDescription(desc) {
    if (this.failLocal) throw new Error('bad local description');
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    if (this.failRemote) throw new Error('bad remote description');
    this.remoteDescription = desc;
  }

  async addIceCandidate(candidate) {
    if (this.failCandidate) throw new Error('candidate arrived too early');
    this.candidates.push(candidate);
  }

  close() { this.closed = true; }

  /** Drive the state machine the way the browser would. */
  setState(state) {
    this.connectionState = state;
    if (this.onconnectionstatechange) this.onconnectionstatechange();
  }
}

beforeEach(() => {
  lastConnection = null;
  global.RTCPeerConnection = FakePeerConnection;
});

afterEach(() => {
  delete global.RTCPeerConnection;
  jest.useRealTimers();
});

const build = (opts = {}) => createPeerConnection({
  contactJid: '112233@demo.iseeku',
  caller: true,
  sendSignal: jest.fn(),
  ...opts,
});

describe('choosing ICE servers', () => {
  it('falls back to the default STUN server when none is configured', () => {
    expect(iceConfiguration().iceServers).toEqual([...DEFAULT_ICE_SERVERS]);
    expect(iceConfiguration({ stunUrl: '   ' }).iceServers).toEqual([...DEFAULT_ICE_SERVERS]);
  });

  it('uses the Owner\'s STUN server instead of the default when given one', () => {
    const { iceServers } = iceConfiguration({ stunUrl: 'stun:stun.example.org:3478' });
    expect(iceServers).toEqual([{ urls: 'stun:stun.example.org:3478' }]);
  });

  it('adds a TURN server when it has credentials', () => {
    const { iceServers } = iceConfiguration({
      turnUrl: 'turn:relay.example.org:3478', turnUsername: 'u', turnPassword: 'p',
    });
    expect(iceServers).toContainEqual({
      urls: 'turn:relay.example.org:3478', username: 'u', credential: 'p',
    });
  });

  it('drops a TURN server with no credentials rather than passing it on', () => {
    // ICE would spend its budget on a relay that refuses it, and the failure
    // would look like "no route" rather than "you left the password out".
    const { iceServers } = iceConfiguration({ turnUrl: 'turn:relay.example.org:3478' });
    expect(iceServers.every((s) => !String(s.urls).startsWith('turn:'))).toBe(true);
  });

  it('says when a TURN server was asked for but cannot be used', () => {
    expect(turnIsIncomplete({ turnUrl: 'turn:relay.example.org' })).toBe(true);
    expect(turnIsIncomplete({ turnUrl: 'turn:r.example', turnUsername: 'u', turnPassword: 'p' })).toBe(false);
    expect(turnIsIncomplete({})).toBe(false);
  });
});

describe('opening a connection', () => {
  it('creates the data channel when it is the caller', () => {
    build({ caller: true });
    expect(lastConnection.channels).toHaveLength(1);
  });

  it('waits for the far end to create the channel when it is not', () => {
    build({ caller: false });
    expect(lastConnection.channels).toHaveLength(0);
    expect(typeof lastConnection.ondatachannel).toBe('function');
  });

  it('reports open once the channel opens', () => {
    const onOpen = jest.fn();
    build().on('onOpen', onOpen);
    lastConnection.channels[0].open();
    expect(onOpen).toHaveBeenCalled();
  });

  it('sends each ICE candidate it gathers, and nothing for the end marker', () => {
    const sendSignal = jest.fn();
    build({ sendSignal });
    lastConnection.onicecandidate({ candidate: { toJSON: () => ({ candidate: 'a' }) } });
    lastConnection.onicecandidate({ candidate: null });
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal).toHaveBeenCalledWith({ type: 'call-ice', candidate: { candidate: 'a' } });
  });

  it('produces an offer', async () => {
    const conn = build();
    const { sdp, error } = await conn.start();
    expect(error).toBeUndefined();
    expect(sdp).toMatchObject({ type: 'offer' });
  });

  it('answers an offer', async () => {
    const conn = build({ caller: false });
    const { sdp } = await conn.accept({ type: 'offer', sdp: 'v=0' });
    expect(sdp).toMatchObject({ type: 'answer' });
    expect(lastConnection.remoteDescription).toMatchObject({ type: 'offer' });
  });

  it('reports a handshake failure rather than throwing', async () => {
    const onFailed = jest.fn();
    const conn = build();
    conn.on('onFailed', onFailed);
    lastConnection.failLocal = true;
    const { error } = await conn.start();
    expect(error).toBeTruthy();
    expect(onFailed).toHaveBeenCalled();
  });

  it('tolerates a candidate that arrives before the description', async () => {
    // Routine, and not worth ending a call over.
    const onFailed = jest.fn();
    const conn = build();
    conn.on('onFailed', onFailed);
    lastConnection.failCandidate = true;
    const { error } = await conn.addCandidate({ candidate: 'a' });
    expect(error).toBeTruthy();
    expect(onFailed).not.toHaveBeenCalled();
  });
});

describe('when there is no route', () => {
  it('fails with an explanation instead of waiting forever', () => {
    jest.useFakeTimers();
    const onFailed = jest.fn();
    build({ timeoutMs: 1000 }).on('onFailed', onFailed);
    jest.advanceTimersByTime(1001);
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({
      reason: expect.stringMatching(/TURN relay/i),
    }));
  });

  it('does not fail after the connection is already open', () => {
    jest.useFakeTimers();
    const onFailed = jest.fn();
    const conn = build({ timeoutMs: 1000 });
    conn.on('onFailed', onFailed);
    lastConnection.channels[0].open();
    jest.advanceTimersByTime(5000);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('reports a failed connection state', () => {
    const onFailed = jest.fn();
    build().on('onFailed', onFailed);
    lastConnection.setState('failed');
    expect(onFailed).toHaveBeenCalled();
  });
});

describe('sending and receiving', () => {
  it('refuses to send before the channel is open', () => {
    expect(build().send('hello').error).toMatch(/not open/i);
  });

  it('sends once open', () => {
    const conn = build();
    lastConnection.channels[0].open();
    expect(conn.send('hello')).toEqual({ ok: true });
    expect(lastConnection.channels[0].sent).toEqual(['hello']);
  });

  it('refuses a message larger than a chunk can be', () => {
    const conn = build();
    lastConnection.channels[0].open();
    expect(conn.send(new ArrayBuffer(300 * 1024)).error).toMatch(/too large/i);
  });

  it('reports a send that throws rather than propagating it', () => {
    const conn = build();
    const channel = lastConnection.channels[0];
    channel.open();
    channel.throwOnSend = true;
    expect(conn.send('x').error).toBe('channel gone');
  });

  it('passes received data to the handler', () => {
    const onMessage = jest.fn();
    const conn = build();
    conn.on('onMessage', onMessage);
    lastConnection.channels[0].open();
    lastConnection.channels[0].receive('from the far end');
    expect(onMessage).toHaveBeenCalledWith('from the far end');
  });

  it('drops oversized inbound data instead of handling it', () => {
    // The far end is somebody else's client and controls what it sends.
    const onMessage = jest.fn();
    const onFailed = jest.fn();
    const conn = build();
    conn.on('onMessage', onMessage).on('onFailed', onFailed);
    lastConnection.channels[0].open();
    lastConnection.channels[0].receive(new ArrayBuffer(300 * 1024));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalled();
  });

  it('reports what is queued so the transfer can pace itself', () => {
    const conn = build();
    lastConnection.channels[0].bufferedAmount = 4096;
    expect(conn.bufferedAmount()).toBe(4096);
  });

  it('closes both the channel and the connection', () => {
    const conn = build();
    conn.close();
    expect(lastConnection.closed).toBe(true);
    expect(lastConnection.channels[0].readyState).toBe('closed');
  });
});
