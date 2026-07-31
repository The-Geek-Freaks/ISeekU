#!/usr/bin/env node
/**
 * Sign in to an ICQ server, show the Contact List, and stay online printing
 * everything that arrives. Proves the connection layer works before any of the
 * interface exists.
 *
 * Usage:
 *   node tools/icq-smoke.js --uin 265019842 --server 132.145.202.182 --insecure
 *   node tools/icq-smoke.js --uin 265019842 --server 132.145.202.182 --insecure --send 12345 "hello"
 *
 * --insecure is required for icqr.net and the run says why. Without it the
 * connection is refused before the password is sent — the same rule the app
 * itself applies.
 *
 * The password comes from ISEEKU_PASSWORD or the terminal. It is never printed,
 * never written to a file, and never appears in the stanza log.
 */

'use strict';

const readline = require('readline');
const { IcqConnection } = require('../electron/icq/client');
const { fromPresence, statusMenu } = require('../electron/lib/icq-presence');

const USAGE = `
Sign in to an ICQ server and watch what happens.

  --uin <n>        your UIN                                  (required)
  --server <host>  server address                            (required)
  --domain <name>  XMPP domain, if it differs from --server  (default: --server)
  --port <n>       port                                      (default: 5222)
  --insecure       accept a server that has no encryption    (icqr.net needs this)
  --status <name>  Status to sign in with                    (default: online)
  --send <uin> <text>   send one message after signing in, then keep listening
  --seconds <n>    how long to stay online                   (default: 60)
  --help           this text

Statuses: ${statusMenu().map((s) => s.name).join(', ')}

Password: from ISEEKU_PASSWORD, or asked for on the terminal. Never printed.
`.trim();

function parseArgs(argv) {
  const args = { port: 5222, insecure: false, status: 'online', seconds: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--uin': args.uin = next(); break;
      case '--server': args.server = next(); break;
      case '--domain': args.domain = next(); break;
      case '--port': args.port = Number(next()); break;
      case '--status': args.status = next(); break;
      case '--seconds': args.seconds = Number(next()); break;
      case '--insecure': args.insecure = true; break;
      case '--send': args.sendTo = next(); args.sendText = next(); break;
      case '--help': args.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.domain) args.domain = args.server;
  return args;
}

function promptPassword(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No terminal available. Set ISEEKU_PASSWORD instead.'));
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
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

const clock = () => new Date().toISOString().slice(11, 19);
const say = (...parts) => console.log(`[${clock()}]`, ...parts);

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

  const password = process.env.ISEEKU_PASSWORD
    || await promptPassword(`Password for UIN ${args.uin} (not stored, not logged): `);
  if (!password) {
    console.error('No password given.');
    process.exit(2);
  }

  const connection = new IcqConnection({
    server: args.server,
    port: args.port,
    domain: args.domain,
    uin: args.uin,
    password,
    resource: `ISeekU-${require('os').hostname()}`,
    allowInsecure: args.insecure,
  });

  connection.on('status', (s) => say('status:', s));
  connection.on('insecure', ({ server, mechanism }) => {
    say(`!! UNENCRYPTED: ${server} offers no TLS. Authenticating with ${mechanism}.`);
    say('!! Your password and every message travel in readable form.');
  });
  connection.on('error', (err) => say('error:', err.message));
  connection.on('offline', ({ willReconnect }) => say('offline. reconnecting:', willReconnect));

  let jid;
  try {
    const result = await connection.start();
    jid = result.jid;
    say(`online as ${jid} (encrypted: ${result.secure})`);
  } catch (err) {
    say('could not sign in:', err.message);
    if (err.code === 'INSECURE_SERVER') {
      say('Pass --insecure to accept this, if you trust the network you are on.');
    }
    process.exit(1);
  }

  const { xml } = await import('@xmpp/client');

  // The Contact List.
  try {
    const roster = await connection.entity.iqCaller.get(xml('query', 'jabber:iq:roster'));
    const items = roster.getChildren('item');
    say(`Contact List: ${items.length} contacts`);
    for (const item of items) {
      const groups = item.getChildren('group').map((g) => g.text()).join(', ') || 'General';
      say(`  ${item.attrs.jid}  "${item.attrs.name || ''}"  [${groups}]  sub=${item.attrs.subscription}`);
    }
  } catch (err) {
    say('could not read the Contact List:', err.message);
  }

  // What the server can do.
  try {
    const info = await connection.entity.iqCaller.get(
      xml('query', 'http://jabber.org/protocol/disco#info'), args.domain,
    );
    const features = info.getChildren('feature').map((f) => f.attrs.var).sort();
    say(`server advertises ${features.length} features:`);
    for (const f of features) say(`  ${f}`);
  } catch (err) {
    say('could not read server features:', err.message);
  }

  // Announce our Status.
  const { toPresence } = require('../electron/lib/icq-presence');
  const wanted = toPresence(args.status, { statusText: 'ISeekU smoke test' });
  const presence = xml('presence', wanted.type ? { type: wanted.type } : {});
  if (wanted.show) presence.append(xml('show', {}, wanted.show));
  if (wanted.status) presence.append(xml('status', {}, wanted.status));
  await connection.send(presence);
  say(`published Status: ${args.status}`);

  // Watch everything that arrives.
  connection.on('stanza', (stanza) => {
    if (stanza.is('message')) {
      const body = stanza.getChildText('body');
      if (body) say(`MESSAGE from ${stanza.attrs.from}: ${body}`);
      if (stanza.getChild('composing')) say(`  ${stanza.attrs.from} is typing`);
    } else if (stanza.is('presence')) {
      const status = fromPresence({
        type: stanza.attrs.type,
        show: stanza.getChildText('show'),
      });
      const text = stanza.getChildText('status');
      say(`PRESENCE ${stanza.attrs.from} -> ${status}${text ? ` ("${text}")` : ''}`);
    }
  });

  if (args.sendTo) {
    const to = args.sendTo.includes('@') ? args.sendTo : `${args.sendTo}@${args.domain}`;
    await connection.send(xml('message', { to, type: 'chat' }, xml('body', {}, args.sendText)));
    say(`sent to ${to}: ${args.sendText}`);
  }

  say(`listening for ${args.seconds}s — Ctrl+C to stop early`);
  await new Promise((resolve) => setTimeout(resolve, args.seconds * 1000));

  await connection.stop();
  say('signed off');
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\ninterrupted');
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
