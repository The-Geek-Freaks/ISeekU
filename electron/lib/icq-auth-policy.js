/**
 * Decides whether, and how, to authenticate on a connection.
 *
 * This is the gate that stands between the Owner's password and the socket. It
 * runs after stream features are known and before any credential is sent, which
 * is the only point where the decision can be made correctly:
 *
 *   - Deciding earlier (on the URL scheme) would refuse `xmpp://` servers that
 *     do offer STARTTLS, which are perfectly safe.
 *   - Deciding later (after `online`) would be too late — the password is
 *     already gone.
 *
 * @xmpp/client's own default refuses PLAIN on an unencrypted stream, which is
 * the right default and exactly what stops us talking to icqr.net. Rather than
 * patch the library, we take over mechanism selection through its documented
 * `credentials` function hook, and re-implement the rule with one deliberate,
 * per-server exception.
 *
 * Kept free of I/O so the rule can be tested without a network.
 */

'use strict';

const PLAIN = 'PLAIN';

/** Thrown when a server would require sending the password in the clear. */
class InsecureServerError extends Error {
  constructor(message, { server, mechanisms }) {
    super(message);
    this.name = 'InsecureServerError';
    this.code = 'INSECURE_SERVER';
    this.server = server;
    this.mechanisms = mechanisms;
  }
}

/** Thrown when no mechanism is usable at all. */
class NoUsableMechanismError extends Error {
  constructor(message, { server, mechanisms }) {
    super(message);
    this.name = 'NoUsableMechanismError';
    this.code = 'NO_USABLE_MECHANISM';
    this.server = server;
    this.mechanisms = mechanisms;
  }
}

/**
 * Pick a SASL mechanism, or refuse.
 *
 * @param {object}   opts
 * @param {string[]} opts.mechanisms     what the server offered, in its order
 * @param {boolean}  opts.secure         whether the stream is encrypted
 * @param {boolean}  opts.allowInsecure  the Owner accepted this specific server
 *                                       in the clear, this session
 * @param {string}   opts.server         for the error message
 * @returns {string} the chosen mechanism
 */
function chooseMechanism({ mechanisms = [], secure, allowInsecure = false, server = 'the server' }) {
  if (mechanisms.length === 0) {
    throw new NoUsableMechanismError(`${server} offered no authentication mechanism.`, { server, mechanisms });
  }

  // On an encrypted stream every mechanism is acceptable; the server lists them
  // strongest-first and the library's ordering already prefers SCRAM.
  if (secure) return mechanisms[0];

  // Unencrypted: anything that does not hand over the password verbatim is
  // still worth using, and needs no warning.
  const notPlain = mechanisms.find((m) => m !== PLAIN);
  if (notPlain) return notPlain;

  // Unencrypted and PLAIN-only. This is icqr.net.
  if (!allowInsecure) {
    throw new InsecureServerError(
      `${server} offers no encryption and only PLAIN authentication. `
      + 'Your password would be sent in readable form over the network. '
      + 'Connect only if you accept that, on a network you trust.',
      { server, mechanisms },
    );
  }
  return PLAIN;
}

/**
 * Whether the connection to this server is one the Owner should be warned
 * about before it is opened. Lets the interface show the warning up front
 * rather than after a failed attempt.
 */
function willBeUnencrypted({ mechanisms = [], secure }) {
  if (secure) return false;
  return !mechanisms.some((m) => m !== PLAIN);
}

/**
 * Refuse a server that used to offer encryption and has stopped.
 *
 * A server losing STARTTLS between two sign-ons is what a downgrade attack
 * looks like from the client side, so it is refused rather than accepted
 * quietly — even if the Owner previously ticked "connect anyway", which was a
 * decision about a different server than the one now answering.
 */
function assertNoDowngrade({ server, secure, wasSecurePreviously }) {
  if (wasSecurePreviously && !secure) {
    throw new InsecureServerError(
      `${server} previously offered an encrypted connection and no longer does. `
      + 'Refusing to connect: this is what an interception attempt looks like.',
      { server, mechanisms: [] },
    );
  }
}

module.exports = {
  PLAIN,
  InsecureServerError,
  NoUsableMechanismError,
  chooseMechanism,
  willBeUnencrypted,
  assertNoDowngrade,
};
