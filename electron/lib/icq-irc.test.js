/**
 * Every test here exercises pure logic on plain strings — no sockets, no
 * servers, no Electron. The cases that matter most are the ones the RFC gets
 * wrong enough that real implementations break: trailing parameters containing
 * colons and spaces, IRCv3 tags prepended before the prefix, and CTCP requests
 * that must be answered selectively to avoid leaking client information.
 */

'use strict';

const {
  parse,
  serialise,
  nickFromPrefix,
  parseCTCP,
  buildCTCPMessage,
  ircStatusToIcqStatus,
  createSession,
  createChannel,
  CTCP_ALLOWED,
} = require('./icq-irc');

// ---------------------------------------------------------------------------
// parse()
// ---------------------------------------------------------------------------

describe('parse', () => {
  it('parses a simple command with no prefix and a trailing parameter', () => {
    const msg = parse('PING :irc.server.net\r\n');
    expect(msg.command).toBe('PING');
    expect(msg.prefix).toBeNull();
    expect(msg.params).toEqual(['irc.server.net']);
    expect(msg.tags).toEqual({});
  });

  it('parses a PRIVMSG with a full nick!user@host prefix', () => {
    const msg = parse(':alice!~alice@host.example PRIVMSG #chan :hello\r\n');
    expect(msg.command).toBe('PRIVMSG');
    expect(msg.prefix).toBe('alice!~alice@host.example');
    expect(msg.params).toEqual(['#chan', 'hello']);
  });

  it('includes spaces in the trailing parameter rather than stopping at the first one', () => {
    const msg = parse(':server 332 me #chan :the topic has several words\r\n');
    expect(msg.params[2]).toBe('the topic has several words');
  });

  it('includes colons in the trailing parameter rather than stopping at each one', () => {
    // This is the case parsers most often get wrong. A topic like
    // "meeting at 09:00: bring notes" breaks in half on a naïve parser.
    const msg = parse(':server 332 me #chan :meeting at 09:00: bring notes\r\n');
    expect(msg.params[2]).toBe('meeting at 09:00: bring notes');
  });

  it('parses a KICK with multiple params and a reason containing spaces', () => {
    const msg = parse(':op!o@h KICK #chan alice :You have been removed\r\n');
    expect(msg.command).toBe('KICK');
    expect(msg.params).toEqual(['#chan', 'alice', 'You have been removed']);
  });

  it('parses IRCv3 message tags before the prefix and command', () => {
    const msg = parse('@time=2026-08-01T12:00:00Z;msgid=abc123 :nick!u@h PRIVMSG #c :hi\r\n');
    expect(msg.tags).toEqual({ time: '2026-08-01T12:00:00Z', msgid: 'abc123' });
    expect(msg.prefix).toBe('nick!u@h');
    expect(msg.command).toBe('PRIVMSG');
    expect(msg.params).toEqual(['#c', 'hi']);
  });

  it('decodes IRCv3 tag escape sequences for semicolon and space', () => {
    // \: is a semicolon, \s is a space — the two characters that would
    // otherwise be parsed as tag separators or delimiters.
    const msg = parse('@key=hello\\sworld;semi=a\\:b :nick!u@h PING :x\r\n');
    expect(msg.tags.key).toBe('hello world');
    expect(msg.tags.semi).toBe('a;b');
  });

  it('treats a boolean tag with no value as an empty string', () => {
    const msg = parse('@draft/typing :nick!u@h TAGMSG #chan\r\n');
    expect(msg.tags['draft/typing']).toBe('');
  });

  it('strips both the CR and the LF from the end of the line', () => {
    const msg = parse('PING :x\r\n');
    // The trailing parameter must not carry a stray carriage return.
    expect(msg.params[0]).toBe('x');
  });

  it('parses a numeric command from a server', () => {
    const msg = parse(':irc.example.net 001 alex :Welcome to IRC\r\n');
    expect(msg.command).toBe('001');
    expect(msg.params[0]).toBe('alex');
    expect(msg.params[1]).toBe('Welcome to IRC');
  });

  it('returns an error object for an empty line rather than throwing', () => {
    expect(() => parse('')).not.toThrow();
    expect(parse('')).toHaveProperty('error');
  });

  it('returns an error object for a line that is only a prefix with no command', () => {
    expect(() => parse(':prefix.only')).not.toThrow();
    expect(parse(':prefix.only')).toHaveProperty('error');
  });

  it('returns an error object for a non-string input rather than throwing', () => {
    expect(() => parse(null)).not.toThrow();
    expect(parse(null)).toHaveProperty('error');
    expect(() => parse(undefined)).not.toThrow();
    expect(() => parse(42)).not.toThrow();
  });

  it('returns an error object for a line that is only whitespace', () => {
    expect(parse('   ')).toHaveProperty('error');
  });

  it('handles a command with no parameters', () => {
    const msg = parse('MOTD\r\n');
    expect(msg.command).toBe('MOTD');
    expect(msg.params).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// serialise()
// ---------------------------------------------------------------------------

describe('serialise', () => {
  it('builds NICK with a single parameter that needs no colon', () => {
    expect(serialise({ command: 'NICK', params: ['testnick'] })).toBe('NICK testnick\r\n');
  });

  it('builds USER and adds a colon to the real name because it contains spaces', () => {
    const line = serialise({ command: 'USER', params: ['user', '0', '*', 'Real Name'] });
    expect(line).toBe('USER user 0 * :Real Name\r\n');
  });

  it('adds a colon to the last parameter when it contains a space', () => {
    const line = serialise({ command: 'PRIVMSG', params: ['#chan', 'hello world'] });
    expect(line).toMatch(/:hello world\r\n$/);
  });

  it('does not add a colon to a single parameter that needs none', () => {
    const line = serialise({ command: 'JOIN', params: ['#general'] });
    expect(line).toBe('JOIN #general\r\n');
  });

  it('adds a colon to the last parameter when it starts with a colon', () => {
    const line = serialise({ command: 'PONG', params: [':server'] });
    expect(line).toContain('::server');
  });

  it('ends every line with CRLF', () => {
    const line = serialise({ command: 'PING', params: ['x'] });
    expect(line.slice(-2)).toBe('\r\n');
  });
});

// ---------------------------------------------------------------------------
// Handshake state machine
// ---------------------------------------------------------------------------

describe('handshake', () => {
  function makeSession(nick = 'testuser') {
    return createSession({ nick, username: nick, realname: 'Test User' });
  }

  it('start() returns NICK followed by USER', () => {
    const session = makeSession('alex');
    const lines = session.start();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^NICK alex\r\n$/);
    expect(lines[1]).toMatch(/^USER alex /);
    expect(lines[1]).toContain(':Test User\r\n');
  });

  it('moves to registered state and emits welcome when 001 arrives', () => {
    const session = makeSession('alex');
    session.start();
    const { send, events } = session.receive(':irc.net 001 alex :Welcome to IRC, alex\r\n');
    expect(session.state).toBe('registered');
    expect(send).toHaveLength(0);
    expect(events[0]).toMatchObject({ type: 'welcome', nick: 'alex' });
  });

  it('takes the nick from the 001 params even if the server adjusted the case', () => {
    const session = makeSession('Alex');
    session.start();
    const { events } = session.receive(':irc.net 001 alex :Welcome\r\n');
    // The server normalised 'Alex' to 'alex'.
    expect(events[0].nick).toBe('alex');
    expect(session.nick).toBe('alex');
  });

  it('sends a new NICK and emits nick-changed when 433 arrives during registration', () => {
    const session = makeSession('alex');
    session.start();
    const { send, events } = session.receive(':irc.net 433 * alex :Nickname is already in use\r\n');
    expect(send[0]).toMatch(/^NICK alex_\r\n$/);
    expect(session.nick).toBe('alex_');
    expect(events[0]).toMatchObject({ type: 'nick-changed', nick: 'alex_', reason: 'collision' });
  });

  it('keeps appending underscores on each repeated 433', () => {
    const session = makeSession('alex');
    session.start();
    session.receive(':irc.net 433 * alex :Nickname is already in use\r\n');
    const { send, events } = session.receive(':irc.net 433 * alex_ :Nickname is already in use\r\n');
    expect(send[0]).toMatch(/^NICK alex__\r\n$/);
    expect(session.nick).toBe('alex__');
    expect(events[0].nick).toBe('alex__');
  });

  it('answers PING with PONG before 001 arrives', () => {
    // Servers may send PING during the handshake as an anti-spam measure.
    const session = makeSession('alex');
    session.start();
    const { send } = session.receive('PING :irc.server.net\r\n');
    expect(send).toHaveLength(1);
    expect(send[0]).toMatch(/^PONG/);
    expect(send[0]).toContain('irc.server.net');
  });

  it('answers PING with the same token the server sent', () => {
    const session = makeSession('alex');
    session.start();
    session.receive(':irc.net 001 alex :Welcome\r\n');
    const { send } = session.receive('PING :12345ABCDE\r\n');
    expect(send[0]).toContain('12345ABCDE');
  });
});

// ---------------------------------------------------------------------------
// Channel state
// ---------------------------------------------------------------------------

describe('channel state', () => {
  it('does not emit events when 353 arrives — names are buffered until 366', () => {
    const channel = createChannel('#test');
    const { events: e1 } = channel.receive(parse(':server 353 me = #test :alice @bob\r\n'));
    expect(e1).toHaveLength(0);
    const { events: e2 } = channel.receive(parse(':server 353 me = #test :+carol\r\n'));
    expect(e2).toHaveLength(0);
  });

  it('emits a full names event and rebuilds the member map when 366 arrives', () => {
    const channel = createChannel('#test');
    channel.receive(parse(':server 353 me = #test :alice @bob\r\n'));
    channel.receive(parse(':server 353 me = #test :+carol dave\r\n'));
    const { events } = channel.receive(parse(':server 366 me #test :End of /NAMES list\r\n'));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('names');

    const members = events[0].members;
    expect(members.size).toBe(4);
    expect(members.has('alice')).toBe(true);
    expect(members.has('bob')).toBe(true);
    expect(members.has('carol')).toBe(true);
    expect(members.has('dave')).toBe(true);

    // '@' in the NAMES reply means channel operator (mode 'o').
    expect(members.get('bob').modes.has('o')).toBe(true);
    expect(members.get('alice').modes.has('o')).toBe(false);

    // '+' in the NAMES reply means voiced (mode 'v').
    expect(members.get('carol').modes.has('v')).toBe(true);
    expect(members.get('dave').modes.has('v')).toBe(false);
  });

  it('emits a topic event from the 332 reply sent on channel join', () => {
    const channel = createChannel('#test');
    const { events } = channel.receive(parse(':server 332 me #test :Welcome to the channel!\r\n'));
    expect(events[0]).toMatchObject({ type: 'topic', channel: '#test', text: 'Welcome to the channel!' });
    expect(channel.topic).toBe('Welcome to the channel!');
  });

  it('emits a topic event when TOPIC changes during the session', () => {
    const channel = createChannel('#test');
    const { events } = channel.receive(parse(':alice!a@h TOPIC #test :New topic set by alice\r\n'));
    expect(events[0]).toMatchObject({ type: 'topic', text: 'New topic set by alice' });
  });

  it('adds a member on JOIN and removes them on PART', () => {
    const channel = createChannel('#test');
    channel.receive(parse(':server 353 me = #test :me\r\n'));
    channel.receive(parse(':server 366 me #test :End of NAMES\r\n'));

    const { events: joinEvts } = channel.receive(parse(':alice!a@h JOIN #test\r\n'));
    expect(joinEvts[0]).toMatchObject({ type: 'join', nick: 'alice' });
    expect(channel.members.has('alice')).toBe(true);

    const { events: partEvts } = channel.receive(parse(':alice!a@h PART #test :Leaving now\r\n'));
    expect(partEvts[0]).toMatchObject({ type: 'part', nick: 'alice', reason: 'Leaving now' });
    expect(channel.members.has('alice')).toBe(false);
  });

  it('removes a member on QUIT and attributes it to the server departure', () => {
    const channel = createChannel('#test');
    channel.receive(parse(':server 353 me = #test :alice bob\r\n'));
    channel.receive(parse(':server 366 me #test :End of NAMES\r\n'));

    const { events } = channel.receive(parse(':alice!a@h QUIT :Connection reset\r\n'));
    expect(events[0]).toMatchObject({ type: 'quit', nick: 'alice', reason: 'Connection reset' });
    expect(channel.members.has('alice')).toBe(false);
    // bob was not mentioned in the QUIT, so he stays.
    expect(channel.members.has('bob')).toBe(true);
  });

  it('applies operator MODE changes to the member map', () => {
    const channel = createChannel('#test');
    channel.receive(parse(':server 353 me = #test :alice bob\r\n'));
    channel.receive(parse(':server 366 me #test :End of NAMES\r\n'));

    channel.receive(parse(':server MODE #test +o alice\r\n'));
    expect(channel.members.get('alice').modes.has('o')).toBe(true);

    channel.receive(parse(':server MODE #test -o alice\r\n'));
    expect(channel.members.get('alice').modes.has('o')).toBe(false);
  });

  it('ignores 353 and 366 lines for a different channel', () => {
    const channel = createChannel('#test');
    channel.receive(parse(':server 353 me = #other :alice @bob\r\n'));
    const { events } = channel.receive(parse(':server 366 me #other :End of NAMES\r\n'));
    // Nothing should happen because the channel names do not match.
    expect(events).toHaveLength(0);
    expect(channel.members.size).toBe(0);
  });

  it('mutating the returned member snapshot does not corrupt internal channel state', () => {
    // The members getter and the names event both return a deep copy. A caller
    // holding a snapshot and mutating a mode Set on it must not affect the mode
    // tracking that MODE events subsequently rely on.
    const channel = createChannel('#test');
    channel.receive(parse(':server 353 me = #test :@alice\r\n'));
    channel.receive(parse(':server 366 me #test :End of NAMES\r\n'));

    // Grab a snapshot and tear out the operator mode.
    const snap = channel.members;
    snap.get('alice').modes.delete('o');

    // The internal state must be unchanged.
    expect(channel.members.get('alice').modes.has('o')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CTCP
// ---------------------------------------------------------------------------

describe('parseCTCP', () => {
  it('extracts the command and arguments from a CTCP ACTION', () => {
    const result = parseCTCP('\x01ACTION waves hello\x01');
    expect(result).toEqual({ command: 'ACTION', args: 'waves hello' });
  });

  it('extracts a command with no arguments', () => {
    const result = parseCTCP('\x01VERSION\x01');
    expect(result).toEqual({ command: 'VERSION', args: '' });
  });

  it('extracts arguments from CTCP PING', () => {
    const result = parseCTCP('\x01PING 1234567890\x01');
    expect(result).toEqual({ command: 'PING', args: '1234567890' });
  });

  it('returns null for plain text that is not a CTCP message', () => {
    expect(parseCTCP('hello world')).toBeNull();
    expect(parseCTCP('')).toBeNull();
  });

  it('tolerates a missing closing \\x01 delimiter', () => {
    const result = parseCTCP('\x01ACTION nods');
    expect(result).toMatchObject({ command: 'ACTION', args: 'nods' });
  });

  it('returns null for a CTCP message with no command inside the delimiters', () => {
    expect(parseCTCP('\x01\x01')).toBeNull();
  });
});

describe('buildCTCPMessage', () => {
  it('wraps command and args in SOH delimiters', () => {
    expect(buildCTCPMessage('ACTION', 'waves')).toBe('\x01ACTION waves\x01');
  });

  it('omits the space when there are no arguments', () => {
    expect(buildCTCPMessage('VERSION', '')).toBe('\x01VERSION\x01');
  });
});

describe('CTCP in the session', () => {
  function registeredSession() {
    const session = createSession({ nick: 'me', username: 'me', realname: 'Me' });
    session.start();
    session.receive(':irc.net 001 me :Welcome\r\n');
    return session;
  }

  it('reports a CTCP ACTION as a message with isAction true and sends no reply', () => {
    // The CTCP ACTION round-trip: build the line, receive it, check the event.
    const ctcpText = buildCTCPMessage('ACTION', 'waves hello');
    const line = `:alice!a@h PRIVMSG #chan :${ctcpText}\r\n`;
    const session = registeredSession();
    const { send, events } = session.receive(line);
    expect(send).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'message',
      from: 'alice',
      to: '#chan',
      text: 'waves hello',
      isAction: true,
    });
  });

  it('sends a NOTICE containing a CTCP VERSION reply when asked for our version', () => {
    const session = registeredSession();
    const { send, events } = session.receive(':alice!a@h PRIVMSG me :\x01VERSION\x01\r\n');
    expect(send).toHaveLength(1);
    expect(send[0]).toMatch(/^NOTICE alice/);
    expect(send[0]).toContain('VERSION');
    expect(events[0]).toMatchObject({ type: 'ctcp-request', command: 'VERSION', from: 'alice' });
  });

  it('echoes the PING token back in the CTCP PING reply', () => {
    const session = registeredSession();
    const { send } = session.receive(':alice!a@h PRIVMSG me :\x01PING 987654321\x01\r\n');
    expect(send[0]).toContain('987654321');
  });

  it('sends a NOTICE with the current time for a CTCP TIME request', () => {
    const session = registeredSession();
    const { send } = session.receive(':alice!a@h PRIVMSG me :\x01TIME\x01\r\n');
    expect(send).toHaveLength(1);
    expect(send[0]).toContain('TIME');
  });

  it('produces no send and no event for an unknown CTCP command', () => {
    // FINGER, USERINFO, CLIENTINFO and anything else unknown must be silently
    // ignored. No reply and no event — the sender gets nothing to work with.
    const session = registeredSession();
    const { send, events } = session.receive(':alice!a@h PRIVMSG me :\x01FINGER\x01\r\n');
    expect(send).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('produces no send and no event for a CTCP USERINFO request', () => {
    const session = registeredSession();
    const { send, events } = session.receive(':alice!a@h PRIVMSG me :\x01USERINFO\x01\r\n');
    expect(send).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

describe('ircStatusToIcqStatus', () => {
  it('maps no-AWAY to ICQ Online', () => {
    expect(ircStatusToIcqStatus(false)).toBe('online');
  });

  it('maps AWAY to ICQ Away', () => {
    expect(ircStatusToIcqStatus(true)).toBe('away');
  });
});

// ---------------------------------------------------------------------------
// CTCP_ALLOWED whitelist
// ---------------------------------------------------------------------------

describe('CTCP_ALLOWED', () => {
  it('contains exactly ACTION, VERSION, PING, and TIME', () => {
    expect(CTCP_ALLOWED).toEqual(expect.arrayContaining(['ACTION', 'VERSION', 'PING', 'TIME']));
    expect(CTCP_ALLOWED).toHaveLength(4);
  });
});
