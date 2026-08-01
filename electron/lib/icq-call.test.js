const {
  createCall,
  resolveGlare,
  END_REASONS,
} = require('./icq-call');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Build raw signalling messages as they would arrive from the wire.
function wireOffer(callId, from, to, video = false) {
  return { type: 'offer', callId, from, to, media: { audio: true, video }, sdp: null };
}

function wireAnswer(callId, from, to) {
  return { type: 'answer', callId, from, to, sdp: null };
}

function wireReject(callId, from, to, reason = 'rejected') {
  return { type: 'reject', callId, from, to, reason };
}

function wireHangup(callId, from, to) {
  return { type: 'hangup', callId, from, to };
}

function wireIce(callId, from, to) {
  return { type: 'ice-candidate', callId, from, to, candidate: null };
}

function wireMediaChange(callId, from, to, video) {
  return { type: 'media-change', callId, from, to, media: { audio: true, video } };
}

function wireMediaChangeResponse(callId, from, to, accepted) {
  return {
    type: 'media-change-response', callId, from, to,
    accepted, media: { audio: true, video: accepted },
  };
}

function wireMute(callId, from, to, muted) {
  return { type: 'mute', callId, from, to, muted };
}

function wireCamera(callId, from, to, cameraOff) {
  return { type: 'camera', callId, from, to, cameraOff };
}

/** Shorthand for a default outgoing call with sensible defaults. */
function outgoing(opts = {}) {
  return createCall({
    ownerUin: '1111',
    contactUin: '2222',
    callId: 'call-1',
    mediaType: 'audio',
    ...opts,
  });
}

/** Advance a call to the active state via the normal outgoing path. */
function makeActive(opts = {}) {
  const call = outgoing(opts);
  call.placeCall();
  call.receive(wireAnswer('call-1', '2222', '1111'));
  call.connectionEstablished();
  return call;
}

// ---------------------------------------------------------------------------
// Construction validation
// ---------------------------------------------------------------------------

describe('creating a call', () => {
  it('starts in idle state', () => {
    expect(outgoing().state).toBe('idle');
  });

  it('defaults to audio-only', () => {
    expect(outgoing().media).toEqual({ audio: true, video: false });
  });

  it('creates a video call when asked', () => {
    expect(outgoing({ mediaType: 'video' }).media).toEqual({ audio: true, video: true });
  });

  it('exposes the ring timeout so the application knows how long to wait', () => {
    const call = outgoing({ ringTimeoutMs: 15000 });
    expect(call.ringTimeoutMs).toBe(15000);
  });

  it('refuses to start without ownerUin', () => {
    expect(() => createCall({ contactUin: '2222', callId: 'c1' })).toThrow(/ownerUin/);
  });

  it('refuses to start without contactUin', () => {
    expect(() => createCall({ ownerUin: '1111', callId: 'c1' })).toThrow(/contactUin/);
  });

  it('refuses to start without callId', () => {
    expect(() => createCall({ ownerUin: '1111', contactUin: '2222' })).toThrow(/callId/);
  });

  it('refuses an unrecognised mediaType rather than silently defaulting', () => {
    expect(() => createCall({ ownerUin: '1111', contactUin: '2222', callId: 'c1', mediaType: 'hologram' }))
      .toThrow(/mediaType/);
  });

  it('starts with no local mute or camera-off', () => {
    expect(outgoing().local).toEqual({ muted: false, cameraOff: false });
  });
});

// ---------------------------------------------------------------------------
// Placing a call (idle → offering)
// ---------------------------------------------------------------------------

describe('placing a call', () => {
  it('transitions to offering and returns an offer message', () => {
    const call = outgoing();
    const { messages } = call.placeCall();
    expect(call.state).toBe('offering');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'offer',
      callId: 'call-1',
      from: '1111',
      to: '2222',
      media: { audio: true, video: false },
    });
  });

  it('includes video in the offer when the call is video from the start', () => {
    const call = outgoing({ mediaType: 'video' });
    const { messages } = call.placeCall();
    expect(messages[0].media.video).toBe(true);
  });

  it('refuses to place a second call while already offering', () => {
    const call = outgoing();
    call.placeCall();
    const result = call.placeCall();
    expect(result.error).toMatch(/"offering"/);
  });

  it('refuses to place a call while ringing', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    expect(call.placeCall().error).toBeTruthy();
  });

  it('refuses to place a call after the call has ended', () => {
    const call = outgoing();
    call.placeCall();
    call.cancel();
    expect(call.placeCall().error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Receiving an incoming offer (idle → ringing)
// ---------------------------------------------------------------------------

describe('receiving an incoming offer', () => {
  it('transitions to ringing with no messages to send', () => {
    const call = outgoing();
    const { messages, error } = call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    expect(error).toBeUndefined();
    expect(call.state).toBe('ringing');
    expect(messages).toHaveLength(0);
  });

  it('records video correctly from the offer', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111', true));
    expect(call.media.video).toBe(true);
  });

  it('records audio-only correctly', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111', false));
    expect(call.media.video).toBe(false);
  });

  it('refuses a non-offer message', () => {
    const call = outgoing();
    expect(call.receiveOffer({ type: 'answer', callId: 'x' }).error).toBeTruthy();
  });

  it('refuses an offer after the call has ended', () => {
    const call = outgoing();
    call.placeCall();
    call.ringTimedOut();
    expect(call.receiveOffer(wireOffer('call-2', '2222', '1111')).error).toMatch(/ended/);
  });
});

// ---------------------------------------------------------------------------
// Answering (ringing → connecting)
// ---------------------------------------------------------------------------

describe('answering an incoming call', () => {
  it('transitions to connecting and returns an answer message', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    const { messages } = call.answer();
    expect(call.state).toBe('connecting');
    expect(messages[0]).toMatchObject({ type: 'answer', from: '1111', to: '2222' });
  });

  it('refuses to answer when not ringing', () => {
    expect(outgoing().answer().error).toMatch(/"idle"/);
  });

  it('refuses to answer when offering', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.answer().error).toMatch(/"offering"/);
  });
});

// ---------------------------------------------------------------------------
// Rejecting (ringing → ended)
// ---------------------------------------------------------------------------

describe('rejecting an incoming call', () => {
  it('transitions to ended with endReason rejected', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    const { messages } = call.reject();
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.rejected);
    expect(messages[0]).toMatchObject({ type: 'reject', from: '1111', to: '2222' });
  });

  it('refuses to reject when not ringing', () => {
    expect(outgoing().reject().error).toBeTruthy();
  });

  it('refuses to reject when offering — cancel() is the right call there', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.reject().error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Cancelling an outgoing call (offering → ended)
// ---------------------------------------------------------------------------

describe('cancelling an outgoing call', () => {
  it('transitions to ended and sends a hangup so the other end stops ringing', () => {
    const call = outgoing();
    call.placeCall();
    const { messages } = call.cancel();
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.cancelled);
    expect(messages[0]).toMatchObject({ type: 'hangup', from: '1111', to: '2222' });
  });

  it('refuses to cancel when idle', () => {
    expect(outgoing().cancel().error).toMatch(/"idle"/);
  });

  it('refuses to cancel when ringing — reject() is the right call there', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    expect(call.cancel().error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Connecting → active
// ---------------------------------------------------------------------------

describe('establishing the connection', () => {
  it('transitions from connecting to active', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    call.connectionEstablished();
    expect(call.state).toBe('active');
  });

  it('refuses to establish when not connecting', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.connectionEstablished().error).toMatch(/"offering"/);
  });

  it('refuses to establish when idle', () => {
    expect(outgoing().connectionEstablished().error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Hanging up (active or connecting → ended)
// ---------------------------------------------------------------------------

describe('hanging up', () => {
  it('transitions active to ended and sends a hangup message', () => {
    const call = makeActive();
    const { messages } = call.hangup();
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.normal);
    expect(messages[0]).toMatchObject({ type: 'hangup', from: '1111', to: '2222' });
  });

  it('can hang up during connecting before ICE completes', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    const { messages } = call.hangup();
    expect(call.state).toBe('ended');
    expect(messages[0].type).toBe('hangup');
  });

  it('refuses to hang up when idle', () => {
    expect(outgoing().hangup().error).toMatch(/"idle"/);
  });

  it('refuses to hang up when offering — cancel() is the right call', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.hangup().error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Ring timeout (offering or ringing → ended)
// ---------------------------------------------------------------------------

describe('ring timeout', () => {
  it('ends an outgoing call and sends a hangup to stop the other end ringing', () => {
    const call = outgoing();
    call.placeCall();
    const { messages } = call.ringTimedOut();
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.timeout);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('hangup');
  });

  it('ends an incoming call without sending any message — the caller will timeout separately', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    const { messages } = call.ringTimedOut();
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.timeout);
    expect(messages).toHaveLength(0);
  });

  it('refuses a ring timeout when the call is already active', () => {
    const call = makeActive();
    expect(call.ringTimedOut().error).toMatch(/not applicable/);
  });

  it('refuses a ring timeout when idle', () => {
    expect(outgoing().ringTimedOut().error).toMatch(/not applicable/);
  });
});

// ---------------------------------------------------------------------------
// Network drop (connecting or active → ended)
// ---------------------------------------------------------------------------

describe('network drop', () => {
  it('ends an active call without a message — the network is gone, nothing can be sent', () => {
    const call = makeActive();
    const { messages } = call.networkDropped();
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.dropped);
    expect(messages).toHaveLength(0);
  });

  it('ends a connecting call that lost the network before ICE completed', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    const result = call.networkDropped();
    expect(call.state).toBe('ended');
    expect(result.messages).toHaveLength(0);
  });

  it('refuses a network drop when idle', () => {
    expect(outgoing().networkDropped().error).toMatch(/not applicable/);
  });

  it('refuses a network drop when offering — the connection was never established', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.networkDropped().error).toMatch(/not applicable/);
  });
});

// ---------------------------------------------------------------------------
// Receiving an answer (offering → connecting)
// ---------------------------------------------------------------------------

describe('receiving an answer', () => {
  it('transitions from offering to connecting', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    expect(call.state).toBe('connecting');
  });

  it('refuses an answer when not offering', () => {
    const result = outgoing().receive(wireAnswer('call-1', '2222', '1111'));
    expect(result.error).toMatch(/"idle"/);
  });

  it('refuses an answer when already connecting', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    const result = call.receive(wireAnswer('call-1', '2222', '1111'));
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Receiving a reject (offering or ringing → ended)
// ---------------------------------------------------------------------------

describe('receiving a reject', () => {
  it('transitions from offering to ended with endReason rejected', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireReject('call-1', '2222', '1111', 'rejected'));
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.rejected);
  });

  it('records busy as the reason when the other end was already in a call', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireReject('call-1', '2222', '1111', 'busy'));
    expect(call.endReason).toBe(END_REASONS.busy);
  });

  it('refuses a reject when not in offering state — idle is not a valid state', () => {
    const result = outgoing().receive(wireReject('call-1', '2222', '1111'));
    expect(result.error).toBeTruthy();
  });

  it('refuses a reject when ringing — a callee never receives a reject, only a caller does', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    expect(call.state).toBe('ringing');
    const result = call.receive(wireReject('call-2', '2222', '1111', 'rejected'));
    expect(result.error).toBeTruthy();
    expect(call.state).toBe('ringing');
  });
});

// ---------------------------------------------------------------------------
// Receiving a hangup (active, connecting, ringing, offering → ended)
// ---------------------------------------------------------------------------

describe('receiving a hangup', () => {
  it('ends an active call from the other side with endReason normal', () => {
    const call = makeActive();
    call.receive(wireHangup('call-1', '2222', '1111'));
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.normal);
  });

  it('ends a ringing call when the caller withdraws — endReason is cancelled', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    call.receive(wireHangup('call-2', '2222', '1111'));
    expect(call.state).toBe('ended');
    expect(call.endReason).toBe(END_REASONS.cancelled);
  });

  it('refuses a hangup when already ended', () => {
    const call = makeActive();
    call.hangup();
    const result = call.receive(wireHangup('call-1', '2222', '1111'));
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ICE candidates
// ---------------------------------------------------------------------------

describe('ICE candidate delivery', () => {
  it('accepts ICE candidates when connecting', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    const result = call.receive(wireIce('call-1', '2222', '1111'));
    expect(result.error).toBeUndefined();
    expect(result.messages).toHaveLength(0);
  });

  it('accepts ICE candidates when active — trickle ICE may arrive late', () => {
    const call = makeActive();
    const result = call.receive(wireIce('call-1', '2222', '1111'));
    expect(result.error).toBeUndefined();
  });

  it('refuses ICE candidates when idle — they belong to an established call', () => {
    const result = outgoing().receive(wireIce('call-1', '2222', '1111'));
    expect(result.error).toBeTruthy();
  });

  it('refuses ICE candidates when offering — the answer has not arrived yet', () => {
    const call = outgoing();
    call.placeCall();
    const result = call.receive(wireIce('call-1', '2222', '1111'));
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Second call arriving while one is active
// ---------------------------------------------------------------------------

describe('a second call arriving while one is already active', () => {
  it('rejects the new offer with busy and stays active', () => {
    const call = makeActive();
    const { messages } = call.receiveOffer(wireOffer('call-99', '3333', '1111'));
    expect(call.state).toBe('active');
    expect(messages[0].type).toBe('reject');
    expect(messages[0].reason).toBe('busy');
    // The reject goes to the new caller, not the current Contact.
    expect(messages[0].to).toBe('3333');
  });

  it('rejects a second offer while still connecting', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    const { messages } = call.receiveOffer(wireOffer('call-99', '3333', '1111'));
    expect(call.state).toBe('connecting');
    expect(messages[0].reason).toBe('busy');
  });

  it('rejects a second offer from a different Contact while ringing', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    const { messages } = call.receiveOffer(wireOffer('call-99', '3333', '1111'));
    expect(call.state).toBe('ringing');
    expect(messages[0].reason).toBe('busy');
  });
});

// ---------------------------------------------------------------------------
// Glare resolution
// ---------------------------------------------------------------------------

describe('resolveGlare', () => {
  it('gives the win to the lower UIN', () => {
    expect(resolveGlare('1000', '9999')).toBe('win');
    expect(resolveGlare('9999', '1000')).toBe('lose');
  });

  it('is symmetric — swapping the arguments inverts the result', () => {
    const a = '12345';
    const b = '67890';
    const resultA = resolveGlare(a, b);
    const resultB = resolveGlare(b, a);
    expect(resultA).not.toBe(resultB);
    expect([resultA, resultB].sort()).toEqual(['lose', 'win']);
  });

  it('is deterministic for the same inputs', () => {
    const first = resolveGlare('99999', '11111');
    const second = resolveGlare('99999', '11111');
    expect(first).toBe(second);
  });

  it('falls back to lexicographic order for non-numeric UINs', () => {
    // Still deterministic and symmetric; just uses a different comparator.
    expect(resolveGlare('aaa', 'bbb')).toBe('win');
    expect(resolveGlare('bbb', 'aaa')).toBe('lose');
  });
});

describe('glare: the side with the lower UIN wins', () => {
  it('stays in offering and sends a reject for the incoming offer', () => {
    const call = createCall({ ownerUin: '1111', contactUin: '2222', callId: 'call-A' });
    call.placeCall();

    const { messages } = call.receiveOffer(wireOffer('call-B', '2222', '1111'));

    expect(call.state).toBe('offering');
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('reject');
    expect(messages[0].reason).toBe('glare');
    expect(messages[0].callId).toBe('call-B');
  });
});

describe('glare: the side with the higher UIN loses', () => {
  it('transitions to ringing and sends no immediate message', () => {
    const call = createCall({ ownerUin: '2222', contactUin: '1111', callId: 'call-B' });
    call.placeCall();

    const { messages, error } = call.receiveOffer(wireOffer('call-A', '1111', '2222'));

    expect(error).toBeUndefined();
    expect(call.state).toBe('ringing');
    expect(messages).toHaveLength(0);
  });

  it('answers with the winner\'s callId, not its own', () => {
    const call = createCall({ ownerUin: '2222', contactUin: '1111', callId: 'call-B' });
    call.placeCall();
    call.receiveOffer(wireOffer('call-A', '1111', '2222'));

    const { messages } = call.answer();

    expect(messages[0].type).toBe('answer');
    expect(messages[0].callId).toBe('call-A');
  });
});

describe('glare: both sides reach consistent but opposite conclusions', () => {
  it('winner stays offering, loser moves to ringing, and they agree which call survives', () => {
    const winner = createCall({ ownerUin: '1111', contactUin: '2222', callId: 'call-A' });
    const loser  = createCall({ ownerUin: '2222', contactUin: '1111', callId: 'call-B' });

    // Both place calls simultaneously.
    const winnerOffer = winner.placeCall().messages[0];
    const loserOffer  = loser.placeCall().messages[0];

    // Both receive each other's offers.
    const winnerResult = winner.receiveOffer(loserOffer);
    const loserResult  = loser.receiveOffer(winnerOffer);

    // Winner keeps its state and rejects the loser's offer.
    expect(winner.state).toBe('offering');
    expect(winnerResult.messages[0].type).toBe('reject');
    expect(winnerResult.messages[0].reason).toBe('glare');

    // Loser transitions to ringing with nothing to send yet.
    expect(loser.state).toBe('ringing');
    expect(loserResult.messages).toHaveLength(0);

    // The loser's answer uses the winner's callId so both sides track the
    // same call.
    const answerMsg = loser.answer().messages[0];
    expect(answerMsg.callId).toBe('call-A');
  });

  it('produces consistent results when the UINs are in the other order', () => {
    // Verify symmetry holds for both orderings, not just one.
    const callX = createCall({ ownerUin: '9000', contactUin: '1000', callId: 'call-X' });
    const callY = createCall({ ownerUin: '1000', contactUin: '9000', callId: 'call-Y' });

    const offerX = callX.placeCall().messages[0];
    const offerY = callY.placeCall().messages[0];

    callX.receiveOffer(offerY);
    callY.receiveOffer(offerX);

    // 1000 < 9000, so callY (owner 1000) wins and stays offering.
    expect(callY.state).toBe('offering');
    // callX (owner 9000) loses and becomes the callee.
    expect(callX.state).toBe('ringing');
  });

  it('the loser survives receiving the winner\'s glare-reject for the abandoned offer', () => {
    // This is the failure mode the original suite missed. After glare resolution
    // the winner sends a reject (reason="glare") for the loser's abandoned offer.
    // That message travels over the network and the application routes it to the
    // loser's state machine. The loser is now in "ringing" — it has adopted the
    // winner's callId and is waiting to answer. The reject is for the old callId;
    // it must be refused rather than causing the call to end prematurely.
    const winner = createCall({ ownerUin: '1111', contactUin: '2222', callId: 'call-A' });
    const loser  = createCall({ ownerUin: '2222', contactUin: '1111', callId: 'call-B' });

    const winnerOffer = winner.placeCall().messages[0];
    const loserOffer  = loser.placeCall().messages[0];

    const winnerResult = winner.receiveOffer(loserOffer);
    loser.receiveOffer(winnerOffer);

    expect(winner.state).toBe('offering');
    expect(loser.state).toBe('ringing');

    // The winner's reject for call-B (loser's abandoned offer) now reaches the loser.
    const glareReject = winnerResult.messages[0];
    expect(glareReject.type).toBe('reject');
    expect(glareReject.reason).toBe('glare');

    const loserResult = loser.receive(glareReject);
    // The loser must refuse it — ringing is not a valid state for receiving a reject.
    expect(loserResult.error).toBeTruthy();
    expect(loser.state).toBe('ringing'); // call survives

    // The loser can still answer normally.
    const answerResult = loser.answer();
    expect(answerResult.messages[0].type).toBe('answer');
    expect(answerResult.messages[0].callId).toBe('call-A');
    expect(loser.state).toBe('connecting');
  });
});

// ---------------------------------------------------------------------------
// Mute and camera state
// ---------------------------------------------------------------------------

describe('mute state', () => {
  it('announces mute to the other end and records the local state', () => {
    const call = makeActive();
    const { messages } = call.setMute(true);
    expect(call.local.muted).toBe(true);
    expect(messages[0]).toMatchObject({ type: 'mute', muted: true, from: '1111' });
  });

  it('announces unmute correctly', () => {
    const call = makeActive();
    call.setMute(true);
    const { messages } = call.setMute(false);
    expect(call.local.muted).toBe(false);
    expect(messages[0].muted).toBe(false);
  });

  it('reflects the other end\'s mute state on receipt', () => {
    const call = makeActive();
    call.receive(wireMute('call-1', '2222', '1111', true));
    expect(call.remote.muted).toBe(true);
  });

  it('refuses to change mute when not active', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.setMute(true).error).toMatch(/"offering"/);
  });
});

describe('camera state', () => {
  it('announces camera-off to the other end', () => {
    const call = makeActive();
    const { messages } = call.setCameraOff(true);
    expect(call.local.cameraOff).toBe(true);
    expect(messages[0]).toMatchObject({ type: 'camera', cameraOff: true, from: '1111' });
  });

  it('reflects the other end\'s camera state on receipt', () => {
    const call = makeActive();
    call.receive(wireCamera('call-1', '2222', '1111', true));
    expect(call.remote.cameraOff).toBe(true);
  });

  it('refuses to change camera state when not active', () => {
    expect(outgoing().setCameraOff(true).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Video upgrade during an audio call
// ---------------------------------------------------------------------------

describe('video upgrade', () => {
  function activeAudioCall() {
    return makeActive({ mediaType: 'audio' });
  }

  it('sends a media-change message to propose adding video', () => {
    const call = activeAudioCall();
    const { messages } = call.requestVideoUpgrade();
    expect(messages[0]).toMatchObject({ type: 'media-change', media: { audio: true, video: true } });
  });

  it('refuses to request video on a call that already has video', () => {
    const call = makeActive({ mediaType: 'video' });
    expect(call.requestVideoUpgrade().error).toMatch(/already/);
  });

  it('refuses to request a video upgrade when not active', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.requestVideoUpgrade().error).toBeTruthy();
  });

  it('enables video when the other end accepts the upgrade', () => {
    const call = activeAudioCall();
    call.requestVideoUpgrade();
    call.receive(wireMediaChangeResponse('call-1', '2222', '1111', true));
    expect(call.media.video).toBe(true);
  });

  it('keeps audio-only when the other end declines video', () => {
    const call = activeAudioCall();
    call.requestVideoUpgrade();
    call.receive(wireMediaChangeResponse('call-1', '2222', '1111', false));
    expect(call.media.video).toBe(false);
  });

  it('refuses a media-change-response when no upgrade was requested', () => {
    const call = activeAudioCall();
    const result = call.receive(wireMediaChangeResponse('call-1', '2222', '1111', true));
    expect(result.error).toMatch(/no upgrade was pending/);
  });

  it('lets the callee accept an incoming video upgrade and confirms acceptance', () => {
    const call = activeAudioCall();
    call.receive(wireMediaChange('call-1', '2222', '1111', true));
    const { messages } = call.acceptVideoUpgrade();
    expect(messages[0]).toMatchObject({ type: 'media-change-response', accepted: true });
    expect(call.media.video).toBe(true);
  });

  it('lets the callee decline the video while keeping audio', () => {
    const call = activeAudioCall();
    call.receive(wireMediaChange('call-1', '2222', '1111', true));
    const { messages } = call.declineVideoUpgrade();
    expect(messages[0]).toMatchObject({ type: 'media-change-response', accepted: false });
    expect(call.media.video).toBe(false);
  });

  it('refuses acceptVideoUpgrade when no request has arrived', () => {
    const call = activeAudioCall();
    expect(call.acceptVideoUpgrade().error).toBeTruthy();
  });

  it('refuses declineVideoUpgrade when no request has arrived', () => {
    const call = activeAudioCall();
    expect(call.declineVideoUpgrade().error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Signalling arriving in the wrong state is rejected
// ---------------------------------------------------------------------------

describe('signalling arriving in the wrong state', () => {
  it('refuses an answer when idle', () => {
    expect(outgoing().receive(wireAnswer('call-1', '2222', '1111')).error).toBeTruthy();
  });

  it('refuses an answer when ringing', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    expect(call.receive(wireAnswer('call-2', '2222', '1111')).error).toBeTruthy();
  });

  it('refuses an ICE candidate when idle', () => {
    expect(outgoing().receive(wireIce('call-1', '2222', '1111')).error).toBeTruthy();
  });

  it('refuses a mute announcement when offering', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.receive(wireMute('call-1', '2222', '1111', true)).error).toBeTruthy();
  });

  it('refuses a camera announcement when ringing', () => {
    const call = outgoing();
    call.receiveOffer(wireOffer('call-2', '2222', '1111'));
    expect(call.receive(wireCamera('call-2', '2222', '1111', true)).error).toBeTruthy();
  });

  it('refuses a media-change when connecting', () => {
    const call = outgoing();
    call.placeCall();
    call.receive(wireAnswer('call-1', '2222', '1111'));
    expect(call.receive(wireMediaChange('call-1', '2222', '1111', true)).error).toBeTruthy();
  });

  it('returns an error for a completely unknown message type', () => {
    const call = outgoing();
    call.placeCall();
    expect(call.receive({ type: 'magic-spell', callId: 'call-1' }).error).toMatch(/Unknown/);
  });

  it('returns an error for a message with no type field', () => {
    expect(outgoing().receive({ callId: 'call-1' }).error).toBeTruthy();
  });

  it('returns an error for a null message', () => {
    expect(outgoing().receive(null).error).toBeTruthy();
  });
});
