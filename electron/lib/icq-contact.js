/**
 * Turning XMPP roster items into Contacts.
 *
 * The roster speaks in JIDs and subscription states; the Contact List speaks in
 * UINs, Nicknames, Groups, and Authorization. This module is the translation,
 * kept pure so the rules can be tested without a server.
 *
 * The subscription states matter more than they look. RFC 6121 tracks two
 * directions independently, and ICQ's Authorization model is exactly the same
 * idea under a different name:
 *
 *   subscription='both'  we see them, they see us      — a normal Contact
 *   subscription='to'    we see them, they do not see us
 *   subscription='from'  they see us, we do not see them — Not In List
 *   subscription='none'  neither — Authorization pending or refused
 *
 * plus ask='subscribe', which means we have asked and are waiting.
 */

'use strict';

const DEFAULT_GROUP = 'General';

/** ICQ's holding area for people who are not really on the Contact List. */
const NOT_IN_LIST = 'Not In List';

/**
 * Is this JID a UIN on the given server, rather than some other XMPP address?
 * ICQ UINs are digits only; anything else is a contact from a federated server
 * and is shown by its full address instead.
 */
function isUin(localpart) {
  return /^[0-9]+$/.test(localpart);
}

/** Split a JID into its parts without pulling in a JID library. */
function parseJid(jid) {
  const full = String(jid || '');
  const slash = full.indexOf('/');
  const bare = slash === -1 ? full : full.slice(0, slash);
  const resource = slash === -1 ? null : full.slice(slash + 1);
  const at = bare.indexOf('@');
  return {
    bare,
    resource,
    localpart: at === -1 ? '' : bare.slice(0, at),
    domain: at === -1 ? bare : bare.slice(at + 1),
  };
}

/**
 * What the Owner should be shown as this Contact's name.
 *
 * ICQ's rule: the Nickname the Owner set wins over anything the Contact
 * publishes about themselves, because the Owner chose it and it is the name
 * they will recognise. Falling back to the bare UIN is correct and familiar —
 * people did memorise each other's numbers.
 */
function displayName({ name, jid }) {
  if (name && name.trim()) return name.trim();
  const { localpart, bare } = parseJid(jid);
  return isUin(localpart) ? localpart : (bare || String(jid));
}

/**
 * Which Group a Contact belongs in.
 *
 * XMPP allows a roster item in several groups at once; ICQ's Contact List does
 * not, and showing one person twice would be worse than picking one. The first
 * is taken, since that is the order the server stored them in.
 */
function primaryGroup(item) {
  const groups = (item.groups || []).map((g) => String(g).trim()).filter(Boolean);
  if (groups.length > 0) return groups[0];
  // Someone who can see us but whom we have not added is Not In List, not
  // an ungrouped Contact.
  if (item.subscription === 'from' || item.subscription === 'none') {
    return item.ask === 'subscribe' ? DEFAULT_GROUP : NOT_IN_LIST;
  }
  return DEFAULT_GROUP;
}

/**
 * The Authorization state, in ICQ's terms.
 *
 *   'granted'   we may see their Presence
 *   'pending'   we asked and are waiting for them to allow it
 *   'required'  we have not asked, or they refused
 *   'theirs'    they see us but we do not see them
 */
function authorization(item) {
  const { subscription, ask } = item;
  if (subscription === 'both' || subscription === 'to') return 'granted';
  if (ask === 'subscribe') return 'pending';
  if (subscription === 'from') return 'theirs';
  return 'required';
}

/**
 * Build a Contact from a roster item.
 *
 * `presence` is layered on separately as it arrives — the roster says who
 * exists, presence says how they are.
 */
function toContact(item, { presence } = {}) {
  const { bare, localpart, domain } = parseJid(item.jid);
  return {
    jid: bare,
    uin: isUin(localpart) ? localpart : null,
    domain,
    name: displayName(item),
    nickname: item.name || null,
    group: primaryGroup(item),
    groups: item.groups || [],
    subscription: item.subscription || 'none',
    authorization: authorization(item),
    notInList: primaryGroup(item) === NOT_IN_LIST,
    status: (presence && presence.status) || 'offline',
    statusText: (presence && presence.statusText) || '',
    lastSeen: (presence && presence.lastSeen) || null,
  };
}

/**
 * Group Contacts for display, in ICQ's order: named Groups alphabetically,
 * then General, then Not In List last.
 *
 * Within a Group, contacts sort by how reachable they are and then by name, so
 * the people the Owner can actually talk to are at the top — which is what the
 * Contact List was for.
 */
function intoGroups(contacts, { sortRank, showOffline = true } = {}) {
  const rank = sortRank || (() => 0);
  const byGroup = new Map();
  for (const contact of contacts) {
    if (!showOffline && contact.status === 'offline') continue;
    if (!byGroup.has(contact.group)) byGroup.set(contact.group, []);
    byGroup.get(contact.group).push(contact);
  }

  const groupOrder = (name) => {
    if (name === NOT_IN_LIST) return 2;
    if (name === DEFAULT_GROUP) return 1;
    return 0;
  };

  return [...byGroup.entries()]
    .map(([name, members]) => ({
      name,
      members: members.sort((a, b) => {
        const byStatus = rank(a.status) - rank(b.status);
        if (byStatus !== 0) return byStatus;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }),
      onlineCount: members.filter((c) => c.status !== 'offline').length,
    }))
    .sort((a, b) => {
      const byKind = groupOrder(a.name) - groupOrder(b.name);
      if (byKind !== 0) return byKind;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

/**
 * Work out the address to add, from whatever the Owner typed.
 *
 * A bare UIN means someone on the Owner's own server, which is the ICQ case
 * and by far the common one. But the network underneath is XMPP, so an address
 * that already names a server is a perfectly good contact on any other server
 * in the world — and refusing it would be throwing away the one real advantage
 * this client has over the original.
 *
 * Returns null for input that is not an address at all, so the caller can say
 * so rather than sending a malformed roster set.
 */
function addressToJid(input, ownDomain) {
  const typed = String(input || '').trim();
  if (!typed) return null;

  const at = typed.indexOf('@');
  if (at === -1) {
    // A bare localpart: on our own server. ICQ's UINs are digits, but a
    // non-numeric name is a valid localpart elsewhere and worth allowing.
    return ownDomain ? `${typed}@${ownDomain}` : null;
  }

  // Already an address. Strip any resource: a Contact is a person, not one of
  // their devices.
  const bare = typed.split('/')[0];
  const localpart = bare.slice(0, bare.indexOf('@'));
  const domain = bare.slice(bare.indexOf('@') + 1);
  if (!localpart || !domain || domain.includes('@')) return null;
  return bare;
}

/** Compose a JID for a UIN on the Owner's own server. */
function uinToJid(uin, domain) {
  return `${String(uin).trim()}@${domain}`;
}

module.exports = {
  DEFAULT_GROUP,
  NOT_IN_LIST,
  isUin,
  parseJid,
  displayName,
  primaryGroup,
  authorization,
  toContact,
  intoGroups,
  uinToJid,
  addressToJid,
};
