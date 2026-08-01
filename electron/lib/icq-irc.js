/**
 * IRC as the fourth Transport, alongside ICQ, WhatsApp and Telegram.
 *
 * The hardest part of IRC is not the command set. Most commands are a single
 * line, the vocabulary is small, and the error codes are well documented. The
 * difficulty sits in three places where the specification and what servers
 * actually do diverge enough to break a naïve implementation.
 *
 * The trailing parameter is the first trap. RFC 1459 says that the last
 * parameter in an IRC line may be prefixed with " :" and, when it is,
 * everything that follows is a single parameter — including spaces and colons.
 * Parsers regularly strip only the leading colon and stop at the next one, so
 * topic lines like "today's meeting: part two" arrive broken in half, and any
 * kick reason containing a colon loses its tail. The parser here takes
 * everything from the first " :" to end of line as one string, with the colon
 * removed, which is what the specification actually requires.
 *
 * IRCv3 message tags are the second trap. Every modern server prepends
 * "@key=value;key2=value2 " before the prefix on every line it sends. An RFC
 * 1459 parser that does not strip the tag block first will treat it as the
 * prefix, leaving the real prefix and command completely misread. Tags are
 * extracted before anything else here, so the rest of the parser never sees
 * them.
 *
 * CTCP security is the third. CTCP (Client-To-Client Protocol) wraps commands
 * in ASCII SOH (\x01) characters inside a PRIVMSG. The ACTION command is how
 * "/me" works and carries no risk. But any CTCP request also expects a reply,
 * and a client that answers every CTCP query will hand its version string,
 * username, and idle time to anyone who asks. A flood of CTCP requests can
 * also overwhelm a client that replies to all of them. Only ACTION, VERSION,
 * PING, and TIME are processed here; everything else is silently dropped with
 * no reply and no event.
 *
 * How IRC maps onto ISeekU vocabulary: a channel is a Chat, the nicks of
 * people in it are their Contact identifiers, and the IRC AWAY state maps
 * directly onto the ICQ Away Status. Online with no AWAY set maps to ICQ
 * Online. When someone quits the server entirely they become Offline. IRC has
 * no equivalent of ICQ's N/A, Occupied, DND, Free For Chat, or Invisible
 * Statuses — those require states the IRC protocol simply does not track.
 *
 * Nick collision: the server sends 433 (ERR_NICKNAMEINUSE) when our chosen
 * nick is taken during registration. The handshake appends "_" to the current
 * attempt and retries, repeating as many times as the server keeps refusing.
 * The application can offer a rename once the 001 welcome arrives.
 *
 * PING/PONG: a server silently disconnects a client that does not answer PING
 * within a few minutes, and the server sends PING at any point — including
 * during registration, before 001. The PING handler in receive() runs before
 * any state check, so a PING during the handshake is answered as promptly as
 * one mid-conversation.
 *
 * Kept free of I/O so parsing, the handshake, and channel state can all be
 * tested with plain strings. The XMPP analogue is icq-presence.js, which maps
 * ICQ Statuses onto XMPP presence in the same way this module maps IRC AWAY
 * onto the ICQ Status set.
 */

'use strict';

// ---------------------------------------------------------------------------
// Tag parsing (IRCv3)
// ---------------------------------------------------------------------------

/**
 * The escape sequences defined by the IRCv3 message-tags specification.
 * Anything not in this table collapses to the literal character after the
 * backslash, which is what the spec requires.
 */
const TAG_ESCAPES = {
  ':': ';',
  's': ' ',
  '\\': '\\',
  'r': '\r',
  'n': '\n',
};

/** Decode one tag value, handling IRCv3 escape sequences. */
function decodeTagValue(raw) {
  if (!raw) return '';
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const esc = TAG_ESCAPES[raw[i + 1]];
      out += esc !== undefined ? esc : raw[i + 1];
      i += 2;
    } else {
      out += raw[i++];
    }
  }
  return out;
}

/** Parse "@key=value;key2" into { key: 'value', key2: '' }. */
function parseTags(raw) {
  const tags = {};
  if (!raw) return tags;
  for (const pair of raw.split(';')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) {
      tags[pair] = '';
    } else {
      tags[pair.slice(0, eq)] = decodeTagValue(pair.slice(eq + 1));
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// IRC message parsing (RFC 1459 + RFC 2812 + IRCv3)
// ---------------------------------------------------------------------------

/**
 * Parse one IRC line into its components.
 *
 * Returns { tags, prefix, command, params } on success, or { error } when the
 * line cannot be a valid IRC message. Never throws — a hostile or buggy server
 * can send anything, and the caller should not have to wrap every call in a
 * try/catch.
 *
 * The trailing parameter (everything after the first " :") is the last element
 * of params, with its leading colon removed. Callers do not need to know which
 * element was the trailing; it is just the last one.
 */
function parse(line) {
  if (typeof line !== 'string') return { error: 'Not a string.' };

  // Strip the CRLF (or bare CR or LF) that arrives from a real connection.
  let s = line.replace(/[\r\n]+$/, '');

  const tags = {};
  let prefix = null;

  // IRCv3 tags come first and are always prefixed with '@'.
  if (s.startsWith('@')) {
    const sp = s.indexOf(' ');
    if (sp === -1) return { error: 'Line has tags but nothing else.' };
    Object.assign(tags, parseTags(s.slice(1, sp)));
    s = s.slice(sp + 1);
  }

  // An optional prefix starts with ':'.
  if (s.startsWith(':')) {
    const sp = s.indexOf(' ');
    if (sp === -1) return { error: 'Line has a prefix but no command.' };
    prefix = s.slice(1, sp);
    s = s.slice(sp + 1);
  }

  // The command is the first remaining token.
  const firstSp = s.indexOf(' ');
  const command = firstSp === -1 ? s : s.slice(0, firstSp);
  if (!command) return { error: 'Line has no command.' };

  const params = [];
  let rest = firstSp === -1 ? '' : s.slice(firstSp + 1);

  // Parameters are space-separated, but the trailing (after " :") is one
  // token that may contain spaces and colons.
  while (rest.length > 0) {
    if (rest.startsWith(':')) {
      params.push(rest.slice(1));
      break;
    }
    const sp = rest.indexOf(' ');
    if (sp === -1) {
      params.push(rest);
      break;
    }
    params.push(rest.slice(0, sp));
    rest = rest.slice(sp + 1);
  }

  return { tags, prefix, command, params };
}

// ---------------------------------------------------------------------------
// IRC message serialisation
// ---------------------------------------------------------------------------

/**
 * Build one IRC line from its components.
 *
 * The last parameter receives a leading ':' when it contains a space or starts
 * with ':', because those are the cases where RFC 1459 requires it. All lines
 * end with CRLF, as the wire protocol demands.
 */
function serialise({ command, params = [], prefix } = {}) {
  const parts = [];
  if (prefix) parts.push(`:${prefix}`);
  parts.push(String(command).toUpperCase());

  if (params.length > 0) {
    for (let i = 0; i < params.length - 1; i++) {
      parts.push(String(params[i]));
    }
    const last = String(params[params.length - 1]);
    if (last === '' || last.includes(' ') || last.startsWith(':')) {
      parts.push(`:${last}`);
    } else {
      parts.push(last);
    }
  }

  return parts.join(' ') + '\r\n';
}

// ---------------------------------------------------------------------------
// Prefix utilities
// ---------------------------------------------------------------------------

/**
 * Extract the nick from a prefix string.
 *
 * A full user prefix looks like "nick!user@host"; a server prefix is just
 * "irc.server.net". This returns the part before the '!', or the whole string
 * when there is no '!'. Returns null for anything that looks wrong.
 */
function nickFromPrefix(prefix) {
  if (typeof prefix !== 'string' || !prefix) return null;
  const bang = prefix.indexOf('!');
  return bang === -1 ? prefix : prefix.slice(0, bang);
}

// ---------------------------------------------------------------------------
// CTCP
// ---------------------------------------------------------------------------

const CTCP_DELIMITER = '\x01';

/**
 * The CTCP commands this client will process.
 *
 * ACTION is how "/me" works and requires no reply — it is received and
 * rendered differently from a plain message. VERSION, PING, and TIME are
 * harmless to answer. Everything else is ignored to avoid leaking information
 * and to prevent CTCP flood attacks.
 */
const CTCP_ALLOWED = Object.freeze(['ACTION', 'VERSION', 'PING', 'TIME']);

/**
 * Extract a CTCP command and arguments from a PRIVMSG text body.
 *
 * Returns { command, args } when the text is a CTCP message, or null when it
 * is plain text. The closing \x01 is optional because some clients omit it;
 * both forms are accepted.
 */
function parseCTCP(text) {
  if (typeof text !== 'string') return null;
  if (!text.startsWith(CTCP_DELIMITER)) return null;

  // Find the closing \x01. Search backwards from the last character position
  // so the entire string is considered. The opening delimiter (always at index 0)
  // is distinguished from the closing one by the `end > 0` check below — if no
  // closing delimiter exists, lastIndexOf returns 0 (the opening one), and the
  // `end > 0` branch is skipped so the whole body is treated as unclosed.
  const end = text.length > 1 ? text.lastIndexOf(CTCP_DELIMITER, text.length - 1) : 0;
  const inner = end > 0 ? text.slice(1, end) : text.slice(1);
  if (!inner) return null;

  const sp = inner.indexOf(' ');
  const command = sp === -1 ? inner : inner.slice(0, sp);
  const args = sp === -1 ? '' : inner.slice(sp + 1);
  return { command: command.toUpperCase(), args };
}

/**
 * Wrap a command and optional arguments in CTCP delimiters.
 *
 * The result is the text body of a PRIVMSG or NOTICE. The caller supplies the
 * IRC command and target.
 */
function buildCTCPMessage(command, args) {
  const body = args ? `${command} ${args}` : command;
  return `${CTCP_DELIMITER}${body}${CTCP_DELIMITER}`;
}

// ---------------------------------------------------------------------------
// ICQ Status mapping
// ---------------------------------------------------------------------------

/**
 * Map an IRC user's state onto one of the fixed ICQ Statuses.
 *
 * IRC has three meaningful states: on the server and available (Online), AWAY
 * mode set (Away), or disconnected (Offline). The richer ICQ vocabulary — N/A,
 * Occupied, DND, Free For Chat, Invisible — has no IRC equivalent. Callers
 * use 'offline' directly when a user quits the server.
 */
function ircStatusToIcqStatus(isAway) {
  return isAway ? 'away' : 'online';
}

// ---------------------------------------------------------------------------
// Mode string handling
// ---------------------------------------------------------------------------

/**
 * The set of channel mode letters that consume a parameter on +, and on -.
 * Channel-wide flags like +t, +m, +n take no argument and are not tracked.
 */
const MODE_WITH_PARAM_ADD = new Set(['o', 'v', 'h', 'q', 'a', 'b', 'k', 'f', 'j', 'l']);
const MODE_WITH_PARAM_REMOVE = new Set(['o', 'v', 'h', 'q', 'a', 'b']);

/**
 * The prefix characters that appear before nicks in a NAMES reply, and the
 * mode letter each one corresponds to.
 */
const PREFIX_TO_MODE = Object.freeze({
  '~': 'q',
  '&': 'a',
  '@': 'o',
  '%': 'h',
  '+': 'v',
});

/**
 * Apply a mode string like "+ov-v" with its argument list to the members map.
 *
 * Only member-affecting modes (o, v, h, q, a) modify the map. Channel-wide
 * flags are consumed silently. An argument that names a nick not in the map
 * is ignored — the channel state may be stale, and refusing unknown nicks
 * would be worse than a harmless no-op.
 */
function applyModes(modeStr, modeArgs, members) {
  let adding = true;
  let argIdx = 0;
  for (const ch of modeStr) {
    if (ch === '+') { adding = true; continue; }
    if (ch === '-') { adding = false; continue; }
    const needsParam = adding ? MODE_WITH_PARAM_ADD.has(ch) : MODE_WITH_PARAM_REMOVE.has(ch);
    if (needsParam) {
      const target = modeArgs[argIdx++] || null;
      if (target && members && members.has(target)) {
        const member = members.get(target);
        if (adding) member.modes.add(ch);
        else member.modes.delete(ch);
      }
    }
  }
}

/**
 * Parse a space-separated nick list from a NAMES reply into the members map.
 *
 * Each entry may be prefixed by one or more mode characters (@, +, %, ~, &).
 * Nicks without a prefix get an empty mode set.
 */
function applyNickList(text, members) {
  for (const entry of text.split(' ').filter(Boolean)) {
    const modes = new Set();
    let i = 0;
    while (i < entry.length && PREFIX_TO_MODE[entry[i]]) {
      modes.add(PREFIX_TO_MODE[entry[i]]);
      i++;
    }
    const nick = entry.slice(i);
    if (nick) members.set(nick, { modes });
  }
}

// ---------------------------------------------------------------------------
// Channel state
// ---------------------------------------------------------------------------

/**
 * Deep-copy a members Map so that callers cannot accidentally reach back into
 * internal state by mutating a mode Set on an entry they received.
 *
 * The member values are plain objects `{ modes: Set }`. A shallow `new Map(src)`
 * copies the references, leaving the Sets shared between the snapshot and the
 * internal map. A MODE event arriving after the snapshot was taken would then
 * silently alter the snapshot too, and a caller mutating the snapshot would
 * corrupt the channel's own mode tracking. Deep-copying the Sets removes both
 * hazards at minimal cost — IRC channels rarely have more than a few hundred
 * members.
 */
function snapshotMembers(src) {
  return new Map(Array.from(src, ([nick, entry]) => [nick, { modes: new Set(entry.modes) }]));
}

/**
 * Create a channel state tracker for one IRC channel.
 *
 * In ISeekU terms a channel is a Chat, and the nicks of its members are the
 * Contact identifiers for that Chat — there are no numeric UINs on IRC.
 *
 * Call receive() with every parsed IRC message. It returns { events }, where
 * each event describes a change that the application should act on.
 *
 * Events emitted:
 *   { type: 'names', channel, members: Map }      full member list after NAMES
 *   { type: 'topic', channel, text }              topic received or changed
 *   { type: 'join',  channel, nick }              someone joined
 *   { type: 'part',  channel, nick, reason }      someone left voluntarily
 *   { type: 'kick',  channel, nick, by, reason }  someone was removed by an op
 *   { type: 'quit',  channel, nick, reason }      someone left the server
 *   { type: 'nick-changed', channel, oldNick, newNick }
 *   { type: 'mode',  channel, modes, args }       mode string applied
 *
 * The member list from the server arrives over multiple 353 (RPL_NAMREPLY)
 * lines followed by one 366 (RPL_ENDOFNAMES). Intermediate 353 lines are
 * buffered without updating the visible member map; the map is rebuilt in full
 * when 366 arrives. This means the map is always consistent with one complete
 * server reply rather than a half-assembled mix of old and new.
 */
function createChannel(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('createChannel requires a channel name.');
  }

  let topic = null;
  const members = new Map();
  // namesBuffer accumulates the nick-list strings from 353 replies. It is
  // cleared and applied only when 366 ends the exchange.
  const namesBuffer = [];
  const lcName = name.toLowerCase();

  function receive(parsed) {
    const events = [];
    if (!parsed || parsed.error || !parsed.command) return { events };

    const { command, params, prefix } = parsed;

    switch (command) {
      case '353': {
        // RPL_NAMREPLY: [me, chanType, channel, nickList]
        // nickList is the trailing and is therefore the last element of params.
        const chan = params[2] || '';
        if (chan.toLowerCase() === lcName) {
          namesBuffer.push(params[params.length - 1] || '');
        }
        break;
      }
      case '366': {
        // RPL_ENDOFNAMES: [me, channel, ...]
        const chan = params[1] || '';
        if (chan.toLowerCase() === lcName) {
          members.clear();
          for (const chunk of namesBuffer) applyNickList(chunk, members);
          namesBuffer.length = 0;
          events.push({ type: 'names', channel: name, members: snapshotMembers(members) });
        }
        break;
      }
      case '332': {
        // RPL_TOPIC, sent on join: [me, channel, topic]
        const chan = params[1] || '';
        if (chan.toLowerCase() === lcName) {
          topic = params[2] !== undefined ? params[2] : null;
          events.push({ type: 'topic', channel: name, text: topic });
        }
        break;
      }
      case 'TOPIC': {
        // Topic change during the session: [channel, newTopic]
        const chan = params[0] || '';
        if (chan.toLowerCase() === lcName) {
          topic = params[1] !== undefined ? params[1] : null;
          events.push({ type: 'topic', channel: name, text: topic });
        }
        break;
      }
      case 'JOIN': {
        const chan = params[0] || '';
        if (chan.toLowerCase() === lcName) {
          const nick = nickFromPrefix(prefix);
          if (nick) {
            if (!members.has(nick)) members.set(nick, { modes: new Set() });
            events.push({ type: 'join', channel: name, nick });
          }
        }
        break;
      }
      case 'PART': {
        const chan = params[0] || '';
        if (chan.toLowerCase() === lcName) {
          const nick = nickFromPrefix(prefix);
          if (nick) {
            members.delete(nick);
            events.push({ type: 'part', channel: name, nick, reason: params[1] || null });
          }
        }
        break;
      }
      case 'KICK': {
        const chan = params[0] || '';
        if (chan.toLowerCase() === lcName) {
          const target = params[1] || '';
          const by = nickFromPrefix(prefix);
          if (target) {
            members.delete(target);
            events.push({ type: 'kick', channel: name, nick: target, by, reason: params[2] || null });
          }
        }
        break;
      }
      case 'QUIT': {
        // QUIT is server-wide, not channel-specific. Remove the nick if present.
        const nick = nickFromPrefix(prefix);
        if (nick && members.has(nick)) {
          members.delete(nick);
          events.push({ type: 'quit', channel: name, nick, reason: params[0] || null });
        }
        break;
      }
      case 'NICK': {
        // Nick change: update the key in the members map without disturbing the
        // mode set the nick already had.
        const oldNick = nickFromPrefix(prefix);
        const newNick = params[0] || '';
        if (oldNick && newNick && members.has(oldNick)) {
          const entry = members.get(oldNick);
          members.delete(oldNick);
          members.set(newNick, entry);
          events.push({ type: 'nick-changed', channel: name, oldNick, newNick });
        }
        break;
      }
      case 'MODE': {
        const chan = params[0] || '';
        if (chan.toLowerCase() === lcName) {
          const modeStr = params[1] || '';
          const modeArgs = params.slice(2);
          applyModes(modeStr, modeArgs, members);
          events.push({ type: 'mode', channel: name, modes: modeStr, args: modeArgs });
        }
        break;
      }
      default:
        break;
    }

    return { events };
  }

  return {
    get name() { return name; },
    get topic() { return topic; },
    // Return a deep snapshot: nicks and their mode Sets are both copied, so
    // callers cannot reach back into internal state by mutating what they got.
    get members() { return snapshotMembers(members); },
    receive,
  };
}

// ---------------------------------------------------------------------------
// Session (registration handshake + PRIVMSG handling)
// ---------------------------------------------------------------------------

/** The version string returned in response to a CTCP VERSION request. */
const IRC_VERSION = 'ISeekU:1.0:Electron';

/**
 * Create a session state machine for one IRC connection.
 *
 * Call start() immediately after the TCP connection is open to get the NICK
 * and USER lines to send. Pass every incoming line to receive(); it returns
 * { send, events } where send is an array of lines to write to the socket and
 * events is an array of application-level events.
 *
 * Events emitted by receive():
 *   { type: 'welcome',      nick }                 registration accepted (001)
 *   { type: 'nick-changed', nick, reason }         'collision' during reg, or 'server' after
 *   { type: 'message',      from, to, text, isAction }  PRIVMSG or CTCP ACTION
 *   { type: 'notice',       from, to, text }       NOTICE
 *   { type: 'ctcp-request', command, args, from }  answered CTCP request (VERSION, PING, TIME)
 */
function createSession({ nick, username, realname } = {}) {
  if (!nick || typeof nick !== 'string') {
    throw new Error('createSession requires a nick (non-empty string).');
  }
  if (!username || typeof username !== 'string') {
    throw new Error('createSession requires a username (non-empty string).');
  }
  if (!realname || typeof realname !== 'string') {
    throw new Error('createSession requires a realname (non-empty string).');
  }

  let state = 'registering';
  let currentNick = nick;

  /**
   * Returns the two lines that open an IRC connection: NICK followed by USER.
   *
   * USER format is: USER <username> <mode> <unused> :<realname>
   * Mode '0' requests no invisible flag and no wallops — a safe default.
   */
  function start() {
    return [
      serialise({ command: 'NICK', params: [currentNick] }),
      serialise({ command: 'USER', params: [username, '0', '*', realname] }),
    ];
  }

  /**
   * Process one incoming line. Returns { send, events }.
   *
   * send is an array of complete IRC lines ready to write to the socket.
   * events is an array of application-level events for the bridge to act on.
   */
  function receive(line) {
    const parsed = parse(line);
    const send = [];
    const events = [];

    if (!parsed || parsed.error || !parsed.command) return { send, events };

    const { command, params, prefix } = parsed;

    // PING can arrive at any time — even during registration, before 001 —
    // and must be answered immediately. A missed PING means disconnection.
    if (command === 'PING') {
      // Echo the params back verbatim. Some servers use the PONG token to
      // route the reply correctly; sending something different breaks them.
      send.push(serialise({ command: 'PONG', params }));
      return { send, events };
    }

    if (state === 'registering') {
      if (command === '001') {
        // The server tells us our confirmed nick in params[0]. Take it verbatim
        // because the server may have adjusted the case.
        currentNick = params[0] || currentNick;
        state = 'registered';
        events.push({ type: 'welcome', nick: currentNick });
      } else if (command === '433') {
        // ERR_NICKNAMEINUSE: append '_' and try again. A busy server may
        // refuse several times in a row; each refusal produces another attempt.
        currentNick = currentNick + '_';
        send.push(serialise({ command: 'NICK', params: [currentNick] }));
        events.push({ type: 'nick-changed', nick: currentNick, reason: 'collision' });
      }
      return { send, events };
    }

    // --- Registered state ---

    if (command === 'PRIVMSG') {
      const from = nickFromPrefix(prefix);
      const to = params[0] || '';
      const text = params[1] || '';
      const ctcp = parseCTCP(text);

      if (ctcp) {
        if (ctcp.command === 'ACTION') {
          // ACTION is how "/me" works. It is received and rendered differently
          // from a plain message but never generates a reply.
          events.push({ type: 'message', from, to, text: ctcp.args, isAction: true });
        } else if (ctcp.command === 'VERSION') {
          const reply = buildCTCPMessage('VERSION', IRC_VERSION);
          if (from) send.push(serialise({ command: 'NOTICE', params: [from, reply] }));
          events.push({ type: 'ctcp-request', command: 'VERSION', args: ctcp.args, from });
        } else if (ctcp.command === 'PING') {
          // Echo the args so the requester can measure round-trip time.
          const reply = buildCTCPMessage('PING', ctcp.args);
          if (from) send.push(serialise({ command: 'NOTICE', params: [from, reply] }));
          events.push({ type: 'ctcp-request', command: 'PING', args: ctcp.args, from });
        } else if (ctcp.command === 'TIME') {
          const reply = buildCTCPMessage('TIME', new Date().toUTCString());
          if (from) send.push(serialise({ command: 'NOTICE', params: [from, reply] }));
          events.push({ type: 'ctcp-request', command: 'TIME', args: ctcp.args, from });
        }
        // Every other CTCP command: silently ignored, no reply, no event.
      } else {
        events.push({ type: 'message', from, to, text, isAction: false });
      }
    } else if (command === 'NOTICE') {
      const from = nickFromPrefix(prefix) || prefix;
      const to = params[0] || '';
      const text = params[1] || '';
      events.push({ type: 'notice', from, to, text });
    } else if (command === 'NICK') {
      // A server-driven nick change that affects our own nick.
      const oldNick = nickFromPrefix(prefix);
      const newNick = params[0] || '';
      if (oldNick && oldNick === currentNick && newNick) {
        currentNick = newNick;
        events.push({ type: 'nick-changed', nick: newNick, reason: 'server' });
      }
    }

    return { send, events };
  }

  return {
    get nick() { return currentNick; },
    get state() { return state; },
    start,
    receive,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parse,
  serialise,
  nickFromPrefix,
  parseCTCP,
  buildCTCPMessage,
  ircStatusToIcqStatus,
  createSession,
  createChannel,
  CTCP_ALLOWED,
  PREFIX_TO_MODE,
};
