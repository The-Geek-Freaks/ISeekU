/**
 * The ICQ Status set, and how it survives a round trip through XMPP presence.
 *
 * ICQ has eight Statuses; XMPP `<show>` has four values. The mapping is
 * therefore lossy in one direction: Occupied and DND both become `dnd`, and
 * Online and Free For Chat differ only by `chat`. To get the Owner's actual
 * Status back on the other side we also emit a marker element in our own
 * namespace. Clients that do not know it ignore it and see a sane `<show>`;
 * ISeekU reads it and shows the exact ICQ Status.
 *
 * Invisible is not a `<show>` value at all — it is the absence of presence.
 * See INVISIBLE below.
 */

'use strict';

/** Namespace for the marker element that carries the exact ICQ Status. */
const ICQ_NS = 'urn:iseeku:status:0';

/**
 * The Status set, in the order ICQ 5 lists it in the status menu.
 *
 * show      — the XMPP <show> value, or null for "available with no show"
 * available — whether contacts see the Owner as reachable at all
 * autoReply — whether an Away Message is sent to people who write while in
 *             this Status. This is the ICQ rule, not an XMPP one.
 */
const STATUSES = Object.freeze({
  online: { label: 'Available/Connect', show: null, available: true, autoReply: false },
  chat: { label: 'Free For Chat', show: 'chat', available: true, autoReply: false },
  away: { label: 'Away', show: 'away', available: true, autoReply: true },
  na: { label: 'N/A (Extended Away)', show: 'xa', available: true, autoReply: true },
  occupied: { label: 'Occupied (Urgent Msgs)', show: 'dnd', available: true, autoReply: true },
  dnd: { label: 'DND (Do not Disturb)', show: 'dnd', available: true, autoReply: true },
  invisible: { label: 'Privacy (Invisible)', show: null, available: false, autoReply: false },
  offline: { label: 'Offline/Disconnect', show: null, available: false, autoReply: false },
});

const STATUS_ORDER = Object.freeze([
  'online', 'chat', 'away', 'na', 'occupied', 'dnd', 'invisible', 'offline',
]);

/**
 * Which Status to assume for a contact when all we have is a `<show>` value —
 * used for contacts running some other client, which sends no ICQ marker.
 *
 * `dnd` resolves to Occupied rather than DND because Occupied is the milder of
 * the two: it is better to under-state someone's unavailability than to tell
 * the Owner not to write to somebody who would not have minded.
 */
const SHOW_TO_STATUS = Object.freeze({
  chat: 'chat',
  away: 'away',
  xa: 'na',
  dnd: 'occupied',
});

const isStatus = (name) => Object.prototype.hasOwnProperty.call(STATUSES, name);

/**
 * Describe how to publish a Status.
 *
 * Returns the shape a presence stanza should be built from, rather than the
 * stanza itself, so this stays pure and testable and the XMPP library stays out
 * of the domain layer.
 *
 * Invisible deserves an explanation: XMPP has no invisible mode in the core
 * spec. XEP-0186 defines one, but it needs server support that icqr.net does
 * not advertise. The fallback that works everywhere is to publish
 * `type='unavailable'` — contacts see the Owner drop offline while the
 * connection stays up, which is precisely what ICQ's Invisible looked like from
 * the outside. The one thing it cannot do is the Visible List, which needs the
 * server to make per-contact exceptions.
 */
function toPresence(status, { statusText = '', priority } = {}) {
  if (!isStatus(status)) throw new Error(`Unknown Status: ${status}`);
  if (status === 'offline') {
    return { type: 'unavailable', show: null, status: statusText || null, icqStatus: null, priority: null };
  }
  const spec = STATUSES[status];
  return {
    // Invisible publishes as unavailable; everything else is a normal presence.
    type: status === 'invisible' ? 'unavailable' : null,
    show: spec.show,
    status: statusText || null,
    // Do not tell the world we are Invisible — that defeats the point. Every
    // other Status carries its exact ICQ name for clients that understand it.
    icqStatus: status === 'invisible' ? null : status,
    priority: priority === undefined ? null : priority,
  };
}

/**
 * Work out a contact's Status from a received presence.
 *
 * `icqStatus` is the marker another ISeekU client sent; it wins when it names a
 * Status that is consistent with what was actually published. A client claiming
 * `online` while sending `type='unavailable'` is either buggy or lying, and the
 * wire form is the one that decides.
 */
function fromPresence({ type, show, icqStatus } = {}) {
  if (type === 'unavailable') return 'offline';
  if (type === 'error') return 'offline';
  if (icqStatus && isStatus(icqStatus) && STATUSES[icqStatus].available) return icqStatus;
  if (show && SHOW_TO_STATUS[show]) return SHOW_TO_STATUS[show];
  return 'online';
}

/** Whether an Away Message should be returned to someone writing to us now. */
function sendsAwayMessage(status) {
  return isStatus(status) ? STATUSES[status].autoReply : false;
}

/** Whether contacts can see us as reachable in this Status. */
function isAvailable(status) {
  return isStatus(status) ? STATUSES[status].available : false;
}

/** The Status menu, in ICQ's order, ready for the interface to render. */
function statusMenu() {
  return STATUS_ORDER.map((name) => ({ name, ...STATUSES[name] }));
}

/**
 * Sort key for the Contact List: available contacts first, in ICQ's Status
 * order, then everyone else alphabetically by the caller's own comparison.
 */
function sortRank(status) {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length : index;
}

module.exports = {
  ICQ_NS,
  STATUSES,
  STATUS_ORDER,
  toPresence,
  fromPresence,
  sendsAwayMessage,
  isAvailable,
  statusMenu,
  sortRank,
  isStatus,
};
