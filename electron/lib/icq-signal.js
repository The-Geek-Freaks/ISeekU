/**
 * Carrying the peer protocols over XMPP.
 *
 * `icq-p2p.js` and `icq-call.js` decide *what* to say — offer, accept, ICE
 * candidate, hangup — and deliberately know nothing about how it travels. This
 * is the other half: turning one of those plain objects into a stanza and
 * turning a stanza back into one, with the validation that matters because the
 * far end is somebody else's client.
 *
 * ── Why `<message>` rather than `<iq>` ──────────────────────────────────────
 *
 * Jingle (XEP-0166) uses IQ, and IQ is the right answer when each step needs
 * an acknowledgement the sender can act on. Signalling here does not: the call
 * and transfer state machines already model timeouts and unanswered offers,
 * so an IQ's error reply would duplicate a decision they make better. Message
 * is also what survives a Contact being briefly offline, which is exactly when
 * a hangup most needs to arrive.
 *
 * ── Why the payload is JSON ─────────────────────────────────────────────────
 *
 * The protocol modules define their messages as plain objects, and mapping
 * each field to its own element would mean maintaining a schema in two places
 * and rewriting it every time a field is added. One JSON text node keeps the
 * protocols free to evolve. The cost is that JSON from a peer is untrusted
 * input, which is what most of this file is about.
 *
 * ── What the far end could try ──────────────────────────────────────────────
 *
 * A Contact controls every byte of this. So:
 *
 *   - Anything over MAX_PAYLOAD_BYTES is dropped unread. An SDP body is a few
 *     kilobytes; a megabyte of JSON is someone probing for a parser problem.
 *   - `__proto__`, `constructor` and `prototype` keys are refused outright
 *     rather than stripped. `JSON.parse` does not itself pollute a prototype,
 *     but the object then gets merged, spread and passed around, and it only
 *     takes one `Object.assign` downstream for it to matter. Refusing is one
 *     line; auditing every downstream use is not.
 *   - The `type` must be one the protocols actually declare. An unknown type
 *     is dropped rather than forwarded, so a future version cannot be talked
 *     into dispatching on something this one has never heard of.
 *
 * Kept free of I/O and of the XMPP library, so the rules can be tested with
 * plain objects. `toStanzaSpec` returns a description of the stanza rather
 * than a stanza: the bridge owns the `xml()` factory.
 */

'use strict';

/** The namespace peers agree on. Bumped only for an incompatible change. */
const SIGNAL_NS = 'urn:iseeku:signal:0';

/**
 * An SDP offer with a lot of candidates is a few kilobytes. This leaves room
 * for that and stops well short of anything worth a memory spike.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** Message types the peer protocols declare. Anything else is not ours. */
const CALL_TYPES = Object.freeze([
  'call-offer', 'call-answer', 'call-ice', 'call-reject', 'call-hangup',
  'call-media-change', 'call-media-change-response', 'call-mute', 'call-camera',
]);

const TRANSFER_TYPES = Object.freeze([
  'p2p-offer', 'p2p-accept', 'p2p-reject', 'p2p-cancel',
]);

const GAME_TYPES = Object.freeze([
  'game-invite', 'game-accept', 'game-decline', 'game-move',
  'game-resign', 'game-rematch',
]);

const ALLOWED_TYPES = Object.freeze([...CALL_TYPES, ...TRANSFER_TYPES, ...GAME_TYPES]);

/** Keys that must never appear, at any depth. */
const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

/** Which protocol a type belongs to, so the bridge can route without a table. */
function familyOf(type) {
  if (CALL_TYPES.includes(type)) return 'call';
  if (TRANSFER_TYPES.includes(type)) return 'transfer';
  if (GAME_TYPES.includes(type)) return 'game';
  return null;
}

/**
 * Walk a parsed value looking for keys that should not be there.
 *
 * Depth-limited: a peer can nest JSON as deeply as it likes, and a recursive
 * walk without a bound is a stack overflow waiting to be sent to it.
 */
function hasForbiddenKey(value, depth = 0) {
  if (depth > 12) return true; // too deep to be a signalling message
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => hasForbiddenKey(v, depth + 1));
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.includes(key)) return true;
    if (hasForbiddenKey(value[key], depth + 1)) return true;
  }
  return false;
}

/**
 * Describe the stanza that carries `payload` to `toJid`.
 *
 * Returns `{ name, attrs, child }` — the bridge builds the real element. The
 * separation exists so this file never imports the XMPP library, which keeps
 * it testable without one.
 */
function toStanzaSpec(toJid, payload) {
  if (typeof toJid !== 'string' || !toJid.includes('@')) {
    return { error: 'A signal needs a Contact to send it to.' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'A signal payload must be an object.' };
  }
  if (!ALLOWED_TYPES.includes(payload.type)) {
    return { error: `Refusing to send an unknown signal type "${payload.type}".` };
  }

  let text;
  try {
    text = JSON.stringify(payload);
  } catch {
    // A circular reference, almost certainly a bug on this side rather than a
    // message worth sending.
    return { error: 'That signal payload cannot be serialised.' };
  }
  if (text.length > MAX_PAYLOAD_BYTES) {
    return { error: 'That signal is too large to send.' };
  }

  return {
    stanza: {
      name: 'message',
      attrs: { to: toJid, type: 'chat' },
      child: {
        name: 'signal',
        attrs: { xmlns: SIGNAL_NS, kind: payload.type },
        text,
      },
    },
  };
}

/**
 * Read a signal out of an inbound stanza, or explain why it is not one.
 *
 * Returns `{ signal, from, family }`, or `{ error }` when the stanza carries a
 * signal that cannot be trusted, or `{ ignore: true }` when it is simply not a
 * signal — an ordinary chat message takes that path on every keystroke, so it
 * must be cheap and must not be logged as a failure.
 *
 * `stanza` is duck-typed: anything with `is()`, `getChild()` and `attrs` works,
 * which covers both the XMPP library's element and a plain test fixture.
 */
function fromStanza(stanza) {
  if (!stanza || typeof stanza.getChild !== 'function') return { ignore: true };
  if (typeof stanza.is === 'function' && !stanza.is('message')) return { ignore: true };

  const child = stanza.getChild('signal', SIGNAL_NS);
  if (!child) return { ignore: true };

  const from = stanza.attrs && stanza.attrs.from;
  if (typeof from !== 'string' || !from.includes('@')) {
    return { error: 'A signal arrived without a usable sender.' };
  }

  const text = typeof child.getText === 'function' ? child.getText() : child.text;
  if (typeof text !== 'string' || text.length === 0) {
    return { error: 'A signal arrived with no payload.' };
  }
  if (text.length > MAX_PAYLOAD_BYTES) {
    // Dropped without parsing: the size alone says this is not signalling.
    return { error: 'A signal arrived that was too large to read.' };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { error: 'A signal arrived that was not readable.' };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'A signal arrived that was not an object.' };
  }
  if (hasForbiddenKey(payload)) {
    return { error: 'A signal arrived containing keys that are not allowed.' };
  }

  const family = familyOf(payload.type);
  if (!family) {
    // Not an error the Owner needs to see: a newer ISeekU may simply know a
    // type this one does not.
    return { ignore: true, unknownType: payload.type };
  }

  // The kind attribute is a routing hint only. Where it disagrees with the
  // payload, the payload wins and the disagreement is refused, so a peer
  // cannot have one thing routed and another thing acted on.
  const kind = child.attrs && child.attrs.kind;
  if (kind && kind !== payload.type) {
    return { error: 'A signal arrived whose kind and payload disagree.' };
  }

  return { signal: payload, from, family };
}

module.exports = {
  SIGNAL_NS,
  MAX_PAYLOAD_BYTES,
  ALLOWED_TYPES,
  CALL_TYPES,
  TRANSFER_TYPES,
  GAME_TYPES,
  familyOf,
  toStanzaSpec,
  fromStanza,
};
