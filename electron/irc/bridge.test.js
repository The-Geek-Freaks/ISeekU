/**
 * The IRC account facade against a fake socket.
 *
 * The IRC protocol state machine — parsing, handshake, PING/PONG, CTCP, member
 * lists — lives in lib/icq-irc.js and is tested there. What is worth pinning
 * here is the bridge's own behaviour: that it sends the right opening lines,
 * answers PING so the server does not disconnect it, routes channel PRIVMSG
 * into the right conversation, and schedules a reconnect after an unexpected
 * close without doing so after one the Owner requested.
 */

'use strict';

const { EventEmitter } = require('events');

// A fake socket that records every write() call and can emit socket events.
function makeSocket() {
  const sock = new EventEmitter();
  sock.written = [];
  sock.write = (data) => { sock.written.push(String(data)); return true; };
  sock.destroy = () => { sock.destroyed = true; };
  sock.destroyed = false;
  sock.setEncoding = () => {};
  return sock;
}

// currentSocket is set fresh before each test so no state leaks between them.
let currentSocket;

jest.mock('net', () => ({
  createConnection: jest.fn(() => currentSocket),
}));
jest.mock('tls', () => ({
  connect: jest.fn(() => currentSocket),
}));

const { IrcBridge } = require('./bridge');

const BASE_OPTIONS = {
  host: 'irc.test',
  port: 6667,
  nick: 'Tester',
  username: 'tester',
  realname: 'Test User',
  channels: [],
};

// Create a bridge, call connect(), and fire the TCP 'connect' event so the
// handshake lines are sent. Returns both for further manipulation.
function makeConnected(opts = {}) {
  currentSocket = makeSocket();
  const bridge = new IrcBridge();
  bridge.connect({ ...BASE_OPTIONS, ...opts });
  currentSocket.emit('connect');
  return { bridge, socket: currentSocket };
}

// Drive the bridge to 'ready' by sending the 001 welcome line.
function sendWelcome(bridge) {
  bridge._onLine(':irc.test 001 Tester :Welcome to the network Tester!');
}

// ---------------------------------------------------------------------------

describe('handshake', () => {
  beforeEach(() => { currentSocket = makeSocket(); });

  it('sends NICK then USER when the socket connects', () => {
    const bridge = new IrcBridge();
    bridge.connect(BASE_OPTIONS);
    currentSocket.emit('connect');

    const raw = currentSocket.written.join('');
    expect(raw).toMatch(/NICK Tester\r\n/);
    expect(raw).toMatch(/USER tester/);
  });

  it('transitions to ready when the server sends 001', () => {
    const { bridge } = makeConnected();
    sendWelcome(bridge);

    expect(bridge.status).toBe('ready');
  });

  it('emits a status event with ready when 001 arrives', () => {
    const { bridge } = makeConnected();
    const statuses = [];
    bridge.on('status', (s) => statuses.push(s.status));

    sendWelcome(bridge);

    expect(statuses).toContain('ready');
  });

  it('sends JOIN for each configured channel after welcome', () => {
    const { bridge, socket } = makeConnected({ channels: ['#general', '#dev'] });
    socket.written.length = 0;
    sendWelcome(bridge);

    const raw = socket.written.join('');
    expect(raw).toContain('JOIN #general');
    expect(raw).toContain('JOIN #dev');
  });

  it('appends _ to the nick and retries on 433 ERR_NICKNAMEINUSE', () => {
    const { bridge, socket } = makeConnected();
    socket.written.length = 0;

    bridge._onLine(':irc.test 433 * Tester :Nickname already in use');

    expect(socket.written.join('')).toContain('NICK Tester_');
  });
});

describe('PING handling', () => {
  it('answers a server PING with PONG so the connection stays alive', () => {
    const { bridge, socket } = makeConnected();
    sendWelcome(bridge);
    socket.written.length = 0;

    bridge._onLine('PING :irc.test.net');

    expect(socket.written.join('')).toContain('PONG');
  });

  it('answers PING before 001 arrives — servers send it during registration too', () => {
    const { bridge, socket } = makeConnected();
    socket.written.length = 0;

    bridge._onLine('PING :irc.test.net');

    expect(socket.written.join('')).toContain('PONG');
  });

  it('echoes the PING token back in the PONG', () => {
    const { bridge, socket } = makeConnected();
    sendWelcome(bridge);
    socket.written.length = 0;

    bridge._onLine('PING :server-token-42');

    expect(socket.written.join('')).toContain('server-token-42');
  });
});

describe('channel messages become Chat messages', () => {
  it('emits a message event for a PRIVMSG to a joined channel', () => {
    const { bridge } = makeConnected({ channels: ['#general'] });
    sendWelcome(bridge);

    const received = [];
    bridge.on('message', (m) => received.push(m));
    bridge._onLine(':othernick!user@host PRIVMSG #general :Hello there');

    expect(received).toHaveLength(1);
    expect(received[0].jid).toBe('#general');
    expect(received[0].message.body).toBe('Hello there');
    expect(received[0].message.fromMe).toBe(false);
  });

  it('carries the sender nick as author in a channel message', () => {
    const { bridge } = makeConnected({ channels: ['#general'] });
    sendWelcome(bridge);
    bridge._onLine(':alice!a@host PRIVMSG #general :hi');

    const msgs = bridge.getMessages('#general');
    expect(msgs[0].author).toBe('alice');
  });

  it('accumulates the message in the channel conversation', () => {
    const { bridge } = makeConnected({ channels: ['#general'] });
    sendWelcome(bridge);
    bridge._onLine(':othernick!user@host PRIVMSG #general :Hello');

    const msgs = bridge.getMessages('#general');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('Hello');
  });

  it('counts arriving channel messages as unread', () => {
    const { bridge } = makeConnected({ channels: ['#general'] });
    sendWelcome(bridge);
    bridge._onLine(':nick!u@h PRIVMSG #general :one');
    bridge._onLine(':nick!u@h PRIVMSG #general :two');

    const [chat] = bridge.listChats();
    expect(chat.unreadCount).toBe(2);
  });

  it('marks a channel as a group Chat in the chat list', () => {
    const { bridge } = makeConnected({ channels: ['#general'] });
    sendWelcome(bridge);
    bridge._onLine(':nick!u@h PRIVMSG #general :hi');

    expect(bridge.listChats()[0].isGroup).toBe(true);
  });

  it('routes a direct message to a conversation with the sender', () => {
    const { bridge } = makeConnected();
    sendWelcome(bridge);

    const received = [];
    bridge.on('message', (m) => received.push(m));
    bridge._onLine(':friend!f@host PRIVMSG Tester :hey there');

    expect(received[0].jid).toBe('friend');
  });
});

describe('disconnection and reconnect', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('enters reconnecting state when the socket closes unexpectedly', () => {
    const { bridge } = makeConnected();
    sendWelcome(bridge);

    currentSocket.emit('close');

    expect(bridge.status).toBe('reconnecting');
  });

  it('calls _doConnect again after the backoff delay', () => {
    const { bridge } = makeConnected();
    sendWelcome(bridge);

    const spy = jest.spyOn(bridge, '_doConnect').mockImplementation(() => {});
    currentSocket.emit('close');

    expect(spy).not.toHaveBeenCalled(); // not yet — backoff is pending
    jest.runAllTimers();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect when the Owner disconnected intentionally', () => {
    const { bridge } = makeConnected();
    sendWelcome(bridge);

    const spy = jest.spyOn(bridge, '_doConnect').mockImplementation(() => {});
    bridge.disconnect();

    jest.runAllTimers();
    expect(spy).not.toHaveBeenCalled();
  });

  it('goes to disconnected state when the Owner disconnects', () => {
    const { bridge } = makeConnected();
    sendWelcome(bridge);
    bridge.disconnect();

    expect(bridge.status).toBe('disconnected');
  });

  it('resets the backoff index after a successful connection', () => {
    const { bridge } = makeConnected();
    bridge._backoffIndex = 4;

    sendWelcome(bridge);

    expect(bridge._backoffIndex).toBe(0);
  });
});

describe('channel member list from server NAMES replies', () => {
  // This exercises the parse(line) path in _onLine. createChannel().receive()
  // expects a structured { command, params, ... } object, not a raw string.
  // Passing a raw string caused it to return no events, so contacts were never
  // populated and the IRC contact list stayed empty.

  it('populates contacts after a 353/366 NAMES exchange', () => {
    const { bridge } = makeConnected({ channels: ['#general'] });
    sendWelcome(bridge);

    const contactsEvents = [];
    bridge.on('contacts', (list) => contactsEvents.push(list));

    bridge._onLine(':irc.test 353 Tester = #general :@alice bob');
    bridge._onLine(':irc.test 366 Tester #general :End of /NAMES list.');

    // The contacts event fires once (on RPL_ENDOFNAMES) with both nicks.
    expect(contactsEvents).toHaveLength(1);
    const nicks = contactsEvents[0].map(c => c.jid);
    expect(nicks).toContain('alice');
    expect(nicks).toContain('bob');
  });

  it('fires a contacts event when someone JOINs the channel', () => {
    const { bridge } = makeConnected({ channels: ['#general'] });
    sendWelcome(bridge);

    const contactsEvents = [];
    bridge.on('contacts', (list) => contactsEvents.push(list));

    bridge._onLine(':newcomer!n@host JOIN #general');

    expect(contactsEvents).toHaveLength(1);
    expect(contactsEvents[0].map(c => c.jid)).toContain('newcomer');
  });
});
