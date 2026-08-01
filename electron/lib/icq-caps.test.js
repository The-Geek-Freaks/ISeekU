/**
 * Tests for icq-caps.js — peer capability discovery.
 *
 * The XEP-0115 worked example (the Exodus fixture) is the most important test
 * here because the algorithm is where implementations diverge: wrong sort order,
 * separator instead of terminator, wrong encoding — all produce a hash that
 * compiles and runs but never matches another client. If the fixture fails, the
 * algorithm is wrong, and everything downstream (cache lookups, peer recognition)
 * will silently not work in production.
 */

'use strict';

const {
  OWN_NODE,
  OWN_IDENTITY,
  OWN_FEATURES,
  OWN_VER,
  PEER,
  computeVer,
  ownCaps,
  getCached,
  putCache,
  clearCache,
  readCaps,
  isISeekU,
  negotiatePeer,
} = require('./icq-caps');

// ---- XEP-0115 worked example ------------------------------------------------

/**
 * The canonical fixture from XEP-0115 § 5 (Exodus 0.9.1). These values are
 * published in the specification itself. If this test fails, the algorithm
 * is wrong rather than our expectations being wrong.
 */
const EXODUS_IDENTITY = { category: 'client', type: 'pc', lang: '', name: 'Exodus 0.9.1' };
const EXODUS_FEATURES = [
  'http://jabber.org/protocol/caps',
  'http://jabber.org/protocol/disco#info',
  'http://jabber.org/protocol/disco#items',
  'http://jabber.org/protocol/muc',
];
const EXODUS_VER = 'QgayPKawpkPSDYmwT/WM94uAlu0=';

describe('XEP-0115 verification string — the Exodus 0.9.1 fixture', () => {
  it('produces the hash published in the specification', () => {
    expect(computeVer([EXODUS_IDENTITY], EXODUS_FEATURES)).toBe(EXODUS_VER);
  });

  it('produces the same hash regardless of the order features are passed in', () => {
    const shuffled = [...EXODUS_FEATURES].reverse();
    expect(computeVer([EXODUS_IDENTITY], shuffled)).toBe(EXODUS_VER);
  });

  it('uses a terminator not a separator so the final element still carries its own <', () => {
    // This is distinct from the fixture test above.  Build a string explicitly
    // in terminator form ('…feature<') and separator form ('…feature'), hash
    // both, and verify our implementation matches the terminator hash.
    // A separator-based implementation would produce the separator hash instead.
    const id = { category: 'client', type: 'pc', lang: '', name: 'T' };
    const crypto = require('crypto');
    const sha1b64 = s => crypto.createHash('sha1').update(s, 'utf8').digest('base64');
    const terminatorHash = sha1b64('client/pc//T<only-feature<');
    const separatorHash  = sha1b64('client/pc//T<only-feature');
    expect(terminatorHash).not.toBe(separatorHash);           // sanity: they differ
    expect(computeVer([id], ['only-feature'])).toBe(terminatorHash);
    expect(computeVer([id], ['only-feature'])).not.toBe(separatorHash);
  });
});

// ---- Sorting ----------------------------------------------------------------

describe('verification string algorithm — sort order', () => {
  it('sorts features alphabetically before hashing', () => {
    const featuresAbc = ['aaa', 'bbb', 'ccc'];
    const featuresZyx = ['ccc', 'bbb', 'aaa'];
    expect(computeVer([EXODUS_IDENTITY], featuresAbc))
      .toBe(computeVer([EXODUS_IDENTITY], featuresZyx));
  });

  it('sorts identities by category before type', () => {
    const audio = { category: 'conference', type: 'text', lang: '', name: 'X' };
    const client = { category: 'client', type: 'pc', lang: '', name: 'X' };
    // 'client' < 'conference' alphabetically ('l' < 'o'), so client sorts first.
    // The hash of [audio, client] must equal the hash of [client, audio]
    // regardless of which the caller passes first.
    expect(computeVer([client, audio], []))
      .toBe(computeVer([audio, client], []));
  });

  it('sorts identities with the same category by type', () => {
    const bot  = { category: 'client', type: 'bot',     lang: '', name: 'A' };
    const pc   = { category: 'client', type: 'pc',      lang: '', name: 'A' };
    const phone = { category: 'client', type: 'phone',  lang: '', name: 'A' };
    const ordered   = computeVer([bot, pc, phone], []);
    const scrambled = computeVer([phone, bot, pc], []);
    expect(ordered).toBe(scrambled);
  });

  it('sorts identities with the same category and type by lang', () => {
    const el = { category: 'client', type: 'pc', lang: 'el', name: 'Psi 0.11' };
    const en = { category: 'client', type: 'pc', lang: 'en', name: 'Psi 0.11' };
    // 'el' < 'en', so el-identity should appear first in the string.
    // Passing them in reverse order must produce the same hash.
    expect(computeVer([en, el], [])).toBe(computeVer([el, en], []));
  });

  it('places a no-lang identity before a lang identity when category and type match', () => {
    // An empty lang string sorts before any non-empty lang string.
    const noLang = { category: 'client', type: 'pc', lang: '',   name: 'X' };
    const engLang = { category: 'client', type: 'pc', lang: 'en', name: 'X' };
    expect(computeVer([engLang, noLang], []))
      .toBe(computeVer([noLang, engLang], []));
  });
});

// ---- Our own capabilities ---------------------------------------------------

describe('OWN_VER and ownCaps', () => {
  it('ownCaps returns the correct node, hash algorithm and a non-empty ver', () => {
    const caps = ownCaps();
    expect(caps.node).toBe(OWN_NODE);
    expect(caps.hash).toBe('sha-1');
    expect(typeof caps.ver).toBe('string');
    expect(caps.ver.length).toBeGreaterThan(0);
  });

  it('OWN_VER is consistent with the exported identity and feature list', () => {
    expect(OWN_VER).toBe(computeVer([OWN_IDENTITY], OWN_FEATURES));
  });

  it('OWN_VER is stable across repeated calls', () => {
    expect(ownCaps().ver).toBe(OWN_VER);
    expect(ownCaps().ver).toBe(OWN_VER);
  });

  it('our feature set includes the ISeekU peer marker', () => {
    expect(OWN_FEATURES).toContain(PEER.MARKER);
  });

  it('our feature set includes direct file transfer and calls', () => {
    expect(OWN_FEATURES).toContain(PEER.XFER);
    expect(OWN_FEATURES).toContain(PEER.CALLS);
  });
});

// ---- Cache ------------------------------------------------------------------

describe('caps cache', () => {
  beforeEach(() => clearCache());

  it('returns null for a ver string that has never been verified', () => {
    expect(getCached('not-yet-seen')).toBeNull();
  });

  it('stores and retrieves a verified entry', () => {
    const result = putCache(EXODUS_VER, {
      identities: [EXODUS_IDENTITY],
      features:   EXODUS_FEATURES,
    });
    expect(result).toEqual({ ok: true });
    const entry = getCached(EXODUS_VER);
    expect(entry).not.toBeNull();
    expect(entry.features).toEqual(expect.arrayContaining(EXODUS_FEATURES));
  });

  it('refuses to store an entry when the hash does not match the disco result', () => {
    const result = putCache('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', {
      identities: [EXODUS_IDENTITY],
      features:   EXODUS_FEATURES,
    });
    expect(result.error).toMatch(/mismatch/i);
    expect(getCached('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')).toBeNull();
  });

  it('does not store a poisoned entry even when the disco result is valid', () => {
    // A rogue client sends a real hash in its <c/> but returns a different
    // feature set in the disco response. The mismatch is caught.
    const wrongFeatures = ['http://jabber.org/protocol/muc'];
    const result = putCache(EXODUS_VER, {
      identities: [EXODUS_IDENTITY],
      features:   wrongFeatures,
    });
    expect(result.error).toBeDefined();
    expect(getCached(EXODUS_VER)).toBeNull();
  });

  it('returns an error and does not throw when identities or features are missing', () => {
    // A malformed disco#info response (no identities/features keys) must not
    // crash the XMPP handler; the function contract says it always returns an
    // object, never throws.
    expect(() => putCache(EXODUS_VER, {})).not.toThrow();
    const result = putCache(EXODUS_VER, {});
    expect(result.error).toBeDefined();
    expect(getCached(EXODUS_VER)).toBeNull();
  });

  it('keeps the cache clean after a refused entry — subsequent correct puts succeed', () => {
    putCache('bad-ver', { identities: [EXODUS_IDENTITY], features: EXODUS_FEATURES });
    const result = putCache(EXODUS_VER, { identities: [EXODUS_IDENTITY], features: EXODUS_FEATURES });
    expect(result).toEqual({ ok: true });
    expect(getCached(EXODUS_VER)).not.toBeNull();
  });
});

// ---- Reading a Contact's caps -----------------------------------------------

describe('readCaps — parsing the <c/> element', () => {
  it('returns the node, hash and ver when all fields are present and hash is sha-1', () => {
    const caps = readCaps({ node: OWN_NODE, hash: 'sha-1', ver: EXODUS_VER });
    expect(caps).toEqual({ node: OWN_NODE, hash: 'sha-1', ver: EXODUS_VER });
  });

  it('rejects a caps element with no node', () => {
    expect(readCaps({ hash: 'sha-1', ver: EXODUS_VER })).toBeNull();
  });

  it('rejects a caps element with no ver', () => {
    expect(readCaps({ node: OWN_NODE, hash: 'sha-1' })).toBeNull();
  });

  it('rejects old-style caps with no hash attribute', () => {
    // Pre-XEP-0115-1.3 caps have no hash, so we cannot verify them.
    expect(readCaps({ node: OWN_NODE, ver: EXODUS_VER })).toBeNull();
  });

  it('rejects caps with an unsupported hash algorithm', () => {
    expect(readCaps({ node: OWN_NODE, hash: 'sha-256', ver: EXODUS_VER })).toBeNull();
    expect(readCaps({ node: OWN_NODE, hash: 'md5', ver: EXODUS_VER })).toBeNull();
  });

  it('returns null for a completely empty object', () => {
    expect(readCaps({})).toBeNull();
    expect(readCaps()).toBeNull();
  });
});

// ---- ISeekU recognition -----------------------------------------------------

describe('isISeekU', () => {
  beforeEach(() => clearCache());

  it('returns false for a ver string that is not in the cache', () => {
    expect(isISeekU('unknown-ver')).toBe(false);
  });

  it('returns true when the cached feature set includes the ISeekU marker', () => {
    const iseekuFeatures = [PEER.MARKER, PEER.XFER, PEER.CALLS];
    const ver = computeVer([OWN_IDENTITY], iseekuFeatures);
    putCache(ver, { identities: [OWN_IDENTITY], features: iseekuFeatures });
    expect(isISeekU(ver)).toBe(true);
  });

  it('returns false when the cached feature set has no ISeekU marker', () => {
    putCache(EXODUS_VER, { identities: [EXODUS_IDENTITY], features: EXODUS_FEATURES });
    expect(isISeekU(EXODUS_VER)).toBe(false);
  });
});

// ---- Peer feature negotiation -----------------------------------------------

describe('negotiatePeer — version-aware feature intersection', () => {
  beforeEach(() => clearCache());

  it('returns isISeekU false and no features for a non-ISeekU Contact', () => {
    putCache(EXODUS_VER, { identities: [EXODUS_IDENTITY], features: EXODUS_FEATURES });
    const result = negotiatePeer(EXODUS_VER);
    expect(result.isISeekU).toBe(false);
    expect(result.directFileTransfer).toBe(false);
    expect(result.calls).toBe(false);
    expect(result.features).toHaveLength(0);
  });

  it('returns isISeekU false for an unknown ver string', () => {
    const result = negotiatePeer('not-in-cache');
    expect(result.isISeekU).toBe(false);
  });

  it('returns all peer features when the Contact is a current ISeekU', () => {
    const features = [PEER.MARKER, PEER.XFER, PEER.CALLS];
    const ver = computeVer([OWN_IDENTITY], features);
    putCache(ver, { identities: [OWN_IDENTITY], features });

    const result = negotiatePeer(ver);
    expect(result.isISeekU).toBe(true);
    expect(result.directFileTransfer).toBe(true);
    expect(result.calls).toBe(true);
    expect(result.features).toContain(PEER.MARKER);
    expect(result.features).toContain(PEER.XFER);
    expect(result.features).toContain(PEER.CALLS);
  });

  it('degrades gracefully when an older ISeekU does not support calls', () => {
    // An older build only has the marker and file transfer — calls came later.
    const olderFeatures = [PEER.MARKER, PEER.XFER];
    const olderVer = computeVer([OWN_IDENTITY], olderFeatures);
    putCache(olderVer, { identities: [OWN_IDENTITY], features: olderFeatures });

    const result = negotiatePeer(olderVer);
    expect(result.isISeekU).toBe(true);
    expect(result.directFileTransfer).toBe(true);
    expect(result.calls).toBe(false);        // calls not available — older client
    expect(result.features).toContain(PEER.XFER);
    expect(result.features).not.toContain(PEER.CALLS);
  });

  it('degrades to marker-only when an older ISeekU has no extended features', () => {
    // The very first ISeekU build that advertised any peer capability at all
    // might only have the marker and nothing else.
    const minimumFeatures = [PEER.MARKER];
    const minVer = computeVer([OWN_IDENTITY], minimumFeatures);
    putCache(minVer, { identities: [OWN_IDENTITY], features: minimumFeatures });

    const result = negotiatePeer(minVer);
    expect(result.isISeekU).toBe(true);
    expect(result.directFileTransfer).toBe(false);
    expect(result.calls).toBe(false);
    expect(result.features).toEqual([PEER.MARKER]);
  });
});

// ---- Module constants -------------------------------------------------------

describe('exported constants', () => {
  it('PEER.MARKER, PEER.XFER and PEER.CALLS are distinct strings', () => {
    const values = Object.values(PEER);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('OWN_IDENTITY has all four fields the algorithm expects', () => {
    expect(OWN_IDENTITY.category).toBeTruthy();
    expect(OWN_IDENTITY.type).toBeTruthy();
    expect(typeof OWN_IDENTITY.lang).toBe('string');   // may be empty
    expect(OWN_IDENTITY.name).toBeTruthy();
  });
});
