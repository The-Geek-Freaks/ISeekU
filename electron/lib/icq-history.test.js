const {
  escapeBody,
  unescapeBody,
  formatRow,
  parseRow,
  parseArchive,
  archiveFileName,
  search,
  conversation,
} = require('./icq-history');

// A real row, copied from an ICQ Reborn archive.
const REAL_ROW = '2026-07-31T18:27:23.036Z\t1\t132.145.202.182'
  + '\t265019842@132.145.202.182/ICQReborn-SHADOW-PC\tWelcome! Your account has been created.';

describe('reading an archive written by the official client', () => {
  it('parses a real row', () => {
    const row = parseRow(REAL_ROW);
    expect(row.incoming).toBe(true);
    expect(row.peer).toBe('132.145.202.182');
    expect(row.self).toBe('265019842@132.145.202.182/ICQReborn-SHADOW-PC');
    expect(row.body).toBe('Welcome! Your account has been created.');
    expect(row.at.toISOString()).toBe('2026-07-31T18:27:23.036Z');
  });

  it('round-trips a single-line Message byte for byte', () => {
    // The common case must stay exactly compatible.
    const parsed = parseRow(REAL_ROW);
    expect(formatRow(parsed)).toBe(REAL_ROW);
  });

  it('reads direction 0 as outgoing', () => {
    expect(parseRow('2026-01-01T00:00:00.000Z\t0\ta@b\tc@d\thi').incoming).toBe(false);
  });

  it('recovers a body that an unescaped writer split across fields', () => {
    // An archive written without escaping puts raw tabs in the body.
    const row = parseRow('2026-01-01T00:00:00.000Z\t1\ta@b\tc@d\tone\ttwo\tthree');
    expect(row.body).toBe('one\ttwo\tthree');
  });
});

describe('rows that cannot be read', () => {
  it('skips a row with too few fields instead of throwing', () => {
    expect(parseRow('2026-01-01T00:00:00.000Z\t1\ta@b')).toBeNull();
  });

  it('skips a row with an unreadable timestamp', () => {
    expect(parseRow('not-a-date\t1\ta@b\tc@d\thi')).toBeNull();
  });

  it('skips blank lines', () => {
    expect(parseRow('')).toBeNull();
    expect(parseRow('   ')).toBeNull();
  });

  it('keeps the readable rows when one in the middle is corrupt', () => {
    // An append-only archive years old must not be lost to one bad line.
    const archive = [
      '2026-01-01T00:00:00.000Z\t1\ta@b\tc@d\tfirst',
      'garbage',
      '2026-01-02T00:00:00.000Z\t0\ta@b\tc@d\tthird',
    ].join('\n');
    expect(parseArchive(archive).map((e) => e.body)).toEqual(['first', 'third']);
  });

  it('reads an archive with Windows line endings', () => {
    const archive = '2026-01-01T00:00:00.000Z\t1\ta@b\tc@d\tone\r\n2026-01-02T00:00:00.000Z\t1\ta@b\tc@d\ttwo\r\n';
    expect(parseArchive(archive)).toHaveLength(2);
  });
});

describe('escaping', () => {
  it('survives a Message containing tabs and newlines', () => {
    const body = 'line one\nline\ttwo\r\nline three';
    expect(unescapeBody(escapeBody(body))).toBe('line one\nline\ttwo\nline three');
  });

  it('produces a row with no raw tab or newline in the body', () => {
    const row = formatRow({
      at: '2026-01-01T00:00:00.000Z', incoming: false, peer: 'a@b', self: 'c@d', body: 'a\tb\nc',
    });
    expect(row.split('\t')).toHaveLength(5);
    expect(row).not.toContain('\n');
  });

  it('round-trips a multi-line Message through a written row', () => {
    const body = 'Hallo\nwie geht es dir?';
    const row = formatRow({ at: '2026-01-01T00:00:00.000Z', incoming: true, peer: 'a@b', self: 'c@d', body });
    expect(parseRow(row).body).toBe(body);
  });

  it('does not eat a literal backslash the Owner typed', () => {
    const body = 'C:\\temp\\notes';
    expect(unescapeBody(escapeBody(body))).toBe(body);
  });

  it('leaves an unknown escape sequence alone', () => {
    expect(unescapeBody('50\\% done')).toBe('50\\% done');
  });

  it('leaves a trailing backslash alone', () => {
    expect(unescapeBody('ends with \\')).toBe('ends with \\');
  });
});

describe('writing a row', () => {
  it('refuses an unusable timestamp rather than writing a corrupt row', () => {
    expect(() => formatRow({ at: 'whenever', incoming: true, peer: 'a', self: 'b', body: 'x' }))
      .toThrow(/valid timestamp/);
  });

  it('accepts a Date, an ISO string, or epoch millis', () => {
    const common = { incoming: true, peer: 'a@b', self: 'c@d', body: 'x' };
    const fromDate = formatRow({ ...common, at: new Date('2026-01-01T00:00:00.000Z') });
    expect(formatRow({ ...common, at: '2026-01-01T00:00:00.000Z' })).toBe(fromDate);
    expect(formatRow({ ...common, at: Date.parse('2026-01-01T00:00:00.000Z') })).toBe(fromDate);
  });
});

describe('the archive file name', () => {
  it('matches what the official client uses', () => {
    expect(archiveFileName('265019842', '132.145.202.182')).toBe('265019842_132.145.202.182.tsv');
  });
});

describe('History search', () => {
  const entries = parseArchive([
    '2026-01-01T10:00:00.000Z\t1\ta@b\tme@s\tHello world',
    '2026-01-02T10:00:00.000Z\t0\ta@b\tme@s\tworld, hello again',
    '2026-01-03T10:00:00.000Z\t1\tz@b\tme@s\tsomething else entirely',
  ].join('\n'));

  it('finds Messages containing every word, in any order', () => {
    expect(search(entries, 'hello world')).toHaveLength(2);
  });

  it('is case-insensitive', () => {
    expect(search(entries, 'HELLO')).toHaveLength(2);
  });

  it('returns newest first, which is what someone is looking for', () => {
    expect(search(entries, 'hello')[0].body).toBe('world, hello again');
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(search(entries, '')).toEqual([]);
    expect(search(entries, '   ')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(search(entries, 'hello', { limit: 1 })).toHaveLength(1);
  });
});

describe('reading one conversation', () => {
  const entries = parseArchive([
    '2026-01-02T10:00:00.000Z\t0\t1@s\tme@s\tsecond',
    '2026-01-01T10:00:00.000Z\t1\t1@s/phone\tme@s\tfirst',
    '2026-01-03T10:00:00.000Z\t1\t2@s\tme@s\tother person',
  ].join('\n'));

  it('collects only that peer, oldest first', () => {
    expect(conversation(entries, '1@s').map((e) => e.body)).toEqual(['first', 'second']);
  });

  it('matches a peer regardless of which device they used', () => {
    // '1@s/phone' and '1@s' are the same person.
    expect(conversation(entries, '1@s/desktop')).toHaveLength(2);
  });

  it('takes the most recent when limited', () => {
    expect(conversation(entries, '1@s', { limit: 1 }).map((e) => e.body)).toEqual(['second']);
  });
});
