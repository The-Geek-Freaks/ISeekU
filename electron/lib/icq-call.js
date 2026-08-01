/**
 * Call signalling: the rules about when a call starts, how it progresses, and
 * how it ends — keeping WebRTC, network sockets, and timers entirely out so
 * the logic can be tested without hardware.
 *
 * The honest disclaimer first: "peer to peer, no relay" is only true for users
 * whose routers perform full-cone or port-restricted NAT, which is roughly
 * 70–80 % of home connections. A STUN server lets both ends discover their
 * public address and port; for most pairs that is enough to open a direct path.
 * The remaining 20–30 % sit behind symmetric NAT — every outgoing destination
 * gets a different external port, so the port a STUN server sees is not the
 * port the peer will actually reach. For those users the only working fallback
 * is a TURN relay: a server that forwards media on their behalf. TURN requires
 * someone to run the server and pay for the bandwidth. ISeekU does not
 * currently provide one, which means calls between two symmetric-NAT users
 * will fail at the ICE step despite this state machine completing normally.
 * That gap would need a self-hosted or third-party TURN server to close.
 *
 * The hardest correctness problem in call signalling is glare: both contacts
 * call each other at the same instant. Each sends an offer before the other's
 * arrives, so both land in the "offering" state with conflicting calls in
 * flight. The rule here is that the lower UIN's offer survives. Both sides run
 * exactly the same comparison independently and reach opposite but consistent
 * conclusions — the lower UIN stays in "offering", the higher UIN abandons its
 * own offer and answers the incoming one. No coordination message is needed;
 * the rule is deterministic (same inputs always produce the same result) and
 * symmetric (both sides use the same function, so they cannot disagree).
 *
 * Ring timeout is passed in as a duration that the application reads and uses
 * to set its own timer. When the timer fires the application calls
 * `ringTimedOut()`. The module never touches `setTimeout` or `Date.now()`,
 * which is what makes the timeout testable by calling the method directly.
 *
 * Signalling messages are plain serialisable objects. The `sdp` field in
 * offers and answers is left null here because WebRTC session description
 * lives outside the state machine; the transport layer fills it in before
 * sending and reads it back on receipt. ICE candidates are similarly
 * pass-through: the state machine validates timing and lets them through.
 */

'use strict';

/** All states the call machine can be in, in progression order. */
const STATES = Object.freeze(['idle', 'offering', 'ringing', 'connecting', 'active', 'ended']);

/** The valid media types a call can be created for. */
const MEDIA_TYPES = Object.freeze(['audio', 'video']);

/**
 * Why a call ended. Stored in `endReason` when state reaches "ended".
 *
 * rejected  — the callee explicitly refused with a reject message
 * cancelled — the caller withdrew (sent hangup) before the call was answered
 * timeout   — the ring timeout elapsed without an answer
 * dropped   — the network connection was lost after the call was established
 * normal    — one side sent a hangup after the call was active
 * busy      — the remote end was already in another call
 */
const END_REASONS = Object.freeze({
  rejected: 'rejected',
  cancelled: 'cancelled',
  timeout: 'timeout',
  dropped: 'dropped',
  normal: 'normal',
  busy: 'busy',
});

// ---------------------------------------------------------------------------
// Signalling message shapes
//
// Each function here both creates a message and documents its shape. The
// XMPP layer wraps these objects into stanzas; nothing in this file touches
// the wire.
// ---------------------------------------------------------------------------

/**
 * An offer initiates a call. sdp is null here; WebRTC fills it in before
 * sending and the state machine ignores it on receipt.
 *
 * Shape: { type, callId, from, to, media: { audio, video }, sdp }
 */
function makeOffer(callId, from, to, media) {
  return {
    type: 'offer',
    callId,
    from,
    to,
    media: { audio: !!media.audio, video: !!media.video },
    sdp: null,
  };
}

/**
 * An answer accepts an offer. Both sides move to connecting once sent and
 * received. sdp is null for the same reason as the offer.
 *
 * Shape: { type, callId, from, to, media: { audio, video }, sdp }
 */
function makeAnswer(callId, from, to, media) {
  return {
    type: 'answer',
    callId,
    from,
    to,
    media: { audio: !!media.audio, video: !!media.video },
    sdp: null,
  };
}

/**
 * An ICE candidate carries one possible connection path. The candidate object
 * is null here; WebRTC fills it in. The state machine only validates timing.
 *
 * Shape: { type, callId, from, to, candidate }
 */
function makeIceCandidate(callId, from, to, candidate) {
  return {
    type: 'ice-candidate',
    callId,
    from,
    to,
    candidate: candidate !== undefined ? candidate : null,
  };
}

/**
 * A reject refuses an offer outright. reason records why so the caller can
 * distinguish "busy" from "declined" from "glare". Audio and video are left
 * intact so the other end knows which call is being refused.
 *
 * Shape: { type, callId, from, to, reason }
 */
function makeReject(callId, from, to, reason) {
  return {
    type: 'reject',
    callId,
    from,
    to,
    reason: reason || 'rejected',
  };
}

/**
 * A hangup ends an active or connecting call cleanly. It is also sent by a
 * caller who cancels before the callee answers.
 *
 * Shape: { type, callId, from, to }
 */
function makeHangup(callId, from, to) {
  return { type: 'hangup', callId, from, to };
}

/**
 * A media-change proposes switching media tracks during an active call,
 * typically adding video to an audio-only call. The other end may decline the
 * video part with a media-change-response while leaving audio intact — that is
 * the point of making this a separate negotiation rather than a re-offer.
 *
 * Shape: { type, callId, from, to, media: { audio, video } }
 */
function makeMediaChange(callId, from, to, media) {
  return {
    type: 'media-change',
    callId,
    from,
    to,
    media: { audio: !!media.audio, video: !!media.video },
  };
}

/**
 * A media-change-response completes the video-upgrade negotiation. accepted
 * is a boolean; when false, the call continues with whatever tracks were
 * already open.
 *
 * Shape: { type, callId, from, to, accepted, media: { audio, video } }
 */
function makeMediaChangeResponse(callId, from, to, accepted, media) {
  return {
    type: 'media-change-response',
    callId,
    from,
    to,
    accepted: !!accepted,
    media: { audio: !!media.audio, video: !!media.video },
  };
}

/**
 * Mute state is announced so the other end can reflect it in the interface.
 * Without the announcement the remote side cannot know to grey out the
 * microphone icon or suppress a "why aren't you responding?" prompt.
 *
 * Shape: { type, callId, from, to, muted }
 */
function makeMuteAnnouncement(callId, from, to, muted) {
  return { type: 'mute', callId, from, to, muted: !!muted };
}

/**
 * Camera-off state follows the same pattern. It is meaningful only when video
 * is in use, but the message is harmless on an audio call — the other end
 * simply ignores it.
 *
 * Shape: { type, callId, from, to, cameraOff }
 */
function makeCameraAnnouncement(callId, from, to, cameraOff) {
  return { type: 'camera', callId, from, to, cameraOff: !!cameraOff };
}

// ---------------------------------------------------------------------------
// Glare resolution
// ---------------------------------------------------------------------------

/**
 * Decide which side wins when both have sent an offer simultaneously.
 *
 * Returns 'win' if our offer survives, 'lose' if we should abandon ours and
 * answer theirs. Both sides run this function with their own UIN as the first
 * argument and reach opposite conclusions; no third party is needed.
 *
 * ICQ UINs are numeric, so numeric comparison is used where possible. Strings
 * that are not valid integers fall back to lexicographic order — still
 * deterministic and symmetric, just using a different rule.
 */
function resolveGlare(ourUin, theirUin) {
  const ours = Number(ourUin);
  const theirs = Number(theirUin);
  if (Number.isFinite(ours) && Number.isFinite(theirs) && ours !== theirs) {
    return ours < theirs ? 'win' : 'lose';
  }
  // Non-numeric or (pathologically) equal: lexicographic order is still
  // deterministic. Equal UINs cannot happen in practice — you cannot call
  // yourself — but the function must still return something.
  return String(ourUin) <= String(theirUin) ? 'win' : 'lose';
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Create a call state machine for one call between ownerUin and contactUin.
 *
 * Options:
 *   ownerUin     — the Owner's UIN (string, required)
 *   contactUin   — the Contact's UIN (string, required)
 *   callId       — unique identifier for this call (string, required); for
 *                  outgoing calls the application generates it, for incoming
 *                  calls it comes from the offer message
 *   mediaType    — 'audio' (default) or 'video'
 *   ringTimeoutMs — how long to ring before considering it a timeout; the
 *                   application reads this, sets its own timer, and calls
 *                   ringTimedOut() when it fires (default 30 000 ms)
 *
 * All action methods return { messages } on success or { error } on refusal.
 * messages is an array of signalling objects ready to hand to the transport
 * layer; error is a string explaining why the action was refused.
 */
function createCall({
  ownerUin,
  contactUin,
  callId,
  mediaType = 'audio',
  ringTimeoutMs = 30000,
} = {}) {
  if (!ownerUin || typeof ownerUin !== 'string') {
    throw new Error('createCall requires ownerUin (non-empty string).');
  }
  if (!contactUin || typeof contactUin !== 'string') {
    throw new Error('createCall requires contactUin (non-empty string).');
  }
  if (!callId || typeof callId !== 'string') {
    throw new Error('createCall requires callId (non-empty string).');
  }
  if (!MEDIA_TYPES.includes(mediaType)) {
    throw new Error(`createCall mediaType must be one of: ${MEDIA_TYPES.join(', ')}.`);
  }

  let state = 'idle';
  let endReason = null;

  // media tracks currently in the call; may change during video upgrade
  let media = { audio: true, video: mediaType === 'video' };

  // local mute/camera state; also announced to the other end
  let local = { muted: false, cameraOff: false };

  // remote mute/camera state as last announced by the other end
  let remote = { muted: false, cameraOff: false };

  // The call ID used in outgoing messages. When we lose a glare collision we
  // adopt the winner's call ID so subsequent messages use the right reference.
  let activeCallId = callId;

  // The Contact UIN for the live call leg; updated from the offer on receipt
  // so that the callee's answer uses the right address even after glare.
  let activeContact = contactUin;

  // Whether we are waiting for the other end to respond to a video upgrade we
  // requested, or whether we have a pending incoming upgrade to accept/decline.
  let pendingVideoUpgrade = false;
  let incomingVideoRequest = false;

  // Helper constructors so every method uses consistent shapes.
  const ok = (messages = []) => ({ messages });
  const err = (message) => ({ error: message });

  function endCall(reason, messages = []) {
    state = 'ended';
    endReason = reason;
    return ok(messages);
  }

  // --- Incoming message handlers (internal, not exposed on the object) ---

  function receiveAnswer(/* msg */) {
    if (state !== 'offering') {
      return err(`Received an answer in state "${state}"; expected "offering".`);
    }
    state = 'connecting';
    return ok([]);
  }

  function receiveIceCandidate(/* msg */) {
    if (state !== 'connecting' && state !== 'active') {
      return err(
        `Received an ICE candidate in state "${state}"; `
        + 'candidates only make sense while connecting or active.',
      );
    }
    // Candidates are passed through to the WebRTC layer; the state machine
    // just confirms the timing is sane.
    return ok([]);
  }

  function receiveReject(msg) {
    if (state !== 'offering' && state !== 'ringing') {
      return err(`Received a reject in state "${state}"; it only makes sense while offering or ringing.`);
    }
    const reason = msg.reason === 'busy' ? END_REASONS.busy : END_REASONS.rejected;
    return endCall(reason, []);
  }

  function receiveHangup(/* msg */) {
    // A hangup arriving while we are offering means the other side also started
    // a call then gave up — treated as cancelled so the UI uses the right label.
    // A hangup while ringing means the caller withdrew before we answered.
    if (state === 'offering' || state === 'ringing') {
      return endCall(END_REASONS.cancelled, []);
    }
    if (state === 'active' || state === 'connecting') {
      return endCall(END_REASONS.normal, []);
    }
    return err(`Received a hangup in state "${state}"; nothing to end.`);
  }

  function receiveMediaChange(msg) {
    if (state !== 'active') {
      return err(`Received a media-change in state "${state}"; only valid when active.`);
    }
    if (msg.media && msg.media.video && !media.video) {
      // The other end wants to add video. Record the request; the application
      // must call acceptVideoUpgrade() or declineVideoUpgrade() in response.
      incomingVideoRequest = true;
    } else if (msg.media && !msg.media.video && media.video) {
      // The other end is removing video from their side; honour it immediately.
      media = { ...media, video: false };
    }
    return ok([]);
  }

  function receiveMediaChangeResponse(msg) {
    if (!pendingVideoUpgrade) {
      return err('Received a media-change-response but no upgrade was pending.');
    }
    pendingVideoUpgrade = false;
    if (msg.accepted) {
      media = { ...media, video: true };
    }
    return ok([]);
  }

  function receiveMute(msg) {
    if (state !== 'active' && state !== 'connecting') {
      return err(`Received a mute announcement in state "${state}".`);
    }
    remote = { ...remote, muted: !!msg.muted };
    return ok([]);
  }

  function receiveCamera(msg) {
    if (state !== 'active' && state !== 'connecting') {
      return err(`Received a camera announcement in state "${state}".`);
    }
    remote = { ...remote, cameraOff: !!msg.cameraOff };
    return ok([]);
  }

  // --- Public machine object ---

  return {
    get state() { return state; },
    get endReason() { return endReason; },
    get media() { return { ...media }; },
    get local() { return { ...local }; },
    get remote() { return { ...remote }; },
    get callId() { return activeCallId; },
    get ownerUin() { return ownerUin; },
    get contactUin() { return activeContact; },
    get ringTimeoutMs() { return ringTimeoutMs; },

    /**
     * Place a call: idle → offering. Returns the offer message to send.
     */
    placeCall() {
      if (state !== 'idle') return err(`Cannot place a call in state "${state}".`);
      state = 'offering';
      return ok([makeOffer(activeCallId, ownerUin, activeContact, media)]);
    },

    /**
     * Handle an incoming offer.
     *
     * From idle: normal incoming call, transition to ringing.
     * From offering (same Contact): glare — lower UIN keeps its offer, higher
     *   UIN abandons its own and becomes the callee for the incoming one.
     * From any busy state: reject with 'busy' and remain in the current state.
     */
    receiveOffer(msg) {
      if (!msg || msg.type !== 'offer') {
        return err('receiveOffer expects a message of type "offer".');
      }
      if (state === 'ended') {
        return err('Cannot receive an offer after the call has ended.');
      }
      if (state === 'active' || state === 'connecting' || state === 'ringing') {
        return ok([makeReject(msg.callId, ownerUin, msg.from, 'busy')]);
      }
      if (state === 'offering') {
        // We were calling someone; now we received an offer.
        if (msg.from !== activeContact) {
          // A completely different Contact called while we were calling someone
          // else — that is a "busy" scenario, not glare.
          return ok([makeReject(msg.callId, ownerUin, msg.from, 'busy')]);
        }
        // Glare: the same Contact we are calling is also calling us.
        const outcome = resolveGlare(ownerUin, msg.from);
        if (outcome === 'win') {
          // Our offer survives; politely refuse theirs so they stop waiting.
          return ok([makeReject(msg.callId, ownerUin, msg.from, 'glare')]);
        } else {
          // Their offer wins. We drop our own and become the callee. The
          // answer() call that follows must use the winner's call ID, so we
          // adopt it here.
          activeCallId = msg.callId;
          media = { audio: true, video: !!(msg.media && msg.media.video) };
          state = 'ringing';
          return ok([]);
        }
      }
      // state === 'idle': straightforward incoming call.
      activeContact = msg.from;
      activeCallId = msg.callId;
      media = { audio: true, video: !!(msg.media && msg.media.video) };
      state = 'ringing';
      return ok([]);
    },

    /**
     * Answer the incoming call: ringing → connecting. Returns the answer.
     */
    answer() {
      if (state !== 'ringing') return err(`Cannot answer in state "${state}".`);
      state = 'connecting';
      return ok([makeAnswer(activeCallId, ownerUin, activeContact, media)]);
    },

    /**
     * Reject the incoming call: ringing → ended. Returns the reject message.
     */
    reject(reason = 'rejected') {
      if (state !== 'ringing') return err(`Cannot reject in state "${state}".`);
      return endCall(END_REASONS.rejected, [makeReject(activeCallId, ownerUin, activeContact, reason)]);
    },

    /**
     * Cancel an outgoing call before the other end answers: offering → ended.
     * Sends a hangup so the other end stops ringing.
     */
    cancel() {
      if (state !== 'offering') return err(`Cannot cancel in state "${state}".`);
      return endCall(END_REASONS.cancelled, [makeHangup(activeCallId, ownerUin, activeContact)]);
    },

    /**
     * Signal that the WebRTC connection is now established: connecting → active.
     * Called by the application when the ICE connection event fires.
     */
    connectionEstablished() {
      if (state !== 'connecting') {
        return err(`Cannot establish connection in state "${state}".`);
      }
      state = 'active';
      return ok([]);
    },

    /**
     * Hang up: active or connecting → ended. Returns the hangup message.
     * Hanging up during connecting is valid — the user may give up waiting for
     * ICE to complete.
     */
    hangup() {
      if (state !== 'active' && state !== 'connecting') {
        return err(`Cannot hang up in state "${state}".`);
      }
      return endCall(END_REASONS.normal, [makeHangup(activeCallId, ownerUin, activeContact)]);
    },

    /**
     * Ring timeout elapsed. Called by the application when the timer it set
     * from ringTimeoutMs fires.
     *
     * From offering: we were the caller; send a hangup so the other end stops
     * ringing. From ringing: we were the callee; no message needed — the
     * caller's own ring timeout will send a hangup shortly.
     */
    ringTimedOut() {
      if (state !== 'offering' && state !== 'ringing') {
        return err(`Ring timeout is not applicable in state "${state}".`);
      }
      const messages = state === 'offering'
        ? [makeHangup(activeCallId, ownerUin, activeContact)]
        : [];
      return endCall(END_REASONS.timeout, messages);
    },

    /**
     * Network connection lost: connecting or active → ended. No message can be
     * sent because the connection is already gone.
     */
    networkDropped() {
      if (state !== 'connecting' && state !== 'active') {
        return err(`Network drop is not applicable in state "${state}".`);
      }
      return endCall(END_REASONS.dropped, []);
    },

    /**
     * Dispatch an incoming signalling message to the right handler.
     * Returns { messages } or { error }.
     */
    receive(msg) {
      if (!msg || typeof msg.type !== 'string') {
        return err('Received a signalling message with no type field.');
      }
      switch (msg.type) {
        case 'offer':                 return this.receiveOffer(msg);
        case 'answer':                return receiveAnswer(msg);
        case 'ice-candidate':         return receiveIceCandidate(msg);
        case 'reject':                return receiveReject(msg);
        case 'hangup':                return receiveHangup(msg);
        case 'media-change':          return receiveMediaChange(msg);
        case 'media-change-response': return receiveMediaChangeResponse(msg);
        case 'mute':                  return receiveMute(msg);
        case 'camera':                return receiveCamera(msg);
        default:
          return err(`Unknown signalling message type: "${msg.type}".`);
      }
    },

    /**
     * Set the Owner's local mute state and announce it to the other end.
     * Only valid when the call is active.
     */
    setMute(muted) {
      if (state !== 'active') return err(`Cannot change mute state in state "${state}".`);
      local = { ...local, muted: !!muted };
      return ok([makeMuteAnnouncement(activeCallId, ownerUin, activeContact, muted)]);
    },

    /**
     * Set the Owner's local camera state and announce it. Valid when active
     * regardless of whether video is in use, because the announcement is
     * harmless and sending it consistently simplifies the other end's logic.
     */
    setCameraOff(off) {
      if (state !== 'active') return err(`Cannot change camera state in state "${state}".`);
      local = { ...local, cameraOff: !!off };
      return ok([makeCameraAnnouncement(activeCallId, ownerUin, activeContact, off)]);
    },

    /**
     * Request a video upgrade on an active audio-only call. The other end may
     * accept or decline with a media-change-response; declining leaves the
     * audio call intact.
     */
    requestVideoUpgrade() {
      if (state !== 'active') return err(`Cannot request a video upgrade in state "${state}".`);
      if (media.video) return err('The call already includes video.');
      pendingVideoUpgrade = true;
      return ok([makeMediaChange(activeCallId, ownerUin, activeContact, { audio: true, video: true })]);
    },

    /**
     * Accept a video upgrade request that arrived via media-change. Enables
     * video on this end and confirms acceptance to the other end.
     */
    acceptVideoUpgrade() {
      if (!incomingVideoRequest) {
        return err('There is no pending video upgrade request to accept.');
      }
      incomingVideoRequest = false;
      media = { ...media, video: true };
      return ok([makeMediaChangeResponse(
        activeCallId, ownerUin, activeContact, true, { audio: true, video: true },
      )]);
    },

    /**
     * Decline a video upgrade request. The audio call continues; the other
     * end's video track is not opened.
     */
    declineVideoUpgrade() {
      if (!incomingVideoRequest) {
        return err('There is no pending video upgrade request to decline.');
      }
      incomingVideoRequest = false;
      return ok([makeMediaChangeResponse(
        activeCallId, ownerUin, activeContact, false, { audio: true, video: false },
      )]);
    },
  };
}

module.exports = {
  createCall,
  resolveGlare,
  makeOffer,
  makeAnswer,
  makeIceCandidate,
  makeReject,
  makeHangup,
  makeMediaChange,
  makeMediaChangeResponse,
  makeMuteAnnouncement,
  makeCameraAnnouncement,
  END_REASONS,
  STATES,
};
