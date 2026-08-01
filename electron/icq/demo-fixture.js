/**
 * A believable Contact List and conversation, with no server behind it.
 *
 * Two jobs:
 *   - README screenshots. They have to show a populated client, and they have
 *     to be reproducible, or they drift out of date and nobody notices.
 *   - Working on the interface without signing in to anything.
 *
 * Turned on with ICQ_DEMO=1. It never runs in a normal launch, and it never
 * touches the network or the real History file.
 *
 * The data is deliberately fictional: invented UINs, invented names, and a
 * conversation that shows off the features rather than anyone's real messages.
 */

'use strict';

const DOMAIN = 'demo.iseeku';

/** Fixed so screenshots are byte-identical between runs. */
const T0 = Date.parse('2026-03-14T20:41:00Z') / 1000;

const CONTACTS = [
  { uin: '112233', name: 'Kathrin', group: 'Friends', status: 'chat', statusText: 'up for a chat' },
  { uin: '204815', name: 'Bernd', group: 'Friends', status: 'online', statusText: '' },
  { uin: '338291', name: 'Marco', group: 'Friends', status: 'away', statusText: 'gone for a smoke' },
  { uin: '451007', name: 'Sabine', group: 'Work', status: 'dnd', statusText: 'in a meeting until 4' },
  { uin: '509912', name: 'Tobias', group: 'Work', status: 'na', statusText: 'back tomorrow' },
  { uin: '617340', name: 'Jenny', group: 'Friends', status: 'offline', statusText: '' },
  { uin: '728451', name: 'Daniel', group: 'Friends', status: 'offline', statusText: '' },
  { uin: '839562', name: 'Petra', group: 'Work', status: 'online', statusText: '' },
  // Someone who has written without being added — the Not In List case, which
  // is worth showing because no modern messenger has it.
  { uin: '940173', name: null, group: 'Not In List', status: 'online', statusText: '', subscription: 'from' },
];

/** A short conversation that exercises the message log. */
const CONVERSATION = [
  { from: 'them', at: T0 - 900, body: 'Uh-oh! Bist du noch wach?' },
  { from: 'me', at: T0 - 840, body: 'Klar. Baue gerade an ISeekU weiter.' },
  { from: 'them', at: T0 - 780, body: 'Das alte ICQ? Respekt.' },
  { from: 'me', at: T0 - 700, body: 'Nicht nachgebaut — es spricht echtes XMPP.\nKontaktliste kommt vom Server.' },
  { from: 'them', at: T0 - 600, body: 'Und die Sounds?' },
  { from: 'me', at: T0 - 540, body: 'Uh-oh ist drin :)' },
  { from: 'them', at: T0 - 120, body: 'Schick mal einen Screenshot!' },
];

const jidOf = (uin) => `${uin}@${DOMAIN}`;

/** The Contact objects the bridge keeps in its map. */
function contacts() {
  return CONTACTS.map((c) => ({
    jid: jidOf(c.uin),
    uin: c.uin,
    domain: DOMAIN,
    name: c.name || c.uin,
    nickname: c.name,
    group: c.group,
    groups: [c.group],
    subscription: c.subscription || 'both',
    authorization: c.subscription === 'from' ? 'theirs' : 'granted',
    notInList: c.group === 'Not In List',
    status: c.status,
    statusText: c.statusText,
    lastSeen: c.status === 'offline' ? (T0 - 7200) * 1000 : null,
  }));
}

/** Messages in the canonical shape, for the contact the screenshots open. */
function conversationWith() {
  return jidOf(CONTACTS[0].uin);
}

function messages() {
  return CONVERSATION.map((m, i) => ({
    id: `demo-${i}`,
    body: m.body,
    fromMe: m.from === 'me',
    timestamp: m.at,
    author: null,
    type: 'chat',
    isGif: false,
    ack: m.from === 'me' ? 3 : 2,
    hasMedia: false,
    mediaData: null,
  }));
}

/**
 * Fill a bridge with the fixture and put it in the ready state, without
 * opening a socket. History writing is disabled so a demo run cannot append
 * invented messages to a real archive.
 */
function install(bridge) {
  bridge.account = { uin: '265019842', server: DOMAIN, domain: DOMAIN };
  bridge.ownJid = `265019842@${DOMAIN}/ISeekU-demo`;
  bridge.ownStatus = 'online';
  bridge.ownStatusText = 'Just Vibing';
  bridge.secure = false;
  bridge.status = 'ready';

  for (const contact of contacts()) bridge.contacts.set(contact.jid, contact);

  const peer = conversationWith();
  const msgs = messages();
  bridge.conversations.set(peer, { messages: msgs, unread: 2 });
  // A second contact with something waiting, so the blinking unread state is
  // visible in a screenshot of the Contact List.
  bridge.conversations.set(jidOf('204815'), {
    messages: [{
      id: 'demo-b0', body: 'Hast du kurz?', fromMe: false, timestamp: T0 - 60,
      author: null, type: 'chat', isGif: false, ack: 2, hasMedia: false, mediaData: null,
    }],
    unread: 1,
  });

  // Never let a demo run touch the archive on disk.
  bridge.appendHistory = () => {};
  bridge.readHistory = () => [];

  return bridge;
}

module.exports = { install, contacts, messages, conversationWith, DOMAIN, T0 };
