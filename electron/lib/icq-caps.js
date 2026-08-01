/**
 * Peer capability discovery, so ISeekU can recognise itself on the other end.
 *
 * XMPP presence is cheap to broadcast and every Contact sends one on login.
 * Querying every Contact for their feature set would be wasteful — most of
 * the time the same client build is sending presence dozens of times a day
 * and the feature set never changes between them. XEP-0115 Entity Capabilities
 * solves this the right way: the client computes a hash of its feature set,
 * puts that hash in every presence stanza, and any receiver who has already
 * seen that hash skips the disco#info query entirely. In practice a single
 * hash floats around for the full lifetime of a release, so the network cost
 * drops to one query per client version rather than one per Contact.
 *
 * The algorithm is where implementations go wrong. XEP-0115 version 1.5 is
 * precise but fussy: identities are sorted by category, then type, then
 * xml:lang, then name; features sorted lexicographically; every element
 * terminated by the character `<` — a terminator, not a separator, so the
 * final element still carries one. The string is UTF-8 before SHA-1. Being
 * off by one terminator, or treating `<` as a separator, produces a hash that
 * no other client will recognise. The XEP's own worked example is in the
 * tests as a fixture for exactly this reason.
 *
 * The security concern is real and the comment must say it plainly: a Contact's
 * ver string is attacker-supplied. Any client can put any hash in its presence
 * stanza, and the receiver will use that hash as a cache key. If the cache
 * stored whatever disco#info returned under the advertised ver, a rogue client
 * could poison it — making ISeekU believe a Contact has (or lacks) features
 * that were never confirmed. `putCache` therefore recomputes the hash from the
 * disco result and refuses a mismatch. The cache is keyed by verified hashes
 * only; an unverified ver string buys nothing.
 *
 * Knowing that the Contact is also ISeekU matters because it unlocks things no
 * generic XMPP client can do: direct peer-to-peer file transfer with no size
 * limit, and voice and video calls. Those features are negotiated by
 * intersection — a newer ISeekU talking to an older one uses only what both
 * sides advertise, so the connection degrades gracefully rather than failing.
 *
 * Kept free of I/O and of any XMPP library. The caller parses stanzas and
 * passes plain objects in; the computed caps attributes go out and the caller
 * turns them into XML.
 */

'use strict';

const crypto = require('crypto');

/** The node URI published in our <c/> element. Must be a stable, dereferenceable URI. */
const OWN_NODE = 'https://github.com/The-Geek-Freaks/ISeekU';

/**
 * The identity this client reports in disco#info responses.
 *
 * XEP-0115 encodes an identity as `category/type/lang/name` with all four
 * fields present (empty string for an absent lang). A client with no lang is
 * different from a client with lang='en' — the algorithm treats them
 * differently when sorting.
 */
const OWN_IDENTITY = Object.freeze({ category: 'client', type: 'pc', lang: '', name: 'ISeekU' });

/**
 * ISeekU peer feature namespaces.
 *
 * MARKER in a Contact's feature list is what tells us they are running ISeekU.
 * XFER and CALLS are the capabilities that only make sense between two ISeekU
 * clients; they are advertised in the standard disco feature set so any capable
 * client can discover them, but the interface only offers them when both sides
 * carry them. Versioning is by namespace suffix — a future `urn:iseeku:call:1`
 * would be a distinct feature, and an older client that only knows `:0` would
 * not advertise `:1`, so the intersection naturally picks what both can use.
 */
const PEER = Object.freeze({
  /** This client is ISeekU. Presence of this marker is the identity test. */
  MARKER: 'urn:iseeku:peer:0',
  /** Direct peer-to-peer file transfer with no server-imposed size limit. */
  XFER:   'urn:iseeku:xfer:0',
  /** Voice and video calls. */
  CALLS:  'urn:iseeku:call:0',
});

/**
 * The complete feature set this build advertises in disco#info.
 *
 * Order here does not affect the hash — `computeVer` sorts them — but the
 * grouping aids readability: standard XMPP features say what any client can
 * expect of us; ISeekU-specific features say what only another ISeekU will use.
 */
const OWN_FEATURES = Object.freeze([
  'http://jabber.org/protocol/disco#info',    // we respond to service discovery queries
  'http://jabber.org/protocol/chatstates',     // XEP-0085 typing indicators
  'urn:xmpp:receipts',                         // XEP-0184 delivery receipts
  'urn:xmpp:delay',                            // XEP-0203 delayed delivery timestamps
  PEER.MARKER,
  PEER.XFER,
  PEER.CALLS,
]);

/**
 * Compute the XEP-0115 verification string for a given set of identities and
 * features.
 *
 * The algorithm: sort identities by category/type/lang/name, append each as
 * `category/type/lang/name<`, then sort features and append each as
 * `feature<`. SHA-1 the UTF-8 result and base64-encode the digest.
 *
 * NUL bytes separate the sort key fields internally because `/` appears in
 * the output format and could otherwise make two distinct identity tuples
 * sort as identical keys.
 */
function computeVer(identities, features) {
  const sortedIds = [...identities].sort((a, b) => {
    const ka = `${a.category}\x00${a.type}\x00${a.lang || ''}\x00${a.name || ''}`;
    const kb = `${b.category}\x00${b.type}\x00${b.lang || ''}\x00${b.name || ''}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const sortedFeatures = [...features].sort();

  let S = '';
  for (const id of sortedIds) {
    S += `${id.category}/${id.type}/${id.lang || ''}/${id.name || ''}<`;
  }
  for (const f of sortedFeatures) {
    S += `${f}<`;
  }

  return crypto.createHash('sha1').update(S, 'utf8').digest('base64');
}

/** The ver string for this build, computed once at load time. */
const OWN_VER = computeVer([OWN_IDENTITY], OWN_FEATURES);

/**
 * The attributes to place on the `<c/>` child of our presence stanza.
 *
 * The caller is responsible for turning this into XML. Keeping the serialisation
 * outside this module means this module is testable without an XML library.
 */
function ownCaps() {
  return Object.freeze({
    xmlns: 'http://jabber.org/protocol/caps',
    node:  OWN_NODE,
    hash:  'sha-1',
    ver:   OWN_VER,
  });
}

/**
 * The in-memory caps cache, keyed by verified ver strings.
 *
 * An entry is written only after `putCache` has confirmed that the recomputed
 * hash matches the advertised ver. A ver string seen for the first time is
 * absent — the caller must do a disco#info query and call `putCache` with the
 * result.
 */
const _cache = new Map();

/** Return the verified caps entry for `ver`, or null if not yet cached. */
function getCached(ver) {
  return _cache.get(ver) || null;
}

/**
 * Store a disco#info result, after verifying that its hash matches what the
 * Contact advertised.
 *
 * `ver` is the hash the Contact put in their `<c/>`. `identities` and
 * `features` are from the disco#info response. We recompute and compare;
 * if they do not match the entry is discarded rather than stored, because
 * storing it would let an attacker plant false capabilities in the cache.
 *
 * Returns `{ ok: true }` or `{ error }`.
 */
function putCache(ver, { identities, features }) {
  if (!Array.isArray(identities) || !Array.isArray(features)) {
    return { error: 'putCache: disco result must supply identities and features as arrays.' };
  }
  const computed = computeVer(identities, features);
  if (computed !== ver) {
    return {
      error: `Caps hash mismatch: Contact advertised "${ver}" but the disco result hashes to "${computed}". Discarding to prevent cache poisoning.`,
    };
  }
  _cache.set(ver, Object.freeze({
    identities: Object.freeze([...identities]),
    features:   Object.freeze([...features]),
  }));
  return { ok: true };
}

/** Remove all cached entries. Intended for tests. */
function clearCache() {
  _cache.clear();
}

/**
 * Parse the caps declaration from a Contact's `<c/>` element attributes.
 *
 * Returns `{ node, hash, ver }` or null. We only accept `hash="sha-1"` — the
 * one algorithm XEP-0115 version 1.5 defines — so that every entry in the
 * cache was produced by the same algorithm and comparisons are meaningful.
 * A `<c/>` with no hash attribute is old-style caps (pre-1.3) which we
 * cannot verify; null causes the caller to skip querying.
 */
function readCaps({ node, hash, ver } = {}) {
  if (!node || typeof node !== 'string') return null;
  if (!ver  || typeof ver  !== 'string') return null;
  if (hash !== 'sha-1') return null;
  return Object.freeze({ node, hash, ver });
}

/**
 * Whether a cached ver string belongs to an ISeekU client.
 *
 * A Contact whose ver we have never verified returns false — the absence of
 * proof is not a reason to offer ISeekU-specific features.
 */
function isISeekU(ver) {
  const entry = _cache.get(ver);
  return !!(entry && entry.features.includes(PEER.MARKER));
}

/**
 * Work out which ISeekU peer features are available with a Contact.
 *
 * Returns the intersection of our offered features and their advertised ones.
 * A newer ISeekU talking to an older one will get a subset — the features
 * the older client did not yet have are simply absent from the result rather
 * than causing an error. A Contact who is not ISeekU at all returns a result
 * with `isISeekU: false` and an empty feature list.
 */
function negotiatePeer(ver) {
  const entry = _cache.get(ver);
  if (!entry || !entry.features.includes(PEER.MARKER)) {
    return Object.freeze({
      isISeekU:           false,
      directFileTransfer: false,
      calls:              false,
      features:           Object.freeze([]),
    });
  }

  const their = new Set(entry.features);
  const shared = Object.values(PEER).filter(f => their.has(f));

  return Object.freeze({
    isISeekU:           true,
    directFileTransfer: their.has(PEER.XFER),
    calls:              their.has(PEER.CALLS),
    features:           Object.freeze(shared),
  });
}

module.exports = {
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
};
