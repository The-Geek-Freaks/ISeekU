const {
  NOT_IN_LIST,
  DEFAULT_GROUP,
  isUin,
  parseJid,
  displayName,
  primaryGroup,
  authorization,
  toContact,
  intoGroups,
  uinToJid,
} = require('./icq-contact');
const { sortRank } = require('./icq-presence');

const DOMAIN = '132.145.202.182';

describe('recognising a UIN', () => {
  it('accepts a digits-only localpart', () => {
    expect(isUin('265019842')).toBe(true);
  });

  it('rejects anything else, so federated contacts keep their address', () => {
    expect(isUin('alex')).toBe(false);
    expect(isUin('123abc')).toBe(false);
    expect(isUin('')).toBe(false);
  });
});

describe('parsing a JID', () => {
  it('splits a full JID into its parts', () => {
    expect(parseJid('265019842@132.145.202.182/ICQReborn-SHADOW-PC')).toEqual({
      bare: '265019842@132.145.202.182',
      resource: 'ICQReborn-SHADOW-PC',
      localpart: '265019842',
      domain: '132.145.202.182',
    });
  });

  it('handles a bare JID with no resource', () => {
    expect(parseJid('1@x').resource).toBeNull();
  });

  it('treats a bare domain as the server itself', () => {
    // The icqr.net server sends its Welcome message from the domain alone.
    const parsed = parseJid('132.145.202.182');
    expect(parsed.localpart).toBe('');
    expect(parsed.domain).toBe('132.145.202.182');
  });

  it('keeps a resource containing a slash intact', () => {
    expect(parseJid('a@b/one/two').resource).toBe('one/two');
  });
});

describe('what a Contact is called', () => {
  it('prefers the Nickname the Owner set', () => {
    expect(displayName({ name: 'Bernd', jid: `1@${DOMAIN}` })).toBe('Bernd');
  });

  it('falls back to the bare UIN, which people did memorise', () => {
    expect(displayName({ jid: `265019842@${DOMAIN}` })).toBe('265019842');
  });

  it('ignores a whitespace-only Nickname', () => {
    expect(displayName({ name: '   ', jid: `42@${DOMAIN}` })).toBe('42');
  });

  it('shows the full address for a non-UIN contact', () => {
    expect(displayName({ jid: 'alex@example.org' })).toBe('alex@example.org');
  });
});

describe('Authorization state', () => {
  it('reads both and to as granted', () => {
    expect(authorization({ subscription: 'both' })).toBe('granted');
    expect(authorization({ subscription: 'to' })).toBe('granted');
  });

  it('reads a pending ask as pending, whatever the subscription says', () => {
    expect(authorization({ subscription: 'none', ask: 'subscribe' })).toBe('pending');
    expect(authorization({ subscription: 'from', ask: 'subscribe' })).toBe('pending');
  });

  it('reads from as theirs — they see us, we do not see them', () => {
    expect(authorization({ subscription: 'from' })).toBe('theirs');
  });

  it('reads none as needing Authorization', () => {
    expect(authorization({ subscription: 'none' })).toBe('required');
  });
});

describe('which Group a Contact lands in', () => {
  it('uses the first server-stored group', () => {
    expect(primaryGroup({ subscription: 'both', groups: ['Friends', 'Work'] })).toBe('Friends');
  });

  it('defaults an ungrouped mutual Contact to General', () => {
    expect(primaryGroup({ subscription: 'both', groups: [] })).toBe(DEFAULT_GROUP);
  });

  it('puts someone who sees us but is not added into Not In List', () => {
    expect(primaryGroup({ subscription: 'from' })).toBe(NOT_IN_LIST);
  });

  it('keeps a Contact we have asked in General, not Not In List', () => {
    // We added them on purpose; they just have not answered yet.
    expect(primaryGroup({ subscription: 'none', ask: 'subscribe' })).toBe(DEFAULT_GROUP);
  });

  it('ignores blank group names from the server', () => {
    expect(primaryGroup({ subscription: 'both', groups: ['  ', 'Real'] })).toBe('Real');
  });
});

describe('building a Contact', () => {
  it('extracts the UIN and defaults to Offline before presence arrives', () => {
    const c = toContact({ jid: `265019842@${DOMAIN}`, subscription: 'both' });
    expect(c).toMatchObject({
      uin: '265019842', jid: `265019842@${DOMAIN}`, status: 'offline', authorization: 'granted',
    });
  });

  it('strips a resource from the roster JID', () => {
    expect(toContact({ jid: `1@${DOMAIN}/phone`, subscription: 'both' }).jid).toBe(`1@${DOMAIN}`);
  });

  it('leaves uin null for a federated contact', () => {
    expect(toContact({ jid: 'alex@example.org', subscription: 'both' }).uin).toBeNull();
  });

  it('layers presence on when it is known', () => {
    const c = toContact(
      { jid: `1@${DOMAIN}`, subscription: 'both' },
      { presence: { status: 'away', statusText: 'Just Vibing' } },
    );
    expect(c.status).toBe('away');
    expect(c.statusText).toBe('Just Vibing');
  });

  it('flags a Not In List contact', () => {
    expect(toContact({ jid: `9@${DOMAIN}`, subscription: 'from' }).notInList).toBe(true);
  });
});

describe('grouping the Contact List', () => {
  const contacts = [
    toContact({ jid: `1@${DOMAIN}`, name: 'Zoe', subscription: 'both', groups: ['Work'] }, { presence: { status: 'online' } }),
    toContact({ jid: `2@${DOMAIN}`, name: 'Anna', subscription: 'both', groups: ['Work'] }, { presence: { status: 'offline' } }),
    toContact({ jid: `3@${DOMAIN}`, name: 'Bernd', subscription: 'both', groups: ['Work'] }, { presence: { status: 'away' } }),
    toContact({ jid: `4@${DOMAIN}`, name: 'Chris', subscription: 'both', groups: [] }, { presence: { status: 'online' } }),
    toContact({ jid: `5@${DOMAIN}`, subscription: 'from' }),
  ];

  it('orders named Groups first, then General, then Not In List', () => {
    expect(intoGroups(contacts, { sortRank }).map((g) => g.name))
      .toEqual(['Work', DEFAULT_GROUP, NOT_IN_LIST]);
  });

  it('sorts reachable Contacts above Offline ones within a Group', () => {
    const work = intoGroups(contacts, { sortRank }).find((g) => g.name === 'Work');
    expect(work.members.map((c) => c.name)).toEqual(['Zoe', 'Bernd', 'Anna']);
  });

  it('sorts alphabetically among equally reachable Contacts', () => {
    const same = [
      toContact({ jid: `1@${DOMAIN}`, name: 'zoe', subscription: 'both', groups: ['G'] }, { presence: { status: 'online' } }),
      toContact({ jid: `2@${DOMAIN}`, name: 'Anna', subscription: 'both', groups: ['G'] }, { presence: { status: 'online' } }),
    ];
    expect(intoGroups(same, { sortRank })[0].members.map((c) => c.name)).toEqual(['Anna', 'zoe']);
  });

  it('counts who is reachable in each Group', () => {
    const work = intoGroups(contacts, { sortRank }).find((g) => g.name === 'Work');
    expect(work.onlineCount).toBe(2);
  });

  it('hides Offline Contacts when asked, and drops a Group that empties', () => {
    const groups = intoGroups(contacts, { sortRank, showOffline: false });
    expect(groups.find((g) => g.name === NOT_IN_LIST)).toBeUndefined();
    expect(groups.find((g) => g.name === 'Work').members.map((c) => c.name)).toEqual(['Zoe', 'Bernd']);
  });
});

describe('addressing a UIN', () => {
  it('composes the JID from UIN and server', () => {
    expect(uinToJid('265019842', DOMAIN)).toBe(`265019842@${DOMAIN}`);
  });

  it('tolerates a UIN the Owner typed with spaces', () => {
    expect(uinToJid('  265019842 ', DOMAIN)).toBe(`265019842@${DOMAIN}`);
  });
});

describe('adding a contact from whatever was typed', () => {
  const { addressToJid } = require('./icq-contact');

  it('treats a bare UIN as someone on our own server', () => {
    expect(addressToJid('265019842', DOMAIN)).toBe(`265019842@${DOMAIN}`);
  });

  it('accepts a full address on another server — the network is XMPP', () => {
    // Refusing this would throw away the one advantage over the original.
    expect(addressToJid('alex@jabber.example.org')).toBe('alex@jabber.example.org');
  });

  it('keeps the other server, not ours, when one was given', () => {
    expect(addressToJid('alex@jabber.example.org', DOMAIN)).toBe('alex@jabber.example.org');
  });

  it('drops a resource — a Contact is a person, not a device', () => {
    expect(addressToJid('alex@example.org/phone')).toBe('alex@example.org');
  });

  it('tolerates surrounding whitespace', () => {
    expect(addressToJid('  265019842  ', DOMAIN)).toBe(`265019842@${DOMAIN}`);
  });

  it('allows a non-numeric name on our own server', () => {
    expect(addressToJid('kathrin', DOMAIN)).toBe(`kathrin@${DOMAIN}`);
  });

  it('refuses input that is not an address', () => {
    expect(addressToJid('', DOMAIN)).toBeNull();
    expect(addressToJid('   ', DOMAIN)).toBeNull();
    expect(addressToJid('@example.org')).toBeNull();
    expect(addressToJid('alex@')).toBeNull();
    expect(addressToJid('a@b@c')).toBeNull();
  });

  it('refuses a bare name when we do not know our own server', () => {
    expect(addressToJid('265019842', null)).toBeNull();
  });
});
