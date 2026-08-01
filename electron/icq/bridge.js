/**
 * The ICQ account, as the rest of the application sees it.
 *
 * Mirrors the shape of whatsapp-bridge.js and telegram-bridge.js: one module in
 * the main process that owns a connection, keeps the state the interface needs,
 * and pushes events out. The interface never learns that XMPP is underneath —
 * it receives Contacts, Messages and Statuses, in the same canonical shapes the
 * other two transports produce.
 *
 * Everything that can be decided without a socket lives in ../lib/icq-*.js and
 * is unit-tested there; this file is the part that has to talk to a server.
 */

'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const { IcqConnection } = require('./client');
const registration = require('./register');
const presenceModel = require('../lib/icq-presence');
const contactModel = require('../lib/icq-contact');
const historyModel = require('../lib/icq-history');

const NS = {
  roster: 'jabber:iq:roster',
  disco: 'http://jabber.org/protocol/disco#info',
  chatStates: 'http://jabber.org/protocol/chatstates',
  receipts: 'urn:xmpp:receipts',
  delay: 'urn:xmpp:delay',
  vcard: 'vcard-temp',
  lastActivity: 'jabber:iq:last',
  blocking: 'urn:xmpp:blocking',
  version: 'jabber:iq:version',
};

/** Acknowledgement codes, matching what the interface already renders. */
const ACK = { ERROR: -1, PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };

class IcqBridge extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.status = 'disconnected';
    this.account = null;
    this.contacts = new Map(); // bare JID -> Contact
    this.presences = new Map(); // bare JID -> {status, statusText, lastSeen}
    this.conversations = new Map(); // bare JID -> {messages: [], unread: n}
    this.serverFeatures = new Set();
    this.dataDir = null;
    this.xml = null;
    this.secure = false;
    this.ownStatus = 'offline';
    this.ownStatusText = '';
    this.awayMessage = '';
    this.alerts = new Set(); // JIDs the Owner asked to be told about
  }

  /**
   * Called once at application start. Does not connect.
   *
   * A missing data directory is survivable: the account still works, it just
   * keeps no History. Throwing here would take the whole application down at
   * startup over a feature nobody has asked for yet.
   */
  init(dataDir) {
    this.dataDir = dataDir || null;
    this.historyDir = dataDir ? path.join(dataDir, 'history') : null;
    return this;
  }

  getStatus() {
    return {
      status: this.status,
      account: this.account,
      secure: this.secure,
      ownStatus: this.ownStatus,
      ownStatusText: this.ownStatusText,
    };
  }

  // --- connection ----------------------------------------------------------

  async connect({ uin, password, server, port, domain, allowInsecure, resource }) {
    if (this.connection) await this.disconnect();

    this.status = 'connecting';
    this.emit('status', this.getStatus());

    const connection = new IcqConnection({
      server,
      port,
      domain: domain || server,
      uin,
      password,
      resource: resource || `ISeekU-${require('os').hostname()}`,
      allowInsecure,
    });
    this.connection = connection;
    this.account = { uin, server, domain: domain || server };

    connection.on('insecure', (info) => this.emit('insecure', info));
    connection.on('status', (s) => {
      if (s === 'reconnecting') {
        this.status = 'reconnecting';
        this.emit('status', this.getStatus());
      }
    });
    connection.on('offline', ({ willReconnect }) => {
      this.status = willReconnect ? 'reconnecting' : 'disconnected';
      this.emit('status', this.getStatus());
    });
    connection.on('error', (err) => this.emit('error', { message: err.message, code: err.code }));
    connection.on('stanza', (stanza) => this.onStanza(stanza));

    try {
      const { jid, secure } = await connection.start();
      this.secure = secure;
      this.ownJid = jid;
      const { xml } = await import('@xmpp/client');
      this.xml = xml;

      await this.loadServerFeatures();
      await this.loadContacts();
      await this.setStatus('online', this.ownStatusText);

      this.status = 'ready';
      this.emit('status', this.getStatus());
      this.emit('ready', { jid, secure });
      return this.getStatus();
    } catch (err) {
      this.status = 'error';
      this.connection = null;
      this.emit('status', this.getStatus());
      throw err;
    }
  }

  async disconnect() {
    if (!this.connection) return;
    const connection = this.connection;
    this.connection = null;
    await connection.stop();
    this.status = 'disconnected';
    this.contacts.clear();
    this.presences.clear();
    this.emit('status', this.getStatus());
  }

  /**
   * Create a new account on the server (XEP-0077), on its own short-lived
   * stream — registration happens before there is anyone to be logged in as.
   */
  async register({ uin, password, server, port, domain, allowInsecure, email }) {
    return registration.register({
      server, port, domain: domain || server, username: uin, password, email, allowInsecure,
    });
  }

  /** What this server needs in order to create an account. */
  async registrationFields({ server, port, domain }) {
    return registration.inspect({ server, port, domain: domain || server });
  }

  // --- server capabilities -------------------------------------------------

  async loadServerFeatures() {
    try {
      const reply = await this.connection.entity.iqCaller.get(
        this.xml('query', NS.disco), this.account.domain,
      );
      for (const feature of reply.getChildren('feature')) {
        if (feature.attrs.var) this.serverFeatures.add(feature.attrs.var);
      }
    } catch {
      // A server that will not say what it supports is treated as supporting
      // only the basics. Everything optional degrades rather than breaking.
    }
    this.emit('features', [...this.serverFeatures]);
  }

  supports(ns) {
    return this.serverFeatures.has(ns);
  }

  // --- the Contact List ----------------------------------------------------

  async loadContacts() {
    const reply = await this.connection.entity.iqCaller.get(this.xml('query', NS.roster));
    this.contacts.clear();
    for (const item of reply.getChildren('item')) {
      const contact = contactModel.toContact({
        jid: item.attrs.jid,
        name: item.attrs.name,
        subscription: item.attrs.subscription,
        ask: item.attrs.ask,
        groups: item.getChildren('group').map((g) => g.text()),
      }, { presence: this.presences.get(contactModel.parseJid(item.attrs.jid).bare) });
      this.contacts.set(contact.jid, contact);
    }
    this.emit('contacts', this.listContacts());
    return this.listContacts();
  }

  listContacts() {
    return [...this.contacts.values()];
  }

  /**
   * The Contact List in the canonical chat shape the interface renders.
   * A Contact is a chat whether or not anything has been said yet — that is
   * what a Contact List is.
   */
  listChats() {
    return this.listContacts().map((contact) => {
      const convo = this.conversations.get(contact.jid);
      const last = convo && convo.messages[convo.messages.length - 1];
      return {
        id: contact.jid,
        name: contact.name,
        lastMessage: last ? last.body : '',
        timestamp: last ? last.timestamp : 0,
        unreadCount: convo ? convo.unread : 0,
        isGroup: false,
        archived: false,
        avatar: contact.avatar || null,
        // ICQ-specific, ignored by the generic list but used by the ICQ skin.
        uin: contact.uin,
        group: contact.group,
        status: contact.status,
        statusText: contact.statusText,
        authorization: contact.authorization,
        notInList: contact.notInList,
      };
    });
  }

  /**
   * Add a Contact.
   *
   * `address` is whatever the Owner typed: a bare UIN for someone on our own
   * server, or a full address for someone on any other XMPP server in the
   * world. The second case is the one thing this client can do that the
   * original could not, and it costs nothing to allow.
   */
  async addContact(address, nickname, group) {
    const jid = contactModel.addressToJid(address, this.account.domain);
    if (!jid) {
      throw Object.assign(
        new Error(`"${address}" is not an ICQ number or an address.`),
        { code: 'BAD_ADDRESS' },
      );
    }
    const item = this.xml('item', nickname ? { jid, name: nickname } : { jid });
    if (group) item.append(this.xml('group', {}, group));
    await this.connection.entity.iqCaller.set(this.xml('query', NS.roster, item));
    // Asking for Authorization is a separate act from adding to the list.
    await this.connection.send(this.xml('presence', { to: jid, type: 'subscribe' }));
    return this.loadContacts();
  }

  async removeContact(jid) {
    await this.connection.entity.iqCaller.set(
      this.xml('query', NS.roster, this.xml('item', { jid, subscription: 'remove' })),
    );
    this.contacts.delete(jid);
    this.emit('contacts', this.listContacts());
  }

  /** Grant or refuse someone's Authorization request. */
  async answerAuthorization(jid, granted, reason) {
    const type = granted ? 'subscribed' : 'unsubscribed';
    const stanza = this.xml('presence', { to: jid, type });
    if (!granted && reason) stanza.append(this.xml('status', {}, reason));
    await this.connection.send(stanza);
  }

  // --- Presence ------------------------------------------------------------

  async setStatus(status, statusText) {
    const wanted = presenceModel.toPresence(status, { statusText });
    const stanza = this.xml('presence', wanted.type ? { type: wanted.type } : {});
    if (wanted.show) stanza.append(this.xml('show', {}, wanted.show));
    if (wanted.status) stanza.append(this.xml('status', {}, wanted.status));
    if (wanted.icqStatus) {
      stanza.append(this.xml('icq', { xmlns: presenceModel.ICQ_NS, status: wanted.icqStatus }));
    }
    await this.connection.send(stanza);
    this.ownStatus = status;
    this.ownStatusText = statusText || '';
    this.emit('status', this.getStatus());
  }

  /** Ask to be told when this Contact next stops being Offline. */
  setAlert(jid, on) {
    if (on) this.alerts.add(jid); else this.alerts.delete(jid);
  }

  onPresence(stanza) {
    const from = contactModel.parseJid(stanza.attrs.from).bare;
    if (!from || from === contactModel.parseJid(this.ownJid).bare) return;

    const type = stanza.attrs.type;

    // Someone asking to be allowed to see us is an Event, not a presence
    // update: it needs the Owner's answer.
    if (type === 'subscribe') {
      this.emit('authorization-request', { jid: from, uin: contactModel.parseJid(from).localpart });
      return;
    }
    if (type === 'subscribed' || type === 'unsubscribed') {
      this.emit('authorization-answer', { jid: from, granted: type === 'subscribed' });
      this.loadContacts().catch(() => {});
      return;
    }

    const icqMarker = stanza.getChild('icq', presenceModel.ICQ_NS);
    const status = presenceModel.fromPresence({
      type,
      show: stanza.getChildText('show'),
      icqStatus: icqMarker && icqMarker.attrs.status,
    });
    const statusText = stanza.getChildText('status') || '';

    const was = this.presences.get(from);
    this.presences.set(from, {
      status,
      statusText,
      lastSeen: status === 'offline' ? Date.now() : null,
    });

    const contact = this.contacts.get(from);
    if (contact) {
      contact.status = status;
      contact.statusText = statusText;
    }

    // The Alert fires on the transition into being reachable, not on every
    // presence a reachable contact sends.
    const wasOffline = !was || was.status === 'offline';
    if (this.alerts.has(from) && wasOffline && status !== 'offline') {
      this.emit('alert', { jid: from, name: contact ? contact.name : from, status });
    }

    this.emit('presence', { jid: from, status, statusText });
  }

  // --- Messages ------------------------------------------------------------

  async sendMessage(jid, body) {
    const id = `iseeku-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const stanza = this.xml('message', { to: jid, type: 'chat', id },
      this.xml('body', {}, body),
      this.xml('request', NS.receipts),
      this.xml('active', NS.chatStates));
    await this.connection.send(stanza);

    const message = {
      id,
      body,
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
      author: null,
      type: 'chat',
      isGif: false,
      ack: ACK.SENT,
      hasMedia: false,
      mediaData: null,
    };
    this.remember(jid, message, { incoming: false });
    return message;
  }

  async sendTyping(jid, isTyping) {
    await this.connection.send(this.xml('message', { to: jid, type: 'chat' },
      this.xml(isTyping ? 'composing' : 'paused', NS.chatStates)));
  }

  onMessage(stanza) {
    const from = contactModel.parseJid(stanza.attrs.from).bare;

    // Typing, and the acknowledgement that a Message arrived, ride along on
    // message stanzas that may carry no text at all.
    if (stanza.getChild('composing', NS.chatStates)) this.emit('typing', { jid: from, typing: true });
    if (stanza.getChild('paused', NS.chatStates)) this.emit('typing', { jid: from, typing: false });

    const receipt = stanza.getChild('received', NS.receipts);
    if (receipt) this.emit('ack', { jid: from, id: receipt.attrs.id, ack: ACK.DELIVERED });

    const body = stanza.getChildText('body');
    if (!body) return;

    // A Message carrying a delay was stored while we were Offline. It is
    // history, and must not blink the tray as though it just happened.
    const delay = stanza.getChild('delay', NS.delay);
    const timestamp = delay && delay.attrs.stamp
      ? Math.floor(new Date(delay.attrs.stamp).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const message = {
      id: stanza.attrs.id || `in-${timestamp}-${Math.floor(Math.random() * 1e6)}`,
      body,
      fromMe: false,
      timestamp,
      author: null,
      type: 'chat',
      isGif: false,
      ack: ACK.DELIVERED,
      hasMedia: false,
      mediaData: null,
      offline: Boolean(delay),
    };

    this.remember(from, message, { incoming: true });
    this.emit('message', { jid: from, message });

    // Confirm receipt only if it was asked for.
    if (stanza.getChild('request', NS.receipts) && stanza.attrs.id) {
      this.connection.send(this.xml('message', { to: stanza.attrs.from },
        this.xml('received', { xmlns: NS.receipts, id: stanza.attrs.id }))).catch(() => {});
    }

    this.maybeSendAwayMessage(stanza.attrs.from, from);
  }

  /**
   * ICQ returned a canned reply while the Owner was Away. Sent at most once per
   * contact per Status change, because the original would not pester either.
   */
  maybeSendAwayMessage(fullJid, bareJid) {
    if (!this.awayMessage) return;
    if (!presenceModel.sendsAwayMessage(this.ownStatus)) return;
    if (!this.awayRepliedTo) this.awayRepliedTo = new Set();
    if (this.awayRepliedTo.has(bareJid)) return;
    this.awayRepliedTo.add(bareJid);
    this.connection.send(this.xml('message', { to: fullJid, type: 'chat' },
      this.xml('body', {}, this.awayMessage))).catch(() => {});
  }

  setAwayMessage(text) {
    this.awayMessage = String(text || '');
    // A new Away Message means a new absence; everyone may be told again.
    this.awayRepliedTo = new Set();
  }

  remember(jid, message, { incoming }) {
    if (!this.conversations.has(jid)) this.conversations.set(jid, { messages: [], unread: 0 });
    const convo = this.conversations.get(jid);
    convo.messages.push(message);
    if (incoming) convo.unread += 1;
    this.appendHistory(jid, message, incoming);
  }

  getMessages(jid, { limit = 200 } = {}) {
    const convo = this.conversations.get(jid);
    const live = convo ? convo.messages : [];
    if (live.length >= limit) return live.slice(-limit);
    // Top up from the archive so a fresh sign-on still shows the conversation.
    const stored = this.readHistory(jid, limit - live.length)
      .map((entry) => ({
        id: `hist-${entry.at.getTime()}`,
        body: entry.body,
        fromMe: !entry.incoming,
        timestamp: Math.floor(entry.at.getTime() / 1000),
        author: null,
        type: 'chat',
        isGif: false,
        ack: ACK.READ,
        hasMedia: false,
        mediaData: null,
        historical: true,
      }));
    return [...stored, ...live];
  }

  markRead(jid) {
    const convo = this.conversations.get(jid);
    if (convo) convo.unread = 0;
  }

  // --- History -------------------------------------------------------------

  historyPath() {
    if (!this.account || !this.historyDir) return null;
    return path.join(
      this.historyDir,
      historyModel.archiveFileName(this.account.uin, this.account.domain),
    );
  }

  appendHistory(peerJid, message, incoming) {
    const file = this.historyPath();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const row = historyModel.formatRow({
        at: new Date(message.timestamp * 1000),
        incoming,
        peer: peerJid,
        self: this.ownJid || '',
        body: message.body,
      });
      fs.appendFileSync(file, `${row}\n`, 'utf8');
    } catch (err) {
      // Losing a History row must never lose the Message itself.
      this.emit('error', { message: `Could not write History: ${err.message}` });
    }
  }

  readHistory(peerJid, limit) {
    const file = this.historyPath();
    if (!file || !fs.existsSync(file)) return [];
    try {
      const entries = historyModel.parseArchive(fs.readFileSync(file, 'utf8'));
      return historyModel.conversation(entries, peerJid, { limit });
    } catch {
      return [];
    }
  }

  searchHistory(query, options) {
    const file = this.historyPath();
    if (!file || !fs.existsSync(file)) return [];
    try {
      return historyModel.search(historyModel.parseArchive(fs.readFileSync(file, 'utf8')), query, options);
    } catch {
      return [];
    }
  }

  // --- stanza routing ------------------------------------------------------

  onStanza(stanza) {
    if (stanza.is('message')) this.onMessage(stanza);
    else if (stanza.is('presence')) this.onPresence(stanza);
  }

  async shutdown() {
    await this.disconnect();
  }
}

module.exports = { IcqBridge, ACK, NS };
