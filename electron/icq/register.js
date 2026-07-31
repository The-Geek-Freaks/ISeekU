/**
 * Getting a UIN (XEP-0077 In-Band Registration).
 *
 * Registration happens before there is an account to authenticate as, so it
 * runs on its own short-lived stream and never touches the connection layer.
 * @xmpp/client is built around authenticating, which makes it the wrong tool
 * here; a raw stream is both shorter and easier to be sure about.
 *
 * The same warning applies as everywhere else: on a server with no encryption,
 * the password chosen here crosses the network in readable form. The caller
 * must have obtained the Owner's consent before calling, and `allowInsecure`
 * makes that consent explicit rather than assumed.
 */

'use strict';

const net = require('net');
const tls = require('tls');

const DEFAULT_PORT = 5222;
const TIMEOUT_MS = 20000;
const REGISTER_NS = 'jabber:iq:register';
const TLS_NS = 'urn:ietf:params:xml:ns:xmpp-tls';

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Text content of the first `<tag>` in a fragment, or null. */
function textOf(xml, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/** Names of the fields the server is asking for. */
function fieldsOf(queryXml) {
  const known = ['username', 'password', 'email', 'nick', 'name', 'first', 'last'];
  return known.filter((f) => new RegExp(`<${f}\\s*/>|<${f}\\b[^>]*>`).test(queryXml));
}

class RegistrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RegistrationError';
    this.code = code;
  }
}

/**
 * Ask a server what it needs in order to create an account.
 * Returns { fields, instructions, encrypted }.
 */
function inspect({ server, port = DEFAULT_PORT, domain = server }) {
  return withStream({ server, port, domain }, async (stream) => {
    const reply = await stream.iq(`<query xmlns='${REGISTER_NS}'/>`, 'get');
    if (reply.includes("type='error'")) {
      throw new RegistrationError('This server does not allow new accounts to be created here.', 'REGISTRATION_CLOSED');
    }
    return {
      fields: fieldsOf(reply),
      instructions: textOf(reply, 'instructions'),
      encrypted: stream.encrypted,
      // A server that already knows this account sends back the current data.
      alreadyRegistered: reply.includes('<registered'),
    };
  });
}

/**
 * Create an account.
 *
 * @param {object}  opts
 * @param {string}  opts.username       the UIN to claim
 * @param {string}  opts.password
 * @param {boolean} opts.allowInsecure  the Owner accepted an unencrypted server
 * @returns {Promise<{uin: string, encrypted: boolean}>}
 */
function register({ server, port = DEFAULT_PORT, domain = server, username, password, email, allowInsecure = false }) {
  if (!username || !password) throw new RegistrationError('A UIN and a password are required.', 'MISSING_FIELDS');

  return withStream({ server, port, domain }, async (stream) => {
    if (!stream.encrypted && !allowInsecure) {
      throw new RegistrationError(
        `${server} offers no encryption. The password you choose would be sent in readable `
        + 'form over the network. Continue only if you accept that.',
        'INSECURE_SERVER',
      );
    }

    // Ask first: a server that refuses registration should be found out before
    // a password is composed into a stanza.
    const form = await stream.iq(`<query xmlns='${REGISTER_NS}'/>`, 'get');
    if (form.includes("type='error'")) {
      throw new RegistrationError('This server does not allow new accounts to be created here.', 'REGISTRATION_CLOSED');
    }

    const fields = [
      `<username>${escapeXml(username)}</username>`,
      `<password>${escapeXml(password)}</password>`,
      email ? `<email>${escapeXml(email)}</email>` : '',
    ].join('');

    const reply = await stream.iq(`<query xmlns='${REGISTER_NS}'>${fields}</query>`, 'set');
    if (reply.includes("type='error'")) {
      if (reply.includes('<conflict')) {
        throw new RegistrationError(`UIN ${username} is already taken. Choose another.`, 'UIN_TAKEN');
      }
      if (reply.includes('<not-acceptable')) {
        throw new RegistrationError('The server refused these details.', 'NOT_ACCEPTABLE');
      }
      throw new RegistrationError(`The server refused to create the account: ${textOf(reply, 'text') || 'no reason given'}`, 'REFUSED');
    }
    return { uin: username, encrypted: stream.encrypted };
  });
}

// --- the short-lived stream --------------------------------------------------

/** Open a stream, run `body`, and always close it. */
async function withStream({ server, port, domain }, body) {
  const stream = new Stream({ server, port, domain });
  try {
    await stream.open();
    return await body(stream);
  } finally {
    stream.close();
  }
}

class Stream {
  constructor({ server, port, domain }) {
    Object.assign(this, { server, port, domain });
    this.socket = null;
    this.buffer = '';
    this.encrypted = false;
    this.seq = 0;
    this.waiters = [];
  }

  header() {
    return `<?xml version='1.0'?><stream:stream to='${escapeXml(this.domain)}' `
      + `xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>`;
  }

  attach(socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this.waiters = this.waiters.filter(({ test, resolve }) => {
        if (!test(this.buffer)) return true;
        resolve(this.buffer);
        this.buffer = '';
        return false;
      });
    });
    socket.on('error', () => {});
  }

  until(test, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new RegistrationError(`The server did not answer (${what}).`, 'TIMEOUT'));
      }, TIMEOUT_MS);
      const wrapped = (value) => { clearTimeout(timer); resolve(value); };
      this.waiters.push({ test, resolve: wrapped });
      // The data may already be buffered.
      if (test(this.buffer)) {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        wrapped(this.buffer);
        this.buffer = '';
      }
    });
  }

  async open() {
    const plain = net.connect(this.port, this.server);
    await new Promise((resolve, reject) => {
      plain.once('connect', resolve);
      plain.once('error', () => reject(new RegistrationError(`Could not reach ${this.server}:${this.port}.`, 'UNREACHABLE')));
    });
    this.attach(plain);
    plain.write(this.header());
    const features = await this.until((b) => b.includes('</stream:features>') || b.includes('<stream:features/>'), 'stream features');

    if (features.includes(TLS_NS)) {
      plain.write(`<starttls xmlns='${TLS_NS}'/>`);
      await this.until((b) => b.includes('<proceed') || b.includes('<failure'), 'STARTTLS');
      plain.removeAllListeners('data');
      const secure = tls.connect({
        socket: plain,
        servername: this.domain,
        // The domain may be an IP literal, where a name check cannot pass.
        // The connection is still encrypted, which is what matters here.
        rejectUnauthorized: false,
      });
      await new Promise((resolve, reject) => {
        secure.once('secureConnect', resolve);
        secure.once('error', () => reject(new RegistrationError('Encryption could not be established.', 'TLS_FAILED')));
      });
      this.attach(secure);
      this.encrypted = true;
      secure.write(this.header());
      await this.until((b) => b.includes('</stream:features>') || b.includes('<stream:features/>'), 'features after encryption');
    }
  }

  async iq(childXml, type) {
    const id = `reg-${this.seq += 1}`;
    this.socket.write(`<iq type='${type}' id='${id}' to='${escapeXml(this.domain)}'>${childXml}</iq>`);
    return this.until((b) => b.includes(`id='${id}'`) || b.includes(`id="${id}"`), `reply to ${type}`);
  }

  close() {
    if (!this.socket) return;
    try {
      this.socket.write('</stream:stream>');
      this.socket.end();
    } catch {
      // Already gone.
    }
    this.socket = null;
  }
}

module.exports = { register, inspect, RegistrationError, fieldsOf, textOf, escapeXml };
