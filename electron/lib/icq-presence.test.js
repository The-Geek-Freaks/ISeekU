const {
  STATUS_ORDER,
  toPresence,
  fromPresence,
  sendsAwayMessage,
  isAvailable,
  statusMenu,
  sortRank,
} = require('./icq-presence');

describe('publishing a Status', () => {
  it('publishes Online as a bare available presence', () => {
    expect(toPresence('online')).toMatchObject({ type: null, show: null, icqStatus: 'online' });
  });

  it('distinguishes Occupied from DND, which XMPP alone cannot', () => {
    // Both are <show>dnd</show> on the wire; only the marker tells them apart.
    expect(toPresence('occupied').show).toBe('dnd');
    expect(toPresence('dnd').show).toBe('dnd');
    expect(toPresence('occupied').icqStatus).toBe('occupied');
    expect(toPresence('dnd').icqStatus).toBe('dnd');
  });

  it('maps N/A to xa and Free For Chat to chat', () => {
    expect(toPresence('na').show).toBe('xa');
    expect(toPresence('chat').show).toBe('chat');
  });

  it('publishes Invisible as unavailable and does not announce it', () => {
    const p = toPresence('invisible');
    expect(p.type).toBe('unavailable');
    // Announcing "I am invisible" would defeat the entire purpose.
    expect(p.icqStatus).toBeNull();
  });

  it('carries the Status Text', () => {
    expect(toPresence('away', { statusText: 'Just Vibing' }).status).toBe('Just Vibing');
  });

  it('drops an empty Status Text rather than sending an empty element', () => {
    expect(toPresence('online', { statusText: '' }).status).toBeNull();
  });

  it('refuses an unknown Status instead of guessing', () => {
    expect(() => toPresence('brb')).toThrow(/Unknown Status/);
  });
});

describe('reading a contact Status', () => {
  it('trusts the ICQ marker when another ISeekU client sends one', () => {
    expect(fromPresence({ show: 'dnd', icqStatus: 'dnd' })).toBe('dnd');
    expect(fromPresence({ show: 'dnd', icqStatus: 'occupied' })).toBe('occupied');
  });

  it('falls back to show for contacts on other clients', () => {
    expect(fromPresence({ show: 'xa' })).toBe('na');
    expect(fromPresence({ show: 'chat' })).toBe('chat');
    expect(fromPresence({ show: 'away' })).toBe('away');
  });

  it('reads a bare available presence as Online', () => {
    expect(fromPresence({})).toBe('online');
  });

  it('reads unavailable as Offline regardless of what else is claimed', () => {
    expect(fromPresence({ type: 'unavailable' })).toBe('offline');
    // A client claiming to be online while going unavailable is lying; the
    // wire form decides.
    expect(fromPresence({ type: 'unavailable', icqStatus: 'online' })).toBe('offline');
  });

  it('treats a presence error as Offline', () => {
    expect(fromPresence({ type: 'error' })).toBe('offline');
  });

  it('ignores a marker naming a Status nobody can be seen in', () => {
    // 'invisible' and 'offline' are not things a *contact* can appear as.
    expect(fromPresence({ show: 'away', icqStatus: 'invisible' })).toBe('away');
    expect(fromPresence({ icqStatus: 'offline' })).toBe('online');
  });

  it('ignores a marker that is not a Status at all', () => {
    expect(fromPresence({ show: 'away', icqStatus: 'nonsense' })).toBe('away');
  });

  it('round-trips every Status a contact can be seen in', () => {
    for (const status of STATUS_ORDER) {
      if (status === 'invisible' || status === 'offline') continue;
      const wire = toPresence(status);
      expect(fromPresence(wire)).toBe(status);
    }
  });
});

describe('Away Message rule', () => {
  it('replies automatically only in the four unavailable-ish Statuses', () => {
    expect(STATUS_ORDER.filter(sendsAwayMessage)).toEqual(['away', 'na', 'occupied', 'dnd']);
  });

  it('does not reply when Online or Free For Chat', () => {
    expect(sendsAwayMessage('online')).toBe(false);
    expect(sendsAwayMessage('chat')).toBe(false);
  });

  it('does not reply when Invisible — that would give the Owner away', () => {
    expect(sendsAwayMessage('invisible')).toBe(false);
  });
});

describe('availability', () => {
  it('counts Invisible and Offline as not available', () => {
    expect(isAvailable('invisible')).toBe(false);
    expect(isAvailable('offline')).toBe(false);
    expect(isAvailable('dnd')).toBe(true);
  });
});

describe('the Status menu', () => {
  it('lists the eight Statuses in ICQ order', () => {
    expect(statusMenu().map((s) => s.name)).toEqual([
      'online', 'chat', 'away', 'na', 'occupied', 'dnd', 'invisible', 'offline',
    ]);
  });

  it('gives every entry a human label', () => {
    // ICQ's own label, parenthetical and all — see docs/ORIGINAL-REFERENCE.md.
    expect(statusMenu().find((s) => s.name === 'na').label).toBe('N/A (Extended Away)');
    expect(statusMenu().find((s) => s.name === 'chat').label).toBe('Free For Chat');
  });
});

describe('Contact List ordering', () => {
  it('ranks Online above Away above Offline', () => {
    expect(sortRank('online')).toBeLessThan(sortRank('away'));
    expect(sortRank('away')).toBeLessThan(sortRank('offline'));
  });

  it('puts an unrecognised Status last rather than first', () => {
    expect(sortRank('bogus')).toBeGreaterThan(sortRank('offline'));
  });
});
