#!/usr/bin/env node
/**
 * Probe an XMPP server for the capabilities ISeekU needs.
 *
 * Signs in, asks the server what it supports, writes the answer to JSON, and
 * signs out. Nothing is sent, nothing is changed, nothing is stored.
 *
 * Usage:
 *   node tools/probe-server.js --uin 123456789 --server 132.145.202.182
 *   node tools/probe-server.js --uin 123456789 --server 132.145.202.182 --out probe.json
 *
 * The password is read from the terminal (hidden) or from the ISEEKU_PROBE_PASSWORD
 * environment variable. It is never written to the output file, never logged, and
 * never included in the stanza trace.
 *
 * ponytail: raw sockets + regex stanza matching, no XMPP library. This runs before
 * we pick one, and a dependency-free probe is a thing anyone can run to debug a
 * server without installing the app.
 */

'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const readline = require('readline');

const DEFAULT_PORT = 5222;
const TIMEOUT_MS = 20000;

// --- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, out: 'server-probe.json', trace: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--uin': args.uin = next(); break;
      case '--server': args.server = next(); break;
      case '--domain': args.domain = next(); break;
      case '--port': args.port = Number(next()); break;
      case '--out': args.out = next(); break;
      case '--trace': args.trace = true; break;
      case '--help': args.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  // The icqr.net server uses its own IP as the XMPP domain, so domain defaults
  // to server rather than being derived from it.
  if (!args.domain) args.domain = args.server;
  return args;
}

const USAGE = `
Probe an XMPP server for ISeekU compatibility.

  --uin <n>        the account localpart to sign in as       (required)
  --server <host>  host to connect to                        (required)
  --domain <name>  XMPP domain, if it differs from --server  (default: --server)
  --port <n>       port                                      (default: ${DEFAULT_PORT})
  --out <file>     where to write the report                 (default: server-probe.json)
  --trace          include the full stanza trace in the report
  --help           this text

Password: read from the ISEEKU_PROBE_PASSWORD environment variable, or prompted
for on the terminal. It never appears in the output.
`.trim();

// --- password input ---------------------------------------------------------

function promptPassword(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No terminal available. Set ISEEKU_PROBE_PASSWORD instead.'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Echo the prompt but nothing the user types.
    let promptWritten = false;
    rl._writeToOutput = (chunk) => {
      if (!promptWritten && chunk.startsWith(prompt)) {
        rl.output.write(prompt);
        promptWritten = true;
      }
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// --- minimal stanza handling ------------------------------------------------

const escapeXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Pull the attribute values of every `<tag ... attr='X'>` in a stanza. */
function collectAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=(['"])(.*?)\\1`, 'g');
  const found = [];
  let m;
  while ((m = re.exec(xml)) !== null) found.push(m[2]);
  return found;
}

/** Pull the text content of every `<tag>text</tag>` in a stanza. */
function collectText(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const found = [];
  let m;
  while ((m = re.exec(xml)) !== null) found.push(m[1].trim());
  return found;
}

/**
 * Split a buffer into complete top-level stanzas.
 * Returns the stanzas found and whatever trailing partial text is left over.
 */
function drainStanzas(buffer) {
  const stanzas = [];
  let rest = buffer;
  for (;;) {
    const start = rest.indexOf('<');
    if (start === -1) break;
    // Opening tag name of the next stanza.
    const nameMatch = /^<([a-zA-Z0-9_:-]+)/.exec(rest.slice(start));
    if (!nameMatch) break;
    const name = nameMatch[1];

    const selfClose = new RegExp(`^<${name}\\b[^>]*/>`).exec(rest.slice(start));
    if (selfClose) {
      stanzas.push(selfClose[0]);
      rest = rest.slice(start + selfClose[0].length);
      continue;
    }
    const closeTag = `</${name}>`;
    const closeAt = rest.indexOf(closeTag, start);
    if (closeAt === -1) break; // incomplete — wait for more data
    const end = closeAt + closeTag.length;
    stanzas.push(rest.slice(start, end));
    rest = rest.slice(end);
  }
  return { stanzas, rest };
}

// --- the probe ---------------------------------------------------------------

/**
 * A tiny request/response XMPP client. Each `iq()` call resolves with the
 * matching result stanza, so the probe reads as a straight list of questions.
 */
class Probe {
  constructor({ server, port, domain, uin, password, trace }) {
    Object.assign(this, { server, port, domain, uin, password, trace });
    this.socket = null;
    this.buffer = '';
    this.pending = new Map();
    this.trace_ = [];
    this.stanzaHandlers = [];
    this.seq = 0;
  }

  streamHeader() {
    return `<?xml version='1.0'?><stream:stream to='${escapeXml(this.domain)}' `
      + `xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>`;
  }

  send(xml) {
    // Never let a password reach the trace, even if a future caller sends one.
    this.trace_.push({ dir: 'out', xml: xml.replace(/(<auth[^>]*>)[^<]*/g, '$1<REDACTED>') });
    this.socket.write(xml);
  }

  /** Resolve on the next stanza matching `predicate`, or reject on timeout. */
  await_(predicate, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stanzaHandlers = this.stanzaHandlers.filter((h) => h.handler !== handler);
        reject(new Error(`Timed out waiting for ${what}`));
      }, TIMEOUT_MS);
      const handler = (xml) => {
        if (!predicate(xml)) return false;
        clearTimeout(timer);
        resolve(xml);
        return true;
      };
      this.stanzaHandlers.push({ handler });
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    // The stream header never closes, so drop it before looking for stanzas.
    const headerEnd = this.buffer.indexOf('<stream:stream');
    if (headerEnd !== -1) {
      const gt = this.buffer.indexOf('>', headerEnd);
      if (gt !== -1) this.buffer = this.buffer.slice(0, headerEnd) + this.buffer.slice(gt + 1);
    }
    const { stanzas, rest } = drainStanzas(this.buffer);
    this.buffer = rest;
    for (const xml of stanzas) {
      this.trace_.push({ dir: 'in', xml });
      this.stanzaHandlers = this.stanzaHandlers.filter(({ handler }) => !handler(xml));
    }
  }

  async connect() {
    this.socket = net.connect(this.port, this.server);
    this.socket.setEncoding('utf8');
    this.socket.on('data', (c) => this.onData(c));
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('error', () => {}); // surfaced through the awaiters instead
    this.send(this.streamHeader());
    return this.await_((x) => x.includes('</stream:features>') || x.includes('<stream:features/>'), 'stream features');
  }

  /** Upgrade to TLS if offered. Returns the negotiated protocol, or null. */
  async maybeStartTls(features) {
    if (!features.includes('urn:ietf:params:xml:ns:xmpp-tls')) return null;
    this.send("<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>");
    await this.await_((x) => x.includes('<proceed'), 'STARTTLS proceed');
    const plain = this.socket;
    plain.removeAllListeners('data');
    this.buffer = '';
    this.socket = tls.connect({
      socket: plain,
      servername: this.domain,
      // The icqr.net domain is an IP literal, so a name check cannot pass. The
      // certificate is reported in full instead, for a human to judge.
      rejectUnauthorized: false,
    });
    this.socket.setEncoding('utf8');
    this.socket.on('data', (c) => this.onData(c));
    this.socket.on('error', () => {});
    await new Promise((resolve, reject) => {
      this.socket.once('secureConnect', resolve);
      this.socket.once('error', reject);
    });
    const cert = this.socket.getPeerCertificate();
    const info = {
      protocol: this.socket.getProtocol(),
      cipher: this.socket.getCipher() && this.socket.getCipher().name,
      authorized: this.socket.authorized,
      authorizationError: String(this.socket.authorizationError || ''),
      subject: cert && cert.subject,
      issuer: cert && cert.issuer,
      subjectaltname: cert && cert.subjectaltname,
      valid_from: cert && cert.valid_from,
      valid_to: cert && cert.valid_to,
    };
    this.send(this.streamHeader());
    await this.await_((x) => x.includes('</stream:features>') || x.includes('<stream:features/>'), 'post-TLS features');
    return info;
  }

  async authenticatePlain() {
    const payload = Buffer.from(`\0${this.uin}\0${this.password}`, 'utf8').toString('base64');
    this.socket.write(`<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>${payload}</auth>`);
    this.trace_.push({ dir: 'out', xml: "<auth mechanism='PLAIN'><REDACTED></auth>" });
    const reply = await this.await_((x) => x.includes('<success') || x.includes('<failure'), 'SASL reply');
    if (reply.includes('<failure')) throw new Error(`Authentication refused: ${reply}`);
    this.buffer = '';
    this.send(this.streamHeader());
    return this.await_((x) => x.includes('</stream:features>') || x.includes('<stream:features/>'), 'post-auth features');
  }

  async bind(resource) {
    const id = `bind-${this.seq += 1}`;
    this.send(`<iq type='set' id='${id}'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'>`
      + `<resource>${escapeXml(resource)}</resource></bind></iq>`);
    const res = await this.await_((x) => x.includes(`id='${id}'`) || x.includes(`id="${id}"`), 'resource bind');
    return (collectText(res, 'jid')[0]) || null;
  }

  async iq(what, { type = 'get', to, body }) {
    const id = `${what}-${this.seq += 1}`;
    const target = to ? ` to='${escapeXml(to)}'` : '';
    this.send(`<iq type='${type}' id='${id}'${target}>${body}</iq>`);
    try {
      return await this.await_((x) => x.startsWith('<iq') && (x.includes(`id='${id}'`) || x.includes(`id="${id}"`)), what);
    } catch (err) {
      return `<error reason='${escapeXml(err.message)}'/>`;
    }
  }

  close() {
    try { this.socket.write('</stream:stream>'); this.socket.end(); } catch { /* already gone */ }
  }
}

// --- report -----------------------------------------------------------------

const XEP_NAMES = {
  'jabber:iq:roster': 'Contact List (RFC 6121 roster)',
  'jabber:iq:register': 'XEP-0077 In-Band Registration — create a UIN in-client',
  'jabber:iq:privacy': 'XEP-0016 Privacy Lists — Visible/Invisible/Ignore lists',
  'urn:xmpp:blocking': 'XEP-0191 Blocking — Ignore List',
  'vcard-temp': 'vcard-temp — User Details',
  'vcard-temp:x:update': 'XEP-0153 vCard Avatars',
  'jabber:iq:last': 'XEP-0012 Last Activity — Last Seen',
  'jabber:iq:version': 'XEP-0092 Software Version',
  'jabber:iq:time': 'XEP-0202 Entity Time',
  'urn:xmpp:ping': 'XEP-0199 Ping — keepalive',
  'urn:xmpp:time': 'XEP-0202 Entity Time',
  'http://jabber.org/protocol/disco#info': 'XEP-0030 Service Discovery',
  'http://jabber.org/protocol/muc': 'XEP-0045 Multi-User Chat — ICQ chat rooms',
  'http://jabber.org/protocol/chatstates': 'XEP-0085 Chat States — Typing Notification',
  'urn:xmpp:receipts': 'XEP-0184 Delivery Receipts',
  'urn:xmpp:delay': 'XEP-0203 Delayed Delivery — Offline Message timestamps',
  'urn:xmpp:carbons:2': 'XEP-0280 Message Carbons — multi-device sync',
  'urn:xmpp:mam:2': 'XEP-0313 Message Archive Management — server-side History',
  'urn:xmpp:http:upload:0': 'XEP-0363 HTTP File Upload — File Transfer',
  'urn:xmpp:http:upload': 'XEP-0363 HTTP File Upload (legacy namespace)',
  'jabber:iq:search': 'XEP-0055 Jabber Search — Search by detail',
  'msgoffline': 'XEP-0160 Offline Message storage',
  'http://jabber.org/protocol/pubsub': 'XEP-0060 PubSub',
  'urn:xmpp:sm:3': 'XEP-0198 Stream Management — resumable connections',
  'urn:xmpp:push:0': 'XEP-0357 Push Notifications',
  'http://jabber.org/protocol/bytestreams': 'XEP-0065 SOCKS5 Bytestreams — direct File Transfer',
  'http://jabber.org/protocol/ibb': 'XEP-0047 In-Band Bytestreams — fallback File Transfer',
  'http://jabber.org/protocol/commands': 'XEP-0050 Ad-Hoc Commands',
  'jabber:x:conference': 'XEP-0249 Direct MUC Invitations',
};

function describe(features) {
  return features.map((ns) => ({ namespace: ns, meaning: XEP_NAMES[ns] || null }));
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help || !args.uin || !args.server) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 2);
  }

  const password = process.env.ISEEKU_PROBE_PASSWORD
    || await promptPassword(`Password for ${args.uin}@${args.domain} (not stored, not logged): `);
  if (!password) {
    console.error('No password given.');
    process.exit(2);
  }

  const report = {
    probedAt: new Date().toISOString(),
    target: { server: args.server, port: args.port, domain: args.domain, uin: args.uin },
  };
  const probe = new Probe({ ...args, password });

  try {
    console.log(`Connecting to ${args.server}:${args.port} ...`);
    const features = await probe.connect();
    report.streamFeatures = {
      raw: features,
      offersStartTls: features.includes('urn:ietf:params:xml:ns:xmpp-tls'),
      startTlsRequired: /<starttls[^>]*>[\s\S]*?<required\s*\/>/.test(features),
      saslMechanisms: collectText(features, 'mechanism'),
      offersInBandRegistration: features.includes('http://jabber.org/features/iq-register'),
      offersStreamManagement: features.includes('urn:xmpp:sm:3'),
    };

    report.tls = await probe.maybeStartTls(features);
    report.transportSecurity = report.tls
      ? 'encrypted (STARTTLS negotiated)'
      : 'CLEARTEXT — no STARTTLS offered; credentials and messages travel unencrypted';
    if (!report.tls) console.warn('  ! Server offers no STARTTLS. This connection is unencrypted.');

    console.log('Authenticating ...');
    await probe.authenticatePlain();
    const jid = await probe.bind(`ISeekU-probe`);
    report.boundJid = jid;
    console.log(`  bound as ${jid}`);

    // Session establishment is obsolete but old servers still demand it.
    await probe.iq('session', { type: 'set', body: "<session xmlns='urn:ietf:params:xml:ns:xmpp-session'/>" });

    console.log('Asking what the server supports ...');
    const discoInfo = await probe.iq('disco-info', {
      to: args.domain, body: "<query xmlns='http://jabber.org/protocol/disco#info'/>",
    });
    report.server = {
      identities: collectAttr(discoInfo, 'identity', 'name'),
      categories: collectAttr(discoInfo, 'identity', 'category'),
      types: collectAttr(discoInfo, 'identity', 'type'),
      features: describe(collectAttr(discoInfo, 'feature', 'var')),
    };

    const discoItems = await probe.iq('disco-items', {
      to: args.domain, body: "<query xmlns='http://jabber.org/protocol/disco#items'/>",
    });
    const componentJids = collectAttr(discoItems, 'item', 'jid');
    report.components = [];
    for (const componentJid of componentJids) {
      const info = await probe.iq('disco-component', {
        to: componentJid, body: "<query xmlns='http://jabber.org/protocol/disco#info'/>",
      });
      report.components.push({
        jid: componentJid,
        identities: collectAttr(info, 'identity', 'name'),
        types: collectAttr(info, 'identity', 'type'),
        features: describe(collectAttr(info, 'feature', 'var')),
      });
    }

    const version = await probe.iq('version', { to: args.domain, body: "<query xmlns='jabber:iq:version'/>" });
    report.serverSoftware = {
      name: collectText(version, 'name')[0] || null,
      version: collectText(version, 'version')[0] || null,
      os: collectText(version, 'os')[0] || null,
    };

    // Own account capabilities: what the server lets *us* do.
    const selfDisco = await probe.iq('disco-self', {
      to: jid && jid.split('/')[0], body: "<query xmlns='http://jabber.org/protocol/disco#info'/>",
    });
    report.account = { features: describe(collectAttr(selfDisco, 'feature', 'var')) };

    const roster = await probe.iq('roster', { body: "<query xmlns='jabber:iq:roster'/>" });
    report.contactList = {
      count: collectAttr(roster, 'item', 'jid').length,
      groups: [...new Set(collectText(roster, 'group'))],
      // Addresses are the Owner's own data — count and group names are enough
      // to verify the shape without copying the contact list into a report.
      subscriptionStates: collectAttr(roster, 'item', 'subscription'),
    };

    const privacy = await probe.iq('privacy', { body: "<query xmlns='jabber:iq:privacy'/>" });
    report.privacyLists = {
      supported: !privacy.includes('service-unavailable') && !privacy.includes("type='error'"),
      names: collectAttr(privacy, 'list', 'name'),
    };

    const blocking = await probe.iq('blocklist', { body: "<blocklist xmlns='urn:xmpp:blocking'/>" });
    report.blocking = {
      supported: !blocking.includes('service-unavailable') && !blocking.includes("type='error'"),
      count: collectAttr(blocking, 'item', 'jid').length,
    };

    const search = await probe.iq('search', { to: args.domain, body: "<query xmlns='jabber:iq:search'/>" });
    report.userSearch = {
      supportedOnDomain: !search.includes('service-unavailable') && !search.includes("type='error'"),
    };

    if (args.trace) report.trace = probe.trace_;
    report.result = 'ok';
  } catch (err) {
    report.result = 'failed';
    report.error = err.message;
    if (args.trace) report.trace = probe.trace_;
    console.error(`\nProbe failed: ${err.message}`);
  } finally {
    probe.close();
  }

  fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${args.out}`);

  // Human-readable summary.
  if (report.result === 'ok') {
    const supported = report.server.features.filter((f) => f.meaning).map((f) => f.meaning);
    console.log(`\nTransport security : ${report.transportSecurity}`);
    console.log(`Server software    : ${report.serverSoftware.name || 'not advertised'} ${report.serverSoftware.version || ''}`);
    console.log(`Contact List       : ${report.contactList.count} contacts in groups [${report.contactList.groups.join(', ') || 'none'}]`);
    console.log(`Components         : ${report.components.map((c) => c.jid).join(', ') || 'none'}`);
    console.log(`\nSupported, that we care about:`);
    for (const s of supported) console.log(`  + ${s}`);
    const missing = Object.values(XEP_NAMES).filter((m) => !supported.includes(m));
    console.log(`\nNot advertised by the domain (may still live on a component):`);
    for (const m of missing) console.log(`  - ${m}`);
  }

  process.exit(report.result === 'ok' ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

// Exported for the unit tests. The stanza helpers are the only non-obvious
// logic here; everything else is I/O.
module.exports = { parseArgs, drainStanzas, collectAttr, collectText, escapeXml };
