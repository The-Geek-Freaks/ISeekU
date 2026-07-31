/**
 * The parts of the account facade that work without a server.
 *
 * Anything needing a socket is covered by tools/icq-smoke.js against the real
 * thing; mocking an XMPP server would test the mock. What is worth pinning here
 * is the state machine around it: unread counting, the canonical chat shape the
 * interface consumes, History paths, and the Alert rule — all of which are easy
 * to break and invisible until someone notices a wrong badge.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { IcqBridge, ACK } = require('./bridge');

const DOMAIN = '132.145.202.182';
const PEER = `12345@${DOMAIN}`;

function makeBridge(dataDir) {
  const bridge = new IcqBridge().init(dataDir);
  bridge.account = { uin: '265019842', server: DOMAIN, domain: DOMAIN };
  bridge.ownJid = `265019842@${DOMAIN}/ISeekU-test`;
  return bridge;
}

describe('starting up', () => {
  it('survives having no data directory, just without History', () => {
    // Throwing here would take the whole application down at launch.
    const bridge = new IcqBridge().init(null);
    expect(bridge.historyDir).toBeNull();
    expect(bridge.getStatus().status).toBe('disconnected');
  });

  it('reports disconnected before anyone signs in', () => {
    expect(new IcqBridge().init(os.tmpdir()).getStatus()).toMatchObject({
      status: 'disconnected', account: null, secure: false,
    });
  });
});

describe('unread counting', () => {
  let bridge;
  beforeEach(() => { bridge = makeBridge(null); });

  it('counts an arriving Message but not one we sent', () => {
    bridge.remember(PEER, { body: 'in', timestamp: 1 }, { incoming: true });
    bridge.remember(PEER, { body: 'out', timestamp: 2 }, { incoming: false });
    expect(bridge.conversations.get(PEER).unread).toBe(1);
  });

  it('clears on markRead', () => {
    bridge.remember(PEER, { body: 'in', timestamp: 1 }, { incoming: true });
    bridge.markRead(PEER);
    expect(bridge.conversations.get(PEER).unread).toBe(0);
  });

  it('does not blow up marking a conversation that never started', () => {
    expect(() => bridge.markRead('nobody@nowhere')).not.toThrow();
  });
});

describe('the chat list the interface renders', () => {
  let bridge;
  beforeEach(() => {
    bridge = makeBridge(null);
    bridge.contacts.set(PEER, {
      jid: PEER, uin: '12345', name: 'Bernd', group: 'Friends',
      status: 'away', statusText: 'Just Vibing', authorization: 'granted', notInList: false,
    });
  });

  it('lists a Contact even with nothing said yet — that is what a Contact List is', () => {
    const [chat] = bridge.listChats();
    expect(chat).toMatchObject({ id: PEER, name: 'Bernd', lastMessage: '', timestamp: 0, unreadCount: 0 });
  });

  it('carries the ICQ fields the skin needs alongside the generic ones', () => {
    const [chat] = bridge.listChats();
    expect(chat).toMatchObject({ uin: '12345', group: 'Friends', status: 'away', statusText: 'Just Vibing' });
  });

  it('shows the most recent Message and its time', () => {
    bridge.remember(PEER, { body: 'first', timestamp: 100 }, { incoming: true });
    bridge.remember(PEER, { body: 'latest', timestamp: 200 }, { incoming: true });
    expect(bridge.listChats()[0]).toMatchObject({ lastMessage: 'latest', timestamp: 200, unreadCount: 2 });
  });

  it('marks every ICQ chat as not a group — ICQ contacts are people', () => {
    expect(bridge.listChats()[0].isGroup).toBe(false);
  });
});

describe('History on disk', () => {
  let dir;
  let bridge;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iseeku-'));
    bridge = makeBridge(dir);
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('names the archive the way the official client does', () => {
    expect(path.basename(bridge.historyPath())).toBe(`265019842_${DOMAIN}.tsv`);
  });

  it('writes a row per Message and reads it back', () => {
    bridge.remember(PEER, { body: 'hallo', timestamp: 1700000000 }, { incoming: true });
    const rows = bridge.readHistory(PEER, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: 'hallo', incoming: true, peer: PEER });
  });

  it('creates the history directory rather than failing on first Message', () => {
    bridge.remember(PEER, { body: 'x', timestamp: 1 }, { incoming: true });
    expect(fs.existsSync(bridge.historyPath())).toBe(true);
  });

  it('survives a multi-line Message', () => {
    bridge.remember(PEER, { body: 'one\ntwo', timestamp: 1700000000 }, { incoming: false });
    expect(bridge.readHistory(PEER, 10)[0].body).toBe('one\ntwo');
  });

  it('finds Messages again by searching', () => {
    bridge.remember(PEER, { body: 'the blue folder', timestamp: 1700000000 }, { incoming: true });
    bridge.remember(PEER, { body: 'unrelated', timestamp: 1700000001 }, { incoming: true });
    expect(bridge.searchHistory('blue folder')).toHaveLength(1);
  });

  it('reports nothing rather than throwing when there is no archive yet', () => {
    expect(bridge.readHistory(PEER, 10)).toEqual([]);
    expect(bridge.searchHistory('anything')).toEqual([]);
  });

  it('keeps no History at all when there is no data directory', () => {
    const homeless = makeBridge(null);
    expect(homeless.historyPath()).toBeNull();
    expect(() => homeless.remember(PEER, { body: 'x', timestamp: 1 }, { incoming: true })).not.toThrow();
  });

  it('tops up the live conversation from the archive after a fresh sign-on', () => {
    bridge.remember(PEER, { body: 'from last week', timestamp: 1700000000 }, { incoming: true });
    const fresh = makeBridge(dir); // reconnected: nothing in memory
    const messages = fresh.getMessages(PEER, { limit: 50 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ body: 'from last week', historical: true, ack: ACK.READ });
  });
});

describe('the Away Message rule', () => {
  let bridge;
  beforeEach(() => {
    bridge = makeBridge(null);
    bridge.connection = { send: jest.fn().mockResolvedValue(undefined) };
    bridge.xml = (name, attrs, ...children) => ({ name, attrs, children });
    bridge.setAwayMessage('Bin gleich zurueck');
  });

  it('stays quiet while Online', () => {
    bridge.ownStatus = 'online';
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    expect(bridge.connection.send).not.toHaveBeenCalled();
  });

  it('answers once while Away, and not again', () => {
    bridge.ownStatus = 'away';
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    // The original did not pester either.
    expect(bridge.connection.send).toHaveBeenCalledTimes(1);
  });

  it('answers each contact separately', () => {
    bridge.ownStatus = 'dnd';
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    bridge.maybeSendAwayMessage(`999@${DOMAIN}/x`, `999@${DOMAIN}`);
    expect(bridge.connection.send).toHaveBeenCalledTimes(2);
  });

  it('starts answering again after the Away Message is changed', () => {
    bridge.ownStatus = 'away';
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    bridge.setAwayMessage('Neue Nachricht'); // a new absence
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    expect(bridge.connection.send).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when no Away Message is set', () => {
    bridge.setAwayMessage('');
    bridge.ownStatus = 'away';
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    expect(bridge.connection.send).not.toHaveBeenCalled();
  });

  it('stays quiet while Invisible — replying would give the Owner away', () => {
    bridge.ownStatus = 'invisible';
    bridge.maybeSendAwayMessage(`${PEER}/x`, PEER);
    expect(bridge.connection.send).not.toHaveBeenCalled();
  });
});

describe('Alert when a Contact comes online', () => {
  let bridge;
  let alerts;

  beforeEach(() => {
    bridge = makeBridge(null);
    alerts = [];
    bridge.on('alert', (a) => alerts.push(a));
    bridge.on('presence', () => {});
    bridge.setAlert(PEER, true);
  });

  const presence = (attrs, children = {}) => ({
    attrs,
    getChild: (name) => children[name] || null,
    getChildText: (name) => children[name] || null,
  });

  it('fires when the Contact goes from Offline to reachable', () => {
    bridge.onPresence(presence({ from: `${PEER}/desktop` }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].jid).toBe(PEER);
  });

  it('does not fire again while they stay online', () => {
    bridge.onPresence(presence({ from: `${PEER}/desktop` }));
    bridge.onPresence(presence({ from: `${PEER}/desktop` }, { show: 'away' }));
    expect(alerts).toHaveLength(1);
  });

  it('fires again after they have been Offline in between', () => {
    bridge.onPresence(presence({ from: `${PEER}/desktop` }));
    bridge.onPresence(presence({ from: `${PEER}/desktop`, type: 'unavailable' }));
    bridge.onPresence(presence({ from: `${PEER}/desktop` }));
    expect(alerts).toHaveLength(2);
  });

  it('does not fire for a Contact the Owner did not ask about', () => {
    bridge.onPresence(presence({ from: `999@${DOMAIN}/x` }));
    expect(alerts).toHaveLength(0);
  });

  it('stops firing once the Alert is turned off', () => {
    bridge.setAlert(PEER, false);
    bridge.onPresence(presence({ from: `${PEER}/desktop` }));
    expect(alerts).toHaveLength(0);
  });
});

describe('Authorization arriving as an Event', () => {
  let bridge;
  let requests;

  beforeEach(() => {
    bridge = makeBridge(null);
    requests = [];
    bridge.on('authorization-request', (r) => requests.push(r));
  });

  it('surfaces a subscribe as a request needing the Owner answer', () => {
    bridge.onPresence({
      attrs: { from: `${PEER}/x`, type: 'subscribe' },
      getChild: () => null,
      getChildText: () => null,
    });
    expect(requests).toEqual([{ jid: PEER, uin: '12345' }]);
  });

  it('does not treat a subscribe as a presence update', () => {
    bridge.onPresence({
      attrs: { from: `${PEER}/x`, type: 'subscribe' },
      getChild: () => null,
      getChildText: () => null,
    });
    expect(bridge.presences.has(PEER)).toBe(false);
  });
});
