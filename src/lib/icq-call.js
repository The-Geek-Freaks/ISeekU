/**
 * Call signalling state machine — renderer-process copy.
 *
 * The authoritative source is electron/lib/icq-call.js (CommonJS, used by the
 * main process and its Jest suite). CRA's webpack ModuleScopePlugin blocks
 * imports whose resolved path falls outside src/, so this file provides the
 * same logic as an ES module that webpack can bundle.
 *
 * KEEP THIS FILE IN SYNC WITH electron/lib/icq-call.js.
 * Only the module format differs (ES export vs module.exports). All logic,
 * all comments, and every exported name must remain identical.
 *
 * See electron/lib/icq-call.js for the full rationale: glare resolution,
 * ring-timeout design, TURN disclaimer, and signalling-message shapes.
 */

/** All states the call machine can be in, in progression order. */
export const STATES = Object.freeze(['idle', 'offering', 'ringing', 'connecting', 'active', 'ended']);

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
export const END_REASONS = Object.freeze({
  rejected: 'rejected',
  cancelled: 'cancelled',
  timeout: 'timeout',
  dropped: 'dropped',
  normal: 'normal',
  busy: 'busy',
});

// ---------------------------------------------------------------------------
// Signalling message shapes
// ---------------------------------------------------------------------------

/** Shape: { type, callId, from, to, media: { audio, video }, sdp } */
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

/** Shape: { type, callId, from, to, media: { audio, video }, sdp } */
export function makeAnswer(callId, from, to, media) {
  return {
    type: 'answer',
    callId,
    from,
    to,
    media: { audio: !!media.audio, video: !!media.video },
    sdp: null,
  };
}

/** Shape: { type, callId, from, to, candidate } */
export function makeIceCandidate(callId, from, to, candidate) {
  return {
    type: 'ice-candidate',
    callId,
    from,
    to,
    candidate: candidate !== undefined ? candidate : null,
  };
}

/** Shape: { type, callId, from, to, reason } */
export function makeReject(callId, from, to, reason) {
  return {
    type: 'reject',
    callId,
    from,
    to,
    reason: reason || 'rejected',
  };
}

/** Shape: { type, callId, from, to } */
export function makeHangup(callId, from, to) {
  return { type: 'hangup', callId, from, to };
}

/** Shape: { type, callId, from, to, media: { audio, video } } */
export function makeMediaChange(callId, from, to, media) {
  return {
    type: 'media-change',
    callId,
    from,
    to,
    media: { audio: !!media.audio, video: !!media.video },
  };
}

/** Shape: { type, callId, from, to, accepted, media: { audio, video } } */
export function makeMediaChangeResponse(callId, from, to, accepted, media) {
  return {
    type: 'media-change-response',
    callId,
    from,
    to,
    accepted: !!accepted,
    media: { audio: !!media.audio, video: !!media.video },
  };
}

/** Shape: { type, callId, from, to, muted } */
export function makeMuteAnnouncement(callId, from, to, muted) {
  return { type: 'mute', callId, from, to, muted: !!muted };
}

/** Shape: { type, callId, from, to, cameraOff } */
export function makeCameraAnnouncement(callId, from, to, cameraOff) {
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
export function resolveGlare(ourUin, theirUin) {
  const ours = Number(ourUin);
  const theirs = Number(theirUin);
  if (Number.isFinite(ours) && Number.isFinite(theirs) && ours !== theirs) {
    return ours < theirs ? 'win' : 'lose';
  }
  return String(ourUin) <= String(theirUin) ? 'win' : 'lose';
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Create a call state machine for one call between ownerUin and contactUin.
 *
 * Options:
 *   ownerUin      — the Owner's UIN (string, required)
 *   contactUin    — the Contact's UIN (string, required)
 *   callId        — unique identifier for this call (string, required)
 *   mediaType     — 'audio' (default) or 'video'
 *   ringTimeoutMs — duration the application reads to set its own timer;
 *                   when it fires, call ringTimedOut() (default 30 000 ms)
 *
 * All action methods return { messages } on success or { error } on refusal.
 */
export function createCall({
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

  let media = { audio: true, video: mediaType === 'video' };
  let local = { muted: false, cameraOff: false };
  let remote = { muted: false, cameraOff: false };
  let activeCallId = callId;
  let activeContact = contactUin;
  let pendingVideoUpgrade = false;
  let incomingVideoRequest = false;

  const ok = (messages = []) => ({ messages });
  const err = (message) => ({ error: message });

  function endCall(reason, messages = []) {
    state = 'ended';
    endReason = reason;
    return ok(messages);
  }

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
    return ok([]);
  }

  function receiveReject(msg) {
    if (state !== 'offering') {
      return err(`Received a reject in state "${state}"; it only makes sense while offering.`);
    }
    const reason = msg.reason === 'busy' ? END_REASONS.busy : END_REASONS.rejected;
    return endCall(reason, []);
  }

  function receiveHangup(/* msg */) {
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
      incomingVideoRequest = true;
    } else if (msg.media && !msg.media.video && media.video) {
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

    /** Place a call: idle → offering. Returns the offer message to send. */
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
        if (msg.from !== activeContact) {
          return ok([makeReject(msg.callId, ownerUin, msg.from, 'busy')]);
        }
        const outcome = resolveGlare(ownerUin, msg.from);
        if (outcome === 'win') {
          return ok([makeReject(msg.callId, ownerUin, msg.from, 'glare')]);
        } else {
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

    /** Answer the incoming call: ringing → connecting. Returns the answer. */
    answer() {
      if (state !== 'ringing') return err(`Cannot answer in state "${state}".`);
      state = 'connecting';
      return ok([makeAnswer(activeCallId, ownerUin, activeContact, media)]);
    },

    /** Reject the incoming call: ringing → ended. Returns the reject message. */
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

    /** Dispatch an incoming signalling message to the right handler. */
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
     * regardless of whether video is in use.
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
