/**
 * The connection to an ICQ server.
 *
 * Wraps @xmpp/client with the two things our situation needs and the library
 * does not give us for free:
 *
 *   1. @xmpp/client ships as ESM and the Electron main process is CommonJS, so
 *      the library is pulled in through a cached dynamic import rather than
 *      require().
 *
 *   2. The library's default mechanism selection refuses PLAIN on an
 *      unencrypted stream. That default is correct and it is also exactly what
 *      stops us reaching icqr.net, which offers nothing else. We take over
 *      selection through the documented `credentials` function hook and apply
 *      our own rule from lib/icq-auth-policy.js — which refuses by default too,
 *      but can be overridden per server by the Owner.
 *
 * Everything above the socket lives in sibling modules; this file owns the
 * lifecycle and nothing else.
 */

'use strict';

const { EventEmitter } = require('events');
const {
  chooseMechanism,
  willBeUnencrypted,
  assertNoDowngrade,
  InsecureServerError,
} = require('../lib/icq-auth-policy');

/** @xmpp/client is ESM; load it once and reuse. */
let xmppModulePromise = null;
function loadXmpp() {
  if (!xmppModulePromise) xmppModulePromise = import('@xmpp/client');
  return xmppModulePromise;
}

const DEFAULT_PORT = 5222;

/**
 * Wait before the next reconnection attempt: 2s, 4s, 8s … capped at 5 minutes.
 * `attempt` counts from 0 for the first retry.
 */
const backoff = (attempt) => Math.min(2 ** (Math.max(attempt, 0) + 1) * 1000, 300000);

/**
 * Build the @xmpp/client service URI.
 *
 * `xmpp://` means "plain TCP, upgrade with STARTTLS if the server offers it" —
 * it is not itself a statement that the connection will be insecure. Whether it
 * ends up encrypted is decided during negotiation and enforced by the auth
 * policy, not by the scheme.
 */
function serviceUri({ server, port = DEFAULT_PORT, directTls = false }) {
  return `${directTls ? 'xmpps' : 'xmpp'}://${server}:${port}`;
}

/**
 * A live connection to one account.
 *
 * Events:
 *   status(name)          raw @xmpp/client status, for the connection indicator
 *   online(jid, {secure}) session is usable
 *   offline({willReconnect})
 *   stanza(element)       every inbound stanza, for the feature modules
 *   insecure(info)        emitted once, on connecting in the clear, so the
 *                         interface can keep saying so for the whole session
 *   error(err)            sanitised — never carries a credential
 */
class IcqConnection extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.entity = null;
    this.jid = null;
    this.secure = false;
    this.stopping = false;
  }

  /**
   * Open the connection and authenticate.
   * Resolves once the session is usable; rejects if the server is refused.
   */
  async start() {
    const { client, xml, jid: jidFactory } = await loadXmpp();
    const {
      server,
      port = DEFAULT_PORT,
      domain = server,
      uin,
      password,
      resource,
      allowInsecure = false,
      wasSecurePreviously = false,
      directTls = false,
    } = this.options;

    this.xml = xml;
    this.jidFactory = jidFactory;

    // The failure the policy raises must reach start()'s caller, but it happens
    // inside a callback the library invokes. Park it here and rethrow.
    let policyFailure = null;

    const entity = client({
      service: serviceUri({ server, port, directTls }),
      domain,
      resource,
      // Taking over `credentials` replaces the library's mechanism choice with
      // ours. It runs after stream features are known and before anything is
      // sent — the only point at which the decision is both informed and still
      // reversible.
      credentials: async (authenticate, mechanisms, _fast, ent) => {
        const secure = typeof ent.isSecure === 'function' ? ent.isSecure() : false;
        this.secure = secure;
        try {
          assertNoDowngrade({ server, secure, wasSecurePreviously });
          const mechanism = chooseMechanism({ mechanisms, secure, allowInsecure, server });
          if (willBeUnencrypted({ mechanisms, secure })) {
            this.emit('insecure', { server, port, mechanisms, mechanism });
          }
          await authenticate({ username: uin, password }, mechanism);
        } catch (err) {
          policyFailure = err;
          // Stop the state machine rather than let it retry into the same wall.
          throw err;
        }
      },
    });

    this.entity = entity;

    entity.on('status', (status) => this.emit('status', status));
    entity.on('stanza', (stanza) => this.emit('stanza', stanza));
    entity.on('error', (err) => {
      // @xmpp/client surfaces auth failures here too; never re-emit anything
      // that could carry the credential.
      this.emit('error', sanitiseError(err));
    });
    entity.on('offline', () => {
      this.emit('offline', { willReconnect: !this.stopping });
    });
    entity.on('online', (address) => {
      this.jid = address.toString();
      this.attempt = 0;
      if (entity.reconnect) entity.reconnect.delay = backoff(0);
      this.emit('online', this.jid, { secure: this.secure });
    });

    // @xmpp/reconnect retries on a fixed `delay` — it has no back-off of its
    // own. Widening the gap after each failed attempt, and resetting it once we
    // are back online, is left to the caller.
    this.attempt = 0;
    if (entity.reconnect) {
      entity.reconnect.delay = backoff(0);
      entity.reconnect.on('reconnecting', () => {
        this.attempt += 1;
        entity.reconnect.delay = backoff(this.attempt);
        this.emit('status', 'reconnecting');
      });
    }

    try {
      await entity.start();
    } catch (err) {
      // The policy refusal is the interesting cause; the library wraps it in a
      // generic connection error.
      throw policyFailure || sanitiseError(err);
    }
    return { jid: this.jid, secure: this.secure };
  }

  /** Send a stanza built with the library's xml() factory. */
  async send(stanza) {
    if (!this.entity) throw new Error('Not connected');
    return this.entity.send(stanza);
  }

  /** Send an IQ and wait for its reply. */
  async iq(type, child, to) {
    if (!this.entity) throw new Error('Not connected');
    return this.entity.iqCaller.request(
      this.xml('iq', to ? { type, to } : { type }, child),
    );
  }

  async stop() {
    this.stopping = true;
    if (!this.entity) return;
    try {
      await this.entity.stop();
    } catch {
      // Already gone. Nothing to do and nothing worth reporting.
    }
    this.entity = null;
  }
}

/**
 * Strip anything credential-shaped from an error before it travels further.
 * @xmpp/client's SASL errors carry the mechanism name, not the secret, but an
 * error from a lower layer could quote the stanza that was being written.
 */
function sanitiseError(err) {
  if (!err) return new Error('Unknown connection error');
  const clean = new Error(String(err.message || err).replace(/<auth\b[\s\S]*?<\/auth>/g, '<auth>[REDACTED]</auth>'));
  clean.name = err.name || 'Error';
  if (err.code) clean.code = err.code;
  if (err.condition) clean.condition = err.condition;
  return clean;
}

module.exports = {
  IcqConnection,
  InsecureServerError,
  serviceUri,
  backoff,
  DEFAULT_PORT,
};
