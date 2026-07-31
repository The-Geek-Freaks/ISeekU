/**
 * The History file format.
 *
 * ICQ's Message Archive was the feature people kept the client installed for:
 * a permanent, local, searchable record that outlived any server. ISeekU keeps
 * one per account, in the same tab-separated format the ICQ Reborn client
 * writes, so both clients can read each other's archives and the Owner can
 * switch without losing anything.
 *
 * A row, as observed in a real ICQ Reborn archive:
 *
 *   2026-07-31T18:27:23.0360960Z<TAB>1<TAB>132.145.202.182<TAB>265019842@132.145.202.182/ICQReborn-SHADOW-PC<TAB>Welcome! …
 *   \_ ISO 8601 timestamp        \_ dir  \_ the other party   \_ the full JID the row belongs to  \_ the text
 *
 * Direction is 1 for a Message that arrived and 0 for one that was sent.
 *
 * One deliberate deviation: message bodies contain tabs and newlines, and the
 * observed format has no escaping for them, so a multi-line Message would
 * corrupt the file. We escape them on write and unescape on read. A single-line
 * Message is byte-identical to what the official client produces, so the common
 * case stays perfectly compatible; only the case that would otherwise be broken
 * differs.
 */

'use strict';

const INCOMING = 1;
const OUTGOING = 0;

/** Escape the two characters that would break a row. */
function escapeBody(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

/** Reverse escapeBody. Unknown escapes are left as they were found. */
function unescapeBody(text) {
  let out = '';
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '\\' || i === s.length - 1) { out += s[i]; continue; }
    const next = s[i + 1];
    if (next === 't') { out += '\t'; i += 1; } else if (next === 'n') { out += '\n'; i += 1; } else if (next === '\\') { out += '\\'; i += 1; } else { out += s[i]; }
  }
  return out;
}

/**
 * Format one archive row.
 *
 * @param {object} entry
 * @param {Date|string|number} entry.at        when it happened
 * @param {boolean} entry.incoming             true if it arrived
 * @param {string} entry.peer                  the other party's JID
 * @param {string} entry.self                  the Owner's full JID
 * @param {string} entry.body                  the text
 */
function formatRow({ at, incoming, peer, self, body }) {
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error('History row needs a valid timestamp');
  return [
    when.toISOString(),
    incoming ? INCOMING : OUTGOING,
    peer,
    self,
    escapeBody(body),
  ].join('\t');
}

/**
 * Read one archive row back.
 *
 * Returns null for a row that cannot be understood rather than throwing: an
 * archive is append-only and years old, and one corrupt line should not make
 * the rest unreadable.
 */
function parseRow(line) {
  if (!line || !line.trim()) return null;
  // Split into exactly five fields — the body may itself contain no raw tabs
  // after escaping, but splitting with a limit protects against a file written
  // by something that did not escape.
  const parts = String(line).split('\t');
  if (parts.length < 5) return null;
  const [timestamp, direction, peer, self, ...bodyParts] = parts;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;
  return {
    at,
    incoming: direction.trim() === String(INCOMING),
    peer,
    self,
    // Re-join in case an unescaped archive split the body across fields.
    body: unescapeBody(bodyParts.join('\t')),
  };
}

/** Parse a whole archive, skipping rows that cannot be read. */
function parseArchive(text) {
  return String(text)
    .split(/\r?\n/)
    .map(parseRow)
    .filter(Boolean);
}

/** The archive file name for an account, matching the official client. */
function archiveFileName(uin, domain) {
  return `${uin}_${domain}.tsv`;
}

/**
 * Find Messages containing every one of the given words, newest first.
 *
 * Word-wise rather than substring so that searching "hello world" finds a
 * Message saying "world, hello" — which is what someone looking for a
 * half-remembered conversation actually wants.
 */
function search(entries, query, { limit = 100 } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return entries
    .filter((e) => {
      const body = e.body.toLowerCase();
      return words.every((w) => body.includes(w));
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/** Everything exchanged with one peer, oldest first, as a conversation reads. */
function conversation(entries, peerJid, { limit } = {}) {
  const bare = String(peerJid).split('/')[0];
  const found = entries
    .filter((e) => String(e.peer).split('/')[0] === bare)
    .sort((a, b) => a.at - b.at);
  return limit ? found.slice(-limit) : found;
}

module.exports = {
  INCOMING,
  OUTGOING,
  escapeBody,
  unescapeBody,
  formatRow,
  parseRow,
  parseArchive,
  archiveFileName,
  search,
  conversation,
};
