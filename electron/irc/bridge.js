/**
 * IRC account facade for the main process.
 *
 * Mirrors the shape of icq/bridge.js: an EventEmitter that owns a socket,
 * keeps the state the interface needs, and pushes events using the same names
 * as the other transports where they mean the same thing.
 *
 * Parsing, the handshake, PING/PONG, and CTCP all come from lib/icq-irc.js,
 * which is I/O-free and fully tested there. This file adds only the socket,
 * the reconnect loop, and the translation from irc session events into the
 * canonical Contact/Chat shapes the renderer consumes.
 *
 * Port 6697 triggers TLS via the 'tls' module; everything else uses plain
 * TCP via 'net'. Neither is a new dependency — both ship with Node.
 */

'use strict';

const { EventEmitter } = require('events');
const net = require('net');
const tls = require('tls');
const { createSession, createChannel, parse } = require('../lib/icq-irc');

// Reconnect backoff sequence (ms): 1 s, 2 s, 4 s, 8 s, 15 s, then 30 s forever.
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 30000];

class IrcBridge extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.session = null;
    this.status = 'disconnected';
    this.account = null;
    this.contacts = new Map(); // nick → Contact
    this.conversations = new Map(); // channel/nick → { messages: [], unread: n }
    this.channels = new Map(); // lowercase channel name → channel state machine
    this._reconnectTimer = null;
    this._backoffIndex = 0;
    this._intentionalDisconnect = false;
    this._options = null;
    this._buf = '';
  }

  getStatus() {
    return {
      status: this.status,
      account: this.account,
      nick: this.session ? this.session.nick : null,
    };
  }

  // --- connection ----------------------------------------------------------

  connect(options) {
    if (this.socket) this.disconnect();
    this._options = options;
    this._intentionalDisconnect = false;
    this._backoffIndex = 0;
    this._doConnect();
  }

  _doConnect() {
    const { host, port, nick, username, realname, channels = [] } = this._options;
    const secure = Number(port) === 6697;

    this.status = 'connecting';
    this.account = { host, port, nick };
    this.emit('status', this.getStatus());

    const session = createSession({
      nick,
      username: username || nick,
      realname: realname || nick,
    });
    this.session = session;
    this._buf = '';

    const socketOptions = { host, port: Number(port) };
    const sock = secure
      ? tls.connect({ ...socketOptions, rejectUnauthorized: false })
      : net.createConnection(socketOptions);
    this.socket = sock;

    sock.setEncoding('utf8');

    const onConnected = () => {
      for (const line of session.start()) {
        sock.write(line);
      }
    };

    // TLS fires 'secureConnect' when the handshake completes; plain TCP uses
    // 'connect'. Both mean the socket is ready to use.
    sock.once(secure ? 'secureConnect' : 'connect', onConnected);

    sock.on('data', (chunk) => {
      this._buf += chunk;
      // IRC lines end with \r\n, but split on \n to handle servers that send
      // bare \n too. The partial line at the end of the array is kept for the
      // next data event.
      const lines = this._buf.split('\n');
      this._buf = lines.pop();
      for (const line of lines) {
        this._onLine(line);
      }
    });

    sock.on('error', (err) => {
      this.emit('error', { message: err.message, code: err.code });
    });

    sock.on('close', () => {
      this._onClose();
    });
  }

  _onLine(line) {
    if (!this.session) return;

    const { send, events } = this.session.receive(line);

    // Write every line the protocol machinery generated: PONG for PING,
    // NICK retries on 433, and CTCP replies (VERSION, TIME, PING).
    for (const out of send) {
      this._write(out);
    }

    for (const event of events) {
      this._handleSessionEvent(event);
    }

    // Each joined channel also sees every line so it can maintain its member
    // list and topic independently of the session.
    // parse() once here: createChannel().receive() expects the structured object
    // that parse() returns, not the raw wire string.
    const parsed = parse(line);
    for (const chan of this.channels.values()) {
      const { events: chanEvents } = chan.receive(parsed);
      for (const evt of chanEvents) {
        this._handleChannelEvent(evt);
      }
    }
  }

  _handleSessionEvent(event) {
    if (event.type === 'welcome') {
      this.status = 'ready';
      this._backoffIndex = 0;
      if (this.account) this.account.nick = event.nick;
      this.emit('status', this.getStatus());

      // Join every channel the Owner configured. Registration must complete
      // first — a JOIN sent before 001 is ignored by most servers.
      for (const ch of (this._options.channels || [])) {
        this._write(`JOIN ${ch}\r\n`);
        this._ensureChannel(ch);
      }
    } else if (event.type === 'message') {
      const { from, to, text, isAction } = event;

      // A channel prefix character means the message goes into that channel's
      // conversation. A message addressed to our nick is a direct message from
      // the sender.
      const isChannel = to.startsWith('#') || to.startsWith('&')
        || to.startsWith('!') || to.startsWith('+');
      const target = isChannel ? to : from;

      // CTCP ACTION ("/me …") is shown as a third-person emote.
      const body = isAction ? `* ${from} ${text}` : text;

      const message = {
        id: `irc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        body,
        fromMe: false,
        timestamp: Math.floor(Date.now() / 1000),
        author: isChannel ? from : null,
        type: 'chat',
        isGif: false,
        ack: 2, // DELIVERED — IRC has no delivery receipts
        hasMedia: false,
        mediaData: null,
      };

      this._remember(target, message, { incoming: true });
      this.emit('message', { jid: target, message });
    } else if (event.type === 'nick-changed') {
      if (this.account) this.account.nick = event.nick;
      this.emit('status', this.getStatus());
    }
  }

  _handleChannelEvent(evt) {
    if (evt.type === 'names') {
      // The server has sent a complete member list for this channel; rebuild
      // the contacts for everyone we now know about.
      for (const [nick] of evt.members) {
        if (!this.contacts.has(nick)) {
          this.contacts.set(nick, { jid: nick, name: nick, status: 'online', statusText: '' });
        }
      }
      this.emit('contacts', this.listContacts());
    } else if (evt.type === 'join') {
      if (!this.contacts.has(evt.nick)) {
        this.contacts.set(evt.nick, { jid: evt.nick, name: evt.nick, status: 'online', statusText: '' });
        this.emit('contacts', this.listContacts());
      }
    } else if (evt.type === 'quit') {
      // QUIT means the nick left the server entirely — they are Offline now.
      const contact = this.contacts.get(evt.nick);
      if (contact) {
        contact.status = 'offline';
        this.emit('contacts', this.listContacts());
      }
    }
  }

  _onClose() {
    this.socket = null;
    if (this._intentionalDisconnect) {
      this.status = 'disconnected';
      this.emit('status', this.getStatus());
      return;
    }
    // Unintentional close: reconnect after a backoff delay. The delay grows
    // with each consecutive failure and resets to zero once we reach 'ready'.
    this.status = 'reconnecting';
    this.emit('status', this.getStatus());
    const delay = BACKOFF[Math.min(this._backoffIndex, BACKOFF.length - 1)];
    this._backoffIndex = Math.min(this._backoffIndex + 1, BACKOFF.length - 1);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._doConnect();
    }, delay);
  }

  _ensureChannel(name) {
    const lc = name.toLowerCase();
    if (!this.channels.has(lc)) {
      this.channels.set(lc, createChannel(name));
    }
    if (!this.conversations.has(name)) {
      this.conversations.set(name, { messages: [], unread: 0 });
    }
  }

  _write(raw) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(raw);
    }
  }

  disconnect() {
    this._intentionalDisconnect = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const sock = this.socket;
    this.socket = null;
    if (sock) {
      try { sock.destroy(); } catch (_) {}
    }
    this.status = 'disconnected';
    this.contacts.clear();
    this.conversations.clear();
    this.channels.clear();
    this.emit('status', this.getStatus());
  }

  // --- messages and chats --------------------------------------------------

  sendMessage(channelOrNick, body) {
    this._write(`PRIVMSG ${channelOrNick} :${body}\r\n`);

    const message = {
      id: `irc-out-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      body,
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
      author: null,
      type: 'chat',
      isGif: false,
      ack: 1, // SENT
      hasMedia: false,
      mediaData: null,
    };
    this._remember(channelOrNick, message, { incoming: false });
    return message;
  }

  markRead(channelOrNick) {
    const convo = this.conversations.get(channelOrNick);
    if (convo) convo.unread = 0;
  }

  listContacts() {
    return [...this.contacts.values()];
  }

  listChats() {
    return [...this.conversations.entries()].map(([name, convo]) => {
      const last = convo.messages[convo.messages.length - 1];
      return {
        id: name,
        name,
        lastMessage: last ? last.body : '',
        timestamp: last ? last.timestamp : 0,
        unreadCount: convo.unread,
        isGroup: name.startsWith('#') || name.startsWith('&'),
        archived: false,
        avatar: null,
      };
    });
  }

  getMessages(channelOrNick, { limit = 200 } = {}) {
    const convo = this.conversations.get(channelOrNick);
    if (!convo) return [];
    const msgs = convo.messages;
    return msgs.length > limit ? msgs.slice(-limit) : [...msgs];
  }

  _remember(id, message, { incoming }) {
    if (!this.conversations.has(id)) {
      this.conversations.set(id, { messages: [], unread: 0 });
    }
    const convo = this.conversations.get(id);
    convo.messages.push(message);
    if (incoming) convo.unread += 1;
  }

  async shutdown() {
    this.disconnect();
  }
}

module.exports = { IrcBridge };
