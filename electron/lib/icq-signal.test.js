/**
 * Every byte here comes from somebody else's client, so most of these tests
 * are about a hostile or broken signal being refused rather than a good one
 * being carried.
 *
 * The case that matters most is the cheap one: an ordinary chat message goes
 * through `fromStanza` on every keystroke a Contact makes, and it must come
 * back as "not a signal" without being treated as a failure.
 */

'use strict';

const {
  SIGNAL_NS,
  MAX_PAYLOAD_BYTES,
  ALLOWED_TYPES,
  familyOf,
  toStanzaSpec,
  fromStanza,
} = require('./icq-signal');

/** A stand-in for the XMPP library's element, with the same surface. */
function stanza({ name = 'message', from = '112233@demo.iseeku', children = [] } = {}) {
  return {
    attrs: { from },
    is: (n) => n === name,
    getChild(childName, ns) {
      return children.find((c) => c.name === childName && (!ns || c.attrs.xmlns === ns)) || null;
    },
  };
}

/** A `<signal>` child carrying `text`. */
function signalChild(text, { kind, ns = SIGNAL_NS } = {}) {
  return {
    name: 'signal',
    attrs: { xmlns: ns, ...(kind ? { kind } : {}) },
    getText: () => text,
  };
}

const withSignal = (payload, opts = {}) => stanza({
  ...opts,
  children: [signalChild(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    { kind: opts.kind === null ? undefined : (opts.kind || (payload && payload.type)) },
  )],
});

describe('sending', () => {
  it('wraps a payload in a signal element addressed to the Contact', () => {
    const { stanza: spec, error } = toStanzaSpec('112233@demo.iseeku', {
      type: 'call-offer', callId: 'c1', sdp: 'v=0...',
    });
    expect(error).toBeUndefined();
    expect(spec.attrs.to).toBe('112233@demo.iseeku');
    expect(spec.child.attrs.xmlns).toBe(SIGNAL_NS);
    expect(spec.child.attrs.kind).toBe('call-offer');
    expect(JSON.parse(spec.child.text)).toMatchObject({ type: 'call-offer', callId: 'c1' });
  });

  it('refuses a type the peer protocols do not declare', () => {
    // Stops this side from inventing a type the far end cannot route.
    const { error } = toStanzaSpec('112233@demo.iseeku', { type: 'call-something-new' });
    expect(error).toMatch(/unknown signal type/i);
  });

  it('refuses a payload that is not an object', () => {
    expect(toStanzaSpec('112233@demo.iseeku', 'hello').error).toBeTruthy();
    expect(toStanzaSpec('112233@demo.iseeku', null).error).toBeTruthy();
    expect(toStanzaSpec('112233@demo.iseeku', ['a']).error).toBeTruthy();
  });

  it('refuses a signal with no Contact to send it to', () => {
    expect(toStanzaSpec('', { type: 'call-hangup' }).error).toBeTruthy();
    expect(toStanzaSpec('not-a-jid', { type: 'call-hangup' }).error).toBeTruthy();
  });

  it('refuses a payload too large to be signalling', () => {
    const huge = { type: 'call-offer', sdp: 'x'.repeat(MAX_PAYLOAD_BYTES) };
    expect(toStanzaSpec('112233@demo.iseeku', huge).error).toMatch(/too large/i);
  });

  it('refuses a payload that cannot be serialised rather than throwing', () => {
    const circular = { type: 'call-offer' };
    circular.self = circular;
    expect(toStanzaSpec('112233@demo.iseeku', circular).error).toMatch(/cannot be serialised/i);
  });
});

describe('receiving', () => {
  it('reads a signal back out', () => {
    const { signal, from, family } = fromStanza(withSignal({ type: 'call-offer', callId: 'c1' }));
    expect(signal).toEqual({ type: 'call-offer', callId: 'c1' });
    expect(from).toBe('112233@demo.iseeku');
    expect(family).toBe('call');
  });

  it('round-trips what toStanzaSpec produced', () => {
    const payload = { type: 'p2p-offer', transferId: 't1', filename: 'holiday.jpg', size: 91234 };
    const { stanza: spec } = toStanzaSpec('112233@demo.iseeku', payload);
    const back = fromStanza(withSignal(JSON.parse(spec.child.text)));
    expect(back.signal).toEqual(payload);
    expect(back.family).toBe('transfer');
  });

  it('ignores an ordinary chat message without calling it an error', () => {
    // This runs on every message a Contact sends. It must be quiet.
    const chat = stanza({ children: [{ name: 'body', attrs: {}, getText: () => 'hallo' }] });
    expect(fromStanza(chat)).toEqual({ ignore: true });
  });

  it('ignores a presence stanza', () => {
    expect(fromStanza(stanza({ name: 'presence' })).ignore).toBe(true);
  });

  it('ignores a signal element in some other namespace', () => {
    const other = stanza({ children: [signalChild('{}', { ns: 'urn:example:other' })] });
    expect(fromStanza(other).ignore).toBe(true);
  });

  it('ignores rather than fails on a type it has never heard of', () => {
    // A newer ISeekU may know types this one does not; that is not an error.
    const result = fromStanza(withSignal({ type: 'call-hologram' }));
    expect(result.ignore).toBe(true);
    expect(result.unknownType).toBe('call-hologram');
  });

  it('copes with something that is not a stanza at all', () => {
    expect(fromStanza(null).ignore).toBe(true);
    expect(fromStanza({}).ignore).toBe(true);
  });
});

describe('what the far end might try', () => {
  it('refuses a payload carrying __proto__', () => {
    // JSON.parse does not pollute by itself, but the object is spread and
    // merged downstream, and one Object.assign is all it would take.
    const hostile = `{"type":"call-offer","__proto__":{"polluted":true}}`;
    expect(fromStanza(withSignal(hostile, { kind: 'call-offer' })).error).toMatch(/keys that are not allowed/i);
    expect({}.polluted).toBeUndefined();
  });

  it('refuses a forbidden key nested deep inside', () => {
    const hostile = `{"type":"call-offer","a":{"b":{"c":{"constructor":{"x":1}}}}}`;
    expect(fromStanza(withSignal(hostile, { kind: 'call-offer' })).error).toMatch(/keys that are not allowed/i);
  });

  it('refuses JSON nested deeply enough to be an attack on the walker', () => {
    let deep = '1';
    for (let i = 0; i < 40; i++) deep = `{"a":${deep}}`;
    const hostile = `{"type":"call-offer","payload":${deep}}`;
    expect(fromStanza(withSignal(hostile, { kind: 'call-offer' })).error).toBeTruthy();
  });

  it('drops an oversized payload without parsing it', () => {
    const huge = JSON.stringify({ type: 'call-offer', sdp: 'x'.repeat(MAX_PAYLOAD_BYTES) });
    expect(fromStanza(withSignal(huge, { kind: 'call-offer' })).error).toMatch(/too large/i);
  });

  it('refuses text that is not JSON', () => {
    expect(fromStanza(withSignal('not json at all', { kind: 'call-offer' })).error).toMatch(/not readable/i);
  });

  it('refuses JSON that is not an object', () => {
    expect(fromStanza(withSignal('[1,2,3]', { kind: 'call-offer' })).error).toMatch(/not an object/i);
    expect(fromStanza(withSignal('"a string"', { kind: 'call-offer' })).error).toMatch(/not an object/i);
  });

  it('refuses a signal whose kind attribute disagrees with its payload', () => {
    // Otherwise one thing gets routed and a different thing gets acted on.
    const mismatched = withSignal({ type: 'call-hangup' }, { kind: 'call-offer' });
    expect(fromStanza(mismatched).error).toMatch(/disagree/i);
  });

  it('refuses a signal with no sender to attribute it to', () => {
    const anonymous = withSignal({ type: 'call-offer' }, { from: 'not-a-jid' });
    expect(fromStanza(anonymous).error).toMatch(/usable sender/i);
  });

  it('refuses an empty payload', () => {
    expect(fromStanza(withSignal('', { kind: 'call-offer' })).error).toMatch(/no payload/i);
  });
});

describe('routing', () => {
  it('sorts each declared type into a family', () => {
    for (const type of ALLOWED_TYPES) {
      expect(['call', 'transfer', 'game']).toContain(familyOf(type));
    }
  });

  it('has no family for anything else', () => {
    expect(familyOf('chat')).toBeNull();
    expect(familyOf(undefined)).toBeNull();
  });
});
