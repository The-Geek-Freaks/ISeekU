import React, { useState, useEffect, useRef } from 'react';
import StatusIcon from './StatusIcon';
import './StatusMenu.css';

/**
 * The Status menu — the thing people actually used ICQ's flower button for.
 *
 * Two jobs the original did and most modern clients dropped:
 *
 *   - Status Text is edited right here, not buried in a profile screen. Setting
 *     "in a meeting" was a two-second act, and previously used lines come back
 *     as suggestions because people reused the same handful for years.
 *
 *   - The four Statuses that trigger an Away Message say so, so it is obvious
 *     why picking Occupied starts answering people on your behalf.
 */

/** ICQ's order, with the descriptions the original showed. */
const STATUSES = [
  { name: 'online', label: 'Online', hint: 'Available' },
  { name: 'chat', label: 'Free For Chat', hint: 'Looking for someone to talk to' },
  { name: 'away', label: 'Away', hint: 'Stepped out', autoReply: true },
  { name: 'na', label: 'N/A', hint: 'Away for a while', autoReply: true },
  { name: 'occupied', label: 'Occupied', hint: 'Busy, but reachable', autoReply: true },
  { name: 'dnd', label: 'DND', hint: 'Do not disturb', autoReply: true },
  { name: 'invisible', label: 'Invisible', hint: 'Appear offline, stay connected' },
  { name: 'offline', label: 'Offline', hint: 'Sign out' },
];

const HISTORY_KEY = 'icq-status-history';
const HISTORY_MAX = 8;

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string' && s.trim()) : [];
  } catch {
    return [];
  }
}

function rememberStatusText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return loadHistory();
  // Most recent first, no duplicates, capped — the same list the official
  // client keeps in statushistory.txt.
  const next = [trimmed, ...loadHistory().filter((s) => s !== trimmed)].slice(0, HISTORY_MAX);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export default function StatusMenu({ current = 'offline', statusText = '', onChange, onClose }) {
  const [text, setText] = useState(statusText);
  const [history, setHistory] = useState(loadHistory);
  const rootRef = useRef(null);

  useEffect(() => { setText(statusText); }, [statusText]);

  // Escape closes, and a click anywhere else closes — a popup that traps the
  // Owner is worse than no popup.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [onClose]);

  const pick = (name) => {
    setHistory(rememberStatusText(text));
    onChange?.(name, text.trim());
    onClose?.();
  };

  return (
    <div className="icq-status-menu" ref={rootRef} role="menu" aria-label="Status">
      <div className="icq-status-text-row">
        <input
          className="icq-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') pick(current); }}
          placeholder="Status message…"
          aria-label="Status message"
          maxLength={200}
        />
      </div>

      {history.length > 0 && (
        <div className="icq-status-history">
          {history.map((line) => (
            <button
              key={line}
              type="button"
              className="icq-status-history-item"
              onClick={() => setText(line)}
              title={line}
            >
              {line}
            </button>
          ))}
        </div>
      )}

      <div className="icq-status-list">
        {STATUSES.map((status) => (
          <button
            key={status.name}
            type="button"
            role="menuitemradio"
            aria-checked={status.name === current}
            className="icq-status-item"
            data-current={status.name === current ? 'true' : undefined}
            onClick={() => pick(status.name)}
          >
            <StatusIcon status={status.name} title={status.label} />
            <span className="icq-status-label">{status.label}</span>
            {status.autoReply && (
              <span className="icq-status-auto" title="People writing to you get your Away Message">
                auto
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export { STATUSES, loadHistory, rememberStatusText, HISTORY_KEY, HISTORY_MAX };
