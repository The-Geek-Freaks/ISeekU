/**
 * Audio and video call panel for ICQ 1-to-1 chats.
 *
 * Every state transition goes through the icq-call.js state machine. This
 * component renders state — it does not decide it. The machine lives in a ref
 * because we never want a stale closure touching it; the ref is always current.
 *
 * Signal wire types carry the 'call-' prefix as declared in icq-signal.js
 * CALL_TYPES. The machine's internal types do not. The two translation maps
 * below are the only place that mapping lives; nothing else in this file deals
 * with wire names.
 *
 * getUserMedia and RTCPeerConnection are available here because this file lives
 * in the renderer (Chromium). Signalling crosses to the main process via
 * window.api.icq.sendSignal / onSignal — the same bridge the game sessions use.
 *
 * Glare (both ends dialling at once) is resolved inside icq-call.js by
 * comparing UINs. The component simply reads the machine's state after
 * receiveOffer() and reacts accordingly: if the machine stayed in 'offering'
 * the Owner won; if it moved to 'ringing' the Owner lost and is now the callee.
 *
 * icq-p2p.js uses require('crypto') and cannot be imported from the renderer.
 * icq-call.js has no Node built-ins, so it lives in src/lib/icq-call.js as an
 * ES module that webpack can bundle without modification.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
// icq-call.js has no Node built-ins and is pure logic. CRA's ModuleScopePlugin
// blocks imports from outside src/, so src/lib/icq-call.js provides the same
// module as an ES module that webpack can bundle. electron/lib/icq-call.js
// remains the canonical CJS source used by the main process.
import { createCall } from '../../lib/icq-call';
import { createPeerConnection, iceConfiguration } from '../../peerConnection';
import './CallPanel.css';

// ── Type translation ─────────────────────────────────────────────────────────

/** Map the wire signal type (call-*) to the machine's internal type. */
const WIRE_TO_INTERNAL = {
  'call-offer':                 'offer',
  'call-answer':                'answer',
  'call-ice':                   'ice-candidate',
  'call-reject':                'reject',
  'call-hangup':                'hangup',
  'call-media-change':          'media-change',
  'call-media-change-response': 'media-change-response',
  'call-mute':                  'mute',
  'call-camera':                'camera',
};

/** Map the machine's internal type back to the wire signal type. */
const INTERNAL_TO_WIRE = {
  'offer':                  'call-offer',
  'answer':                 'call-answer',
  'ice-candidate':          'call-ice',
  'reject':                 'call-reject',
  'hangup':                 'call-hangup',
  'media-change':           'call-media-change',
  'media-change-response':  'call-media-change-response',
  'mute':                   'call-mute',
  'camera':                 'call-camera',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The local-part of a JID is the UIN. */
function uinFromJid(jid) {
  return typeof jid === 'string' ? jid.split('@')[0] : '';
}

/** Strip the resource from a full JID before comparing against a stored bare JID. */
function bareJid(jid) {
  return typeof jid === 'string' ? jid.split('/')[0] : '';
}

/** A unique call identifier. Not cryptographically strong, but unique enough
 *  for call tracking within a session. */
function newCallId() {
  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Owns the full lifecycle of one audio or video call.
 *
 * Props:
 *   jid                 — bare JID of the Contact (e.g. "123456@icq.im")
 *   contactName         — display name for the Contact
 *   initiateCall        — null normally; 'audio' or 'video' to place a call
 *   onInitiateCallClear — called once the call has been initiated so the parent
 *                         can reset initiateCall to null
 *   iceConfig           — optional RTCConfiguration; defaults to STUN-only
 */
export default function CallPanel({
  jid,
  contactName = 'Contact',
  initiateCall = null,
  onInitiateCallClear,
  iceConfig,
}) {
  const [ownerUin, setOwnerUin] = useState(null);

  // Mirror of the machine state, for rendering decisions only.
  const [phase, setPhase] = useState('idle');
  // 'idle' | 'offering' | 'ringing' | 'connecting' | 'active' | 'ended'

  const [callMediaType, setCallMediaType] = useState('audio');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteCameraOff, setRemoteCameraOff] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [endReason, setEndReason] = useState(null);
  const [hasIncomingVideoRequest, setHasIncomingVideoRequest] = useState(false);

  const machineRef    = useRef(null);
  const peerConnRef   = useRef(null);
  const localStreamRef  = useRef(null);
  const remoteSdpRef  = useRef(null); // stored until accept()
  const ringTimerRef  = useRef(null);
  const endTimerRef   = useRef(null);
  const localVideoRef  = useRef(null);
  const remoteMediaRef = useRef(null);
  const signalHandlerRef = useRef(null);

  const contactUin = uinFromJid(jid);

  // Fetch the Owner's UIN once — the ICQ connection must already be open for
  // the call buttons to be reachable, so this should resolve quickly.
  useEffect(() => {
    window.api?.icq?.getStatus?.()
      .then((status) => {
        if (status?.account?.uin) setOwnerUin(String(status.account.uin));
      })
      .catch(() => {});
  }, []);

  // ── Core helpers ───────────────────────────────────────────────────────────

  /**
   * Send machine-generated messages to the Contact.
   *
   * The machine uses internal types ('reject', 'hangup', 'mute', …); the signal
   * channel expects wire types ('call-reject', 'call-hangup', 'call-mute', …).
   * Offer and answer are NOT sent through here — they need the SDP attached
   * before sending, which happens at the call site.
   */
  const sendMessages = useCallback((messages) => {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
      const wireType = INTERNAL_TO_WIRE[msg.type];
      if (!wireType) continue;
      window.api?.icq?.sendSignal?.(jid, { ...msg, type: wireType });
    }
  }, [jid]);

  /** Release all call resources: connection, streams, timers, video elements. */
  const resetCall = useCallback(() => {
    clearTimeout(ringTimerRef.current);
    ringTimerRef.current = null;

    if (peerConnRef.current) {
      peerConnRef.current.close();
      peerConnRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteMediaRef.current) remoteMediaRef.current.srcObject = null;

    machineRef.current = null;
    remoteSdpRef.current = null;
  }, []);

  /**
   * Move to 'ended' briefly, then back to 'idle'.
   *
   * The delay is intentional: a call that disappeared without any visible
   * feedback looks like a crash. Two and a half seconds is enough to read the
   * reason but short enough not to feel like a hang.
   */
  const handleCallEnded = useCallback((reason) => {
    setEndReason(reason || null);
    setPhase('ended');
    resetCall();

    clearTimeout(endTimerRef.current);
    endTimerRef.current = setTimeout(() => {
      setPhase('idle');
      setEndReason(null);
      setIsMuted(false);
      setIsCameraOff(false);
      setRemoteMuted(false);
      setRemoteCameraOff(false);
      setHasVideo(false);
      setHasIncomingVideoRequest(false);
    }, 2500);
  }, [resetCall]);

  /** Start the ring timer using the machine's own timeout. */
  const startRingTimer = useCallback(() => {
    const machine = machineRef.current;
    if (!machine) return;
    clearTimeout(ringTimerRef.current);
    ringTimerRef.current = setTimeout(() => {
      const result = machine.ringTimedOut();
      if (result.messages) sendMessages(result.messages);
      handleCallEnded(machine.endReason || 'timeout');
    }, machine.ringTimeoutMs);
  }, [sendMessages, handleCallEnded]);

  /**
   * Acquire local media and create the peer connection.
   *
   * caller=true for the Owner placing the call, caller=false for the answerer.
   * Returns the peer connection on success, null on getUserMedia failure.
   */
  const acquireMediaAndConnect = useCallback(async (withVideo, caller) => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: withVideo,
      });
    } catch {
      return null;
    }

    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const pc = createPeerConnection({
      contactJid: jid,
      caller,
      iceConfig: iceConfig || iceConfiguration(),
      // peerConnection.js fires ICE candidates directly via this callback.
      sendSignal: (payload) => window.api?.icq?.sendSignal?.(jid, payload),
    });

    // Add local tracks before offer/answer so they appear in the SDP.
    stream.getTracks().forEach((track) => pc.raw.addTrack(track, stream));

    pc.on('onTrack', (event) => {
      if (remoteMediaRef.current && event.streams && event.streams[0]) {
        remoteMediaRef.current.srcObject = event.streams[0];
      }
    });

    pc.on('onStateChange', (state) => {
      const machine = machineRef.current;
      if ((state === 'connected' || state === 'completed') && machine && machine.state === 'connecting') {
        const result = machine.connectionEstablished();
        if (!result.error) setPhase('active');
      }
      if ((state === 'failed' || state === 'disconnected') && machine) {
        machine.networkDropped();
        handleCallEnded('dropped');
      }
    });

    peerConnRef.current = pc;
    return pc;
  }, [jid, iceConfig, handleCallEnded]);

  // ── Owner-initiated actions ────────────────────────────────────────────────

  /** Place an outgoing call. Direction: idle → offering. */
  const startCall = useCallback(async (mediaType) => {
    if (!ownerUin || phase !== 'idle') return;

    const callId = newCallId();
    const machine = createCall({ ownerUin, contactUin, callId, mediaType });
    machineRef.current = machine;

    const placeResult = machine.placeCall();
    if (placeResult.error) { machineRef.current = null; return; }

    const [offerMsg] = placeResult.messages;
    const withVideo = mediaType === 'video';

    setCallMediaType(mediaType);
    setHasVideo(withVideo);
    setPhase('offering');

    const pc = await acquireMediaAndConnect(withVideo, true);
    if (!pc) {
      machine.cancel();
      machineRef.current = null;
      setPhase('idle');
      return;
    }

    const { sdp, error } = await pc.start();
    if (error) {
      machine.cancel();
      handleCallEnded('dropped');
      return;
    }

    // Send the offer with the real SDP; the machine left sdp: null.
    window.api?.icq?.sendSignal?.(jid, { ...offerMsg, type: 'call-offer', sdp });

    startRingTimer();
  }, [ownerUin, contactUin, phase, jid, acquireMediaAndConnect, startRingTimer, handleCallEnded]);

  /** Accept an incoming call. Direction: ringing → connecting. */
  const acceptCall = useCallback(async () => {
    const machine = machineRef.current;
    if (!machine || machine.state !== 'ringing') return;

    clearTimeout(ringTimerRef.current);
    ringTimerRef.current = null;

    const withVideo = machine.media.video;
    setHasVideo(withVideo);

    const pc = await acquireMediaAndConnect(withVideo, false);
    if (!pc) {
      const result = machine.reject();
      if (result.messages) sendMessages(result.messages);
      machineRef.current = null;
      setPhase('idle');
      return;
    }

    // Set the caller's SDP and produce our answer.
    const { sdp, error } = await pc.accept(remoteSdpRef.current);
    if (error) { handleCallEnded('dropped'); return; }

    const answerResult = machine.answer();
    if (answerResult.error) return;

    const [answerMsg] = answerResult.messages;
    window.api?.icq?.sendSignal?.(jid, { ...answerMsg, type: 'call-answer', sdp });

    setPhase('connecting');
  }, [jid, acquireMediaAndConnect, sendMessages, handleCallEnded]);

  /** Reject an incoming call. Direction: ringing → idle. */
  const rejectCall = useCallback(() => {
    const machine = machineRef.current;
    if (!machine || machine.state !== 'ringing') return;

    clearTimeout(ringTimerRef.current);
    ringTimerRef.current = null;

    const result = machine.reject();
    if (result.messages) sendMessages(result.messages);

    resetCall();
    setPhase('idle');
  }, [sendMessages, resetCall]);

  /** Hang up or cancel the call. Valid from active, connecting, or offering. */
  const hangup = useCallback(() => {
    const machine = machineRef.current;
    if (!machine) return;

    const result = machine.state === 'offering' ? machine.cancel() : machine.hangup();
    if (result.messages) sendMessages(result.messages);

    handleCallEnded(machine.endReason || 'normal');
  }, [sendMessages, handleCallEnded]);

  /** Toggle local mute and announce it to the far end. */
  const toggleMute = useCallback(() => {
    const machine = machineRef.current;
    if (!machine || machine.state !== 'active') return;

    const next = !isMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !next; });
    }
    const result = machine.setMute(next);
    if (result.messages) sendMessages(result.messages);
    setIsMuted(next);
  }, [isMuted, sendMessages]);

  /** Toggle local camera and announce it to the far end. */
  const toggleCamera = useCallback(() => {
    const machine = machineRef.current;
    if (!machine || machine.state !== 'active') return;

    const next = !isCameraOff;
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => { t.enabled = !next; });
    }
    const result = machine.setCameraOff(next);
    if (result.messages) sendMessages(result.messages);
    setIsCameraOff(next);
  }, [isCameraOff, sendMessages]);

  /** Request video on an audio-only call. The far end may decline. */
  const requestVideoUpgrade = useCallback(async () => {
    const machine = machineRef.current;
    if (!machine || machine.state !== 'active' || hasVideo) return;

    let videoStream;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch { return; }

    if (peerConnRef.current && localStreamRef.current) {
      const [videoTrack] = videoStream.getVideoTracks();
      if (videoTrack) {
        peerConnRef.current.raw.addTrack(videoTrack, localStreamRef.current);
        localStreamRef.current.addTrack(videoTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      }
    }

    const result = machine.requestVideoUpgrade();
    if (result.messages) sendMessages(result.messages);
  }, [hasVideo, sendMessages]);

  /** Accept a video upgrade the far end proposed. */
  const acceptVideoUpgrade = useCallback(() => {
    const machine = machineRef.current;
    if (!machine) return;
    const result = machine.acceptVideoUpgrade();
    if (result.error) return;
    if (result.messages) sendMessages(result.messages);
    setHasVideo(true);
    setHasIncomingVideoRequest(false);
  }, [sendMessages]);

  /** Decline a video upgrade the far end proposed; audio call continues. */
  const declineVideoUpgrade = useCallback(() => {
    const machine = machineRef.current;
    if (!machine) return;
    const result = machine.declineVideoUpgrade();
    if (result.error) return;
    if (result.messages) sendMessages(result.messages);
    setHasIncomingVideoRequest(false);
  }, [sendMessages]);

  // ── Inbound signal handler ────────────────────────────────────────────────

  // Re-assigned each render so the handler always closes over the latest state.
  // The registered listener calls through this ref, so one registration covers
  // the entire lifetime of this jid.
  signalHandlerRef.current = async ({ signal, from, family }) => {
    if (family !== 'call') return;
    if (bareJid(from) !== jid) return;

    const internalType = WIRE_TO_INTERNAL[signal.type];
    if (!internalType) return;

    // The machine compares msg.from against the stored contactUin (a bare UIN
    // such as '200'), but signals carry a full JID ('200@icq.im'). Normalise
    // to a bare UIN so glare detection and routing work correctly.
    const senderUin = uinFromJid(bareJid(from));
    const internalMsg = { ...signal, type: internalType, from: senderUin || from };
    const machine = machineRef.current;

    // ── ICE candidates bypass the machine state check ───────────────────────
    // The machine validates timing but the candidate goes straight to WebRTC.
    if (internalType === 'ice-candidate') {
      if (machine) machine.receive(internalMsg);
      if (peerConnRef.current && signal.candidate) {
        peerConnRef.current.addCandidate(signal.candidate);
      }
      return;
    }

    // ── Incoming call offer ─────────────────────────────────────────────────
    if (internalType === 'offer') {
      remoteSdpRef.current = signal.sdp || null;

      if (!machine) {
        // Fresh incoming call — we have no machine yet.
        if (!ownerUin) return;
        const newMachine = createCall({
          ownerUin,
          contactUin,
          callId: signal.callId || newCallId(),
          mediaType: (signal.media && signal.media.video) ? 'video' : 'audio',
        });
        machineRef.current = newMachine;
        const result = newMachine.receiveOffer(internalMsg);
        if (result.messages) sendMessages(result.messages);

        if (newMachine.state === 'ringing') {
          setCallMediaType((signal.media && signal.media.video) ? 'video' : 'audio');
          setPhase('ringing');
          startRingTimer();
        }
      } else {
        // Glare: we already have a machine (we placed a call simultaneously).
        const result = machine.receiveOffer(internalMsg);
        if (result.messages) sendMessages(result.messages);

        if (machine.state === 'ringing') {
          // We lost glare — abandon our outgoing offer and become the callee.
          clearTimeout(ringTimerRef.current);
          setCallMediaType((signal.media && signal.media.video) ? 'video' : 'audio');
          setPhase('ringing');
          startRingTimer();
        }
        // If we won glare, the machine sent a glare-reject and we stay in offering.
      }
      return;
    }

    // ── All other messages require an existing machine ──────────────────────
    if (!machine) return;

    // answer → the far end accepted our outgoing offer.
    if (internalType === 'answer') {
      const result = machine.receive(internalMsg);
      if (result.error) return;
      if (machine.state === 'connecting') {
        setPhase('connecting');
        if (peerConnRef.current && signal.sdp) {
          peerConnRef.current.complete(signal.sdp);
        }
      }
      return;
    }

    // reject, hangup, mute, camera, media-change, media-change-response
    const result = machine.receive(internalMsg);
    if (result.error) return;

    if (machine.state === 'ended') {
      handleCallEnded(machine.endReason);
      return;
    }

    if (internalType === 'mute')   setRemoteMuted(!!signal.muted);
    if (internalType === 'camera') setRemoteCameraOff(!!signal.cameraOff);

    if (internalType === 'media-change') {
      // The far end wants to add video — surface the request to the Owner.
      if (signal.media && signal.media.video && !machine.media.video) {
        setHasIncomingVideoRequest(true);
      }
    }
    if (internalType === 'media-change-response') {
      if (signal.accepted) setHasVideo(true);
    }
  };

  // Register the signal listener once per jid; call through the ref so every
  // render's handler is reachable without re-registering.
  useEffect(() => {
    if (!window.api?.icq?.onSignal) return;
    const unsub = window.api.icq.onSignal((data) => signalHandlerRef.current?.(data));
    return unsub;
  }, [jid]);

  // React to the initiateCall prop (same ref-guard pattern as GameSession).
  const handledInitiateRef = useRef(null);
  useEffect(() => {
    if (!initiateCall || initiateCall === handledInitiateRef.current || !ownerUin) return;
    handledInitiateRef.current = initiateCall;
    startCall(initiateCall);
    onInitiateCallClear?.();
  }, [initiateCall, ownerUin, startCall, onInitiateCallClear]);

  // Clean up all resources when this Contact's panel is torn down or the jid
  // changes (new chat opened before the call ended).
  useEffect(() => {
    return () => {
      clearTimeout(endTimerRef.current);
      clearTimeout(ringTimerRef.current);
      resetCall();
    };
  }, [jid, resetCall]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase === 'idle') return null;

  if (phase === 'offering') {
    return (
      <div className="call-panel call-panel--offering" role="status">
        <div className="call-panel-header">
          Calling <strong>{contactName}</strong>…
        </div>
        <div className="call-panel-type">
          {callMediaType === 'video' ? 'Video Call' : 'Audio Call'}
        </div>
        <button className="win98-btn call-panel-btn--cancel" onClick={hangup}>
          Cancel
        </button>
      </div>
    );
  }

  if (phase === 'ringing') {
    return (
      <div className="call-panel call-panel--ringing" role="dialog" aria-label="Incoming call">
        <div className="call-panel-header">
          Incoming {callMediaType === 'video' ? 'Video' : 'Audio'} Call
        </div>
        <div className="call-panel-contact">
          <strong>{contactName}</strong>
        </div>
        <div className="call-panel-actions">
          <button className="win98-btn call-panel-btn--accept" onClick={acceptCall}>
            Accept
          </button>
          <button className="win98-btn call-panel-btn--decline" onClick={rejectCall}>
            Decline
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'connecting' || phase === 'active') {
    return (
      <div className={`call-panel call-panel--active${phase === 'connecting' ? ' call-panel--connecting' : ''}`}>
        {hasVideo ? (
          <div className="call-panel-video-wrap">
            <video ref={remoteMediaRef} autoPlay playsInline className="call-panel-remote-video" />
            <video ref={localVideoRef} autoPlay playsInline muted className="call-panel-local-video" />
          </div>
        ) : (
          <audio ref={remoteMediaRef} autoPlay />
        )}

        {phase === 'connecting' && (
          <div className="call-panel-connecting" role="status">Connecting…</div>
        )}

        {phase === 'active' && (
          <div className="call-panel-status">
            {remoteMuted && (
              <span className="call-panel-badge">Contact muted</span>
            )}
            {remoteCameraOff && (
              <span className="call-panel-badge">Contact camera off</span>
            )}
            {hasIncomingVideoRequest && (
              <div className="call-panel-upgrade-request">
                <span>{contactName} wants to add video.</span>
                <button className="win98-btn" onClick={acceptVideoUpgrade}>Accept Video</button>
                <button className="win98-btn" onClick={declineVideoUpgrade}>Decline</button>
              </div>
            )}
          </div>
        )}

        <div className="call-panel-controls">
          <button
            className={`call-panel-btn${isMuted ? ' call-panel-btn--active' : ''}`}
            onClick={toggleMute}
            disabled={phase !== 'active'}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          {hasVideo && (
            <button
              className={`call-panel-btn${isCameraOff ? ' call-panel-btn--active' : ''}`}
              onClick={toggleCamera}
              disabled={phase !== 'active'}
              title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
            >
              {isCameraOff ? 'Camera On' : 'Camera Off'}
            </button>
          )}
          {!hasVideo && phase === 'active' && (
            <button className="call-panel-btn" onClick={requestVideoUpgrade} title="Upgrade to video call">
              Add Video
            </button>
          )}
          <button className="call-panel-btn call-panel-btn--end" onClick={hangup} title="End call">
            Hang Up
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'ended') {
    const messages = {
      rejected:  'Call declined.',
      cancelled: 'Call cancelled.',
      timeout:   'No answer.',
      dropped:   'Call dropped.',
      normal:    'Call ended.',
      busy:      'Contact is busy.',
    };
    return (
      <div className="call-panel call-panel--ended" role="status">
        {messages[endReason] || 'Call ended.'}
      </div>
    );
  }

  return null;
}
