import React, { useState, useEffect, useCallback } from 'react';
import StatusIcon from './StatusIcon';
import './IcqLogin.css';

/**
 * Signing in to an ICQ account, and creating one.
 *
 * The screen carries a job beyond collecting a UIN: ADR 0002 requires that the
 * Owner is told, before the password leaves the machine, that this particular
 * server has no encryption — and that the warning is a decision they make each
 * session rather than a box they tick once and forget.
 *
 * That is why there is no "don't show this again". It is not an oversight.
 */

const ICQR = { server: '132.145.202.182', port: 5222, domain: '132.145.202.182' };

/** Servers we already know are unencrypted, so the warning can be honest up front. */
const KNOWN_INSECURE = new Set(['132.145.202.182']);

export default function IcqLogin({ onConnected }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'register'
  const [uin, setUin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(ICQR.server);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [warned, setWarned] = useState(false);

  const insecure = KNOWN_INSECURE.has(server.trim());

  // Restore the UIN, never the password — the renderer is not allowed to hold
  // one, and there is no IPC channel that would hand it back.
  useEffect(() => {
    let cancelled = false;
    window.api?.icq?.getStatus?.().then((s) => {
      if (!cancelled && s?.account?.uin) setUin(s.account.uin);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const options = {
        uin: uin.trim(),
        password,
        server: server.trim(),
        port: ICQR.port,
        domain: server.trim(),
        // Only ever true because the Owner just read the warning and clicked
        // through it. Never defaulted, never remembered.
        allowInsecure: warned,
        remember,
      };
      if (mode === 'register') {
        await window.api.icq.register(options);
      }
      await window.api.icq.connect(options);
      setPassword('');
      onConnected?.();
    } catch (err) {
      const message = String(err?.message || err);
      // The main process refused before sending anything. Show the warning and
      // let the Owner decide, rather than silently retrying insecurely.
      if (/INSECURE_SERVER|offers no encryption/i.test(message)) {
        setWarned(false);
        setError({ kind: 'insecure', message });
      } else if (/not-authorized|Invalid username or password/i.test(message)) {
        setError({ kind: 'auth', message: 'That UIN and password do not match.' });
      } else if (/UIN_TAKEN|already taken/i.test(message)) {
        setError({ kind: 'taken', message: `UIN ${uin} is already taken. Choose another.` });
      } else {
        setError({ kind: 'other', message: message.replace(/^Error:\s*/, '') });
      }
    } finally {
      setBusy(false);
    }
  }, [uin, password, server, warned, remember, mode, onConnected]);

  const submit = (e) => {
    e.preventDefault();
    if (!uin.trim() || !password) return;
    if (insecure && !warned) return; // the checkbox below is the gate
    connect();
  };

  const canSubmit = uin.trim() && password && (!insecure || warned) && !busy;

  return (
    <div className="icq-login">
      <div className="icq-login-header">
        <StatusIcon status="online" size={32} title="ISeekU" />
        <div>
          <h1>ISeekU</h1>
          <p>{mode === 'signin' ? 'Sign in to your ICQ account' : 'Create a new UIN'}</p>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="icq-login-row">
          <label htmlFor="icq-uin">ICQ number</label>
          <input
            id="icq-uin"
            className="icq-input"
            value={uin}
            onChange={(e) => setUin(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            autoComplete="username"
            placeholder="265019842"
            autoFocus
          />
        </div>

        <div className="icq-login-row">
          <label htmlFor="icq-password">Password</label>
          <input
            id="icq-password"
            className="icq-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <div className="icq-login-row">
          <label htmlFor="icq-server">Server</label>
          <input
            id="icq-server"
            className="icq-input"
            value={server}
            onChange={(e) => { setServer(e.target.value); setWarned(false); }}
          />
        </div>

        <label className="icq-login-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my ICQ number
        </label>

        {insecure && (
          <div className="icq-login-warning" role="alert">
            <strong>This server does not encrypt anything.</strong>
            <p>
              {server.trim()} offers no TLS. Your password, and every message you
              send, travel across the network in a form anyone on the way can
              read. Sign in only on a network you trust.
            </p>
            <label className="icq-login-check">
              <input
                type="checkbox"
                checked={warned}
                onChange={(e) => setWarned(e.target.checked)}
              />
              I understand — connect without encryption
            </label>
          </div>
        )}

        {error && (
          <div className={`icq-login-error icq-login-error-${error.kind}`} role="alert">
            {error.message}
          </div>
        )}

        <div className="icq-login-actions">
          <button className="icq-btn" type="submit" disabled={!canSubmit}>
            {busy ? 'Connecting…' : (mode === 'signin' ? 'Sign in' : 'Create UIN')}
          </button>
          <button
            className="icq-btn"
            type="button"
            onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(null); }}
            disabled={busy}
          >
            {mode === 'signin' ? 'New UIN…' : 'Back to sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}

export { KNOWN_INSECURE, ICQR };
