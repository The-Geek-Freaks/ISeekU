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
const capsModel = require('../lib/icq-caps');

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

// ── Entity Capabilities ────────────────────────────────────────────────────

const NS_CAPS = 'http://jabber.org/protocol/caps';
const NS_DISCO = 'http://jabber.org/protocol/disco#info';

/** xml() mock that supports append(), matching the xmpp library's element API. */
function makeXml(name, attrs, ...children) {
  const el = { name, attrs, children: [...children] };
  el.append = (child) => { el.children.push(child); };
  return el;
}

/**
 * A minimal presence stanza duck-type: carries a <c/> element if `ver` is
 * given, otherwise looks like a plain available presence.
 */
function capPresence(attrs, ver = null) {
  return {
    attrs,
    getChild(name, ns) {
      if (name === 'c' && ns === NS_CAPS && ver) {
        return {
          attrs: {
            xmlns: NS_CAPS,
            node: capsModel.OWN_NODE,
            hash: 'sha-1',
            ver,
          },
        };
      }
      if (name === 'icq') return null;
      return null;
    },
    getChildText: () => null,
  };
}

describe('Entity Capabilities — outgoing presence', () => {
  let bridge;
  let sent;

  beforeEach(() => {
    capsModel.clearCache();
    bridge = makeBridge(null);
    sent = [];
    bridge.connection = {
      send: jest.fn((s) => { sent.push(s); return Promise.resolve(); }),
      entity: { iqCaller: { get: jest.fn() } },
    };
    bridge.xml = makeXml;
  });

  afterEach(() => capsModel.clearCache());

  it('adds a <c/> element to every outgoing presence', async () => {
    await bridge.setStatus('online', '');

    const presence = sent[0];
    const cElem = presence.children.find((c) => c.name === 'c');
    expect(cElem).toBeDefined();
    expect(cElem.attrs.xmlns).toBe(NS_CAPS);
    expect(cElem.attrs.hash).toBe('sha-1');
    expect(cElem.attrs.ver).toBe(capsModel.OWN_VER);
    expect(typeof cElem.attrs.node).toBe('string');
  });

  it('carries the same ver whether the Owner is Away or Online', async () => {
    await bridge.setStatus('online', '');
    await bridge.setStatus('away', 'Bin kurz weg');

    const vers = sent.map((s) => {
      const c = s.children.find((ch) => ch.name === 'c');
      return c ? c.attrs.ver : null;
    });
    expect(vers[0]).toBe(vers[1]);
    expect(vers[0]).toBe(capsModel.OWN_VER);
  });
});

describe('Entity Capabilities — inbound caps, cache hit', () => {
  let bridge;

  beforeEach(() => {
    capsModel.clearCache();
    bridge = makeBridge(null);
    bridge.on('presence', () => {});  // silence unhandled-event warnings
    bridge.on('peer-caps', () => {});
  });

  afterEach(() => capsModel.clearCache());

  it('marks a Contact as ISeekU when their ver is already in the verified cache', () => {
    // Populate the cache as if a previous disco query already confirmed this ver.
    const features = [capsModel.PEER.MARKER, capsModel.PEER.XFER, capsModel.PEER.CALLS];
    const ver = capsModel.computeVer([capsModel.OWN_IDENTITY], features);
    capsModel.putCache(ver, { identities: [capsModel.OWN_IDENTITY], features });

    bridge.contacts.set(PEER, {
      jid: PEER, uin: '12345', name: 'Bernd', group: 'Friends',
      status: 'offline', statusText: '', authorization: 'granted', notInList: false,
    });

    bridge.onPresence(capPresence({ from: `${PEER}/desktop` }, ver));

    const contact = bridge.contacts.get(PEER);
    expect(contact.peer).toBeDefined();
    expect(contact.peer.isISeekU).toBe(true);
    expect(contact.peer.calls).toBe(true);
    expect(contact.peer.directFileTransfer).toBe(true);
  });

  it('does not mark a Contact as ISeekU when their caps verify to a non-ISeekU client', () => {
    // The Exodus 0.9.1 fixture from XEP-0115 — a well-known non-ISeekU client.
    const exodusIdentity = { category: 'client', type: 'pc', lang: '', name: 'Exodus 0.9.1' };
    const exodusFeatures = [
      'http://jabber.org/protocol/caps',
      'http://jabber.org/protocol/disco#info',
      'http://jabber.org/protocol/disco#items',
      'http://jabber.org/protocol/muc',
    ];
    const exodusVer = capsModel.computeVer([exodusIdentity], exodusFeatures);
    capsModel.putCache(exodusVer, { identities: [exodusIdentity], features: exodusFeatures });

    bridge.contacts.set(PEER, {
      jid: PEER, uin: '12345', name: 'Bernd', group: 'Friends',
      status: 'offline', statusText: '', authorization: 'granted', notInList: false,
    });

    bridge.onPresence(capPresence({ from: `${PEER}/desktop` }, exodusVer));

    const contact = bridge.contacts.get(PEER);
    // peer is set but isISeekU is false — it is a Contact, just not running ISeekU.
    expect(!contact.peer || !contact.peer.isISeekU).toBe(true);
  });
});

describe('Entity Capabilities — inbound caps, disco query path', () => {
  let bridge;
  let sent;

  beforeEach(() => {
    capsModel.clearCache();
    bridge = makeBridge(null);
    sent = [];
    bridge.connection = {
      send: jest.fn((s) => { sent.push(s); return Promise.resolve(); }),
      entity: { iqCaller: { get: jest.fn() } },
    };
    bridge.xml = makeXml;
    bridge.on('presence', () => {});
    bridge.on('peer-caps', () => {});
  });

  afterEach(() => capsModel.clearCache());

  it('refuses a disco reply whose hash does not match the advertised ver', async () => {
    // Compute a ver for one specific feature set, but make the disco reply
    // return a *different* feature set.  putCache will recompute and refuse.
    const advertisedFeatures = [capsModel.PEER.MARKER];
    const advertisedVer = capsModel.computeVer([capsModel.OWN_IDENTITY], advertisedFeatures);

    const wrongFeatures = ['http://jabber.org/protocol/muc'];  // hashes to something else
    bridge.connection.entity.iqCaller.get = jest.fn().mockResolvedValue({
      getChildren: (name) => {
        if (name === 'identity') {
          return [{ attrs: { category: 'client', type: 'pc', name: 'ISeekU', lang: '' } }];
        }
        if (name === 'feature') {
          return wrongFeatures.map((v) => ({ attrs: { var: v } }));
        }
        return [];
      },
    });

    bridge.contacts.set(PEER, {
      jid: PEER, uin: '12345', name: 'Bernd', group: 'Friends',
      status: 'offline', statusText: '', authorization: 'granted', notInList: false,
    });

    bridge.onPresence(capPresence({ from: `${PEER}/desktop` }, advertisedVer));

    // Let the async disco query complete.
    await new Promise((resolve) => setImmediate(resolve));

    // The mismatch was caught — nothing should be in the cache.
    expect(capsModel.getCached(advertisedVer)).toBeNull();
    const contact = bridge.contacts.get(PEER);
    // peer must either be absent or explicitly not ISeekU — the attack failed.
    expect(!contact.peer || !contact.peer.isISeekU).toBe(true);
  });

  it('marks the Contact as ISeekU when the disco reply verifies correctly', async () => {
    const features = [capsModel.PEER.MARKER, capsModel.PEER.XFER, capsModel.PEER.CALLS];
    const ver = capsModel.computeVer([capsModel.OWN_IDENTITY], features);

    // Mock the disco query to return exactly what the ver was computed from.
    bridge.connection.entity.iqCaller.get = jest.fn().mockResolvedValue({
      getChildren: (name) => {
        if (name === 'identity') {
          return [{ attrs: {
            category: capsModel.OWN_IDENTITY.category,
            type: capsModel.OWN_IDENTITY.type,
            name: capsModel.OWN_IDENTITY.name,
            lang: capsModel.OWN_IDENTITY.lang,
          } }];
        }
        if (name === 'feature') return features.map((v) => ({ attrs: { var: v } }));
        return [];
      },
    });

    bridge.contacts.set(PEER, {
      jid: PEER, uin: '12345', name: 'Bernd', group: 'Friends',
      status: 'offline', statusText: '', authorization: 'granted', notInList: false,
    });

    bridge.onPresence(capPresence({ from: `${PEER}/desktop` }, ver));

    await new Promise((resolve) => setImmediate(resolve));

    expect(capsModel.getCached(ver)).not.toBeNull();
    const contact = bridge.contacts.get(PEER);
    expect(contact.peer).toBeDefined();
    expect(contact.peer.isISeekU).toBe(true);
  });

  it('sends only one disco query even when the same ver appears in multiple presence stanzas', async () => {
    const features = [capsModel.PEER.MARKER];
    const ver = capsModel.computeVer([capsModel.OWN_IDENTITY], features);

    // Delay resolution so the second presence arrives while the first is in flight.
    let resolveQuery;
    bridge.connection.entity.iqCaller.get = jest.fn(() => new Promise((resolve) => {
      resolveQuery = resolve;
    }));

    bridge.contacts.set(PEER, {
      jid: PEER, uin: '12345', name: 'Bernd', group: 'Friends',
      status: 'offline', statusText: '', authorization: 'granted', notInList: false,
    });

    bridge.onPresence(capPresence({ from: `${PEER}/desktop` }, ver));
    bridge.onPresence(capPresence({ from: `${PEER}/desktop` }, ver));

    expect(bridge.connection.entity.iqCaller.get).toHaveBeenCalledTimes(1);

    // Clean up the dangling promise.
    resolveQuery({ getChildren: () => [] });
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('Entity Capabilities — answering inbound disco#info', () => {
  let bridge;
  let sent;

  beforeEach(() => {
    bridge = makeBridge(null);
    sent = [];
    bridge.connection = {
      send: jest.fn((s) => { sent.push(s); return Promise.resolve(); }),
    };
    bridge.xml = makeXml;
  });

  /** Minimal IQ stanza duck-type for a disco#info GET from a peer. */
  function discoGet(from, id = 'q1') {
    return {
      attrs: { type: 'get', from, id },
      is: (name) => name === 'iq',
      getChild: (name, ns) => (name === 'query' && ns === NS_DISCO)
        ? { attrs: { xmlns: NS_DISCO } }
        : null,
    };
  }

  it('replies to a disco#info GET with our identity and full feature list', () => {
    bridge.onIq(discoGet(`${PEER}/desktop`));

    expect(bridge.connection.send).toHaveBeenCalledTimes(1);
    const reply = sent[0];
    expect(reply.attrs.type).toBe('result');
    expect(reply.attrs.to).toBe(`${PEER}/desktop`);

    // The reply stanza is an <iq>; its first child should be a <query>.
    const query = reply.children[0];
    expect(query.name).toBe('query');

    const identity = query.children.find((c) => c.name === 'identity');
    expect(identity).toBeDefined();
    expect(identity.attrs.category).toBe(capsModel.OWN_IDENTITY.category);
    expect(identity.attrs.type).toBe(capsModel.OWN_IDENTITY.type);

    const featureVars = query.children
      .filter((c) => c.name === 'feature')
      .map((c) => c.attrs.var);
    expect(featureVars).toContain(capsModel.PEER.MARKER);
    expect(featureVars).toContain(capsModel.PEER.XFER);
    expect(featureVars).toContain(capsModel.PEER.CALLS);
    expect(featureVars).toContain('http://jabber.org/protocol/disco#info');
  });

  it('does not reply to a non-GET IQ', () => {
    const resultIq = {
      attrs: { type: 'result', from: `${PEER}/x`, id: 'q1' },
      is: (name) => name === 'iq',
      getChild: () => null,
    };
    bridge.onIq(resultIq);
    expect(bridge.connection.send).not.toHaveBeenCalled();
  });

  it('does not reply to a GET IQ that is not disco#info', () => {
    const versionGet = {
      attrs: { type: 'get', from: `${PEER}/x`, id: 'q2' },
      is: (name) => name === 'iq',
      getChild: (name, ns) => (name === 'query' && ns === 'jabber:iq:version')
        ? { attrs: {} }
        : null,
    };
    bridge.onIq(versionGet);
    expect(bridge.connection.send).not.toHaveBeenCalled();
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
