import React, { useMemo, useState } from 'react';
import StatusIcon from './StatusIcon';

/**
 * The Contact List, the way ICQ drew it.
 *
 * Not the avatar rows the other transports use: one 16px line per Contact, a
 * status icon, the name, and the Status Text in grey italic behind it. Groups
 * collapse. Offline Contacts sink to the bottom of their Group and can be
 * hidden entirely, which is what the All/Online tabs did.
 *
 * The rules about *which* Group a Contact belongs to live in
 * electron/lib/icq-contact.js and arrive already applied — this component only
 * decides the order things appear in.
 */

/** ICQ's own ordering: the people you can actually talk to, first. */
const STATUS_RANK = ['online', 'chat', 'away', 'na', 'occupied', 'dnd', 'invisible', 'offline'];
const rankOf = (status) => {
  const i = STATUS_RANK.indexOf(status);
  return i === -1 ? STATUS_RANK.length : i;
};

const NOT_IN_LIST = 'Not In List';
const DEFAULT_GROUP = 'General';

/** Named Groups first, then General, then Not In List. */
function groupRank(name) {
  if (name === NOT_IN_LIST) return 2;
  if (name === DEFAULT_GROUP) return 1;
  return 0;
}

function ContactRow({ contact, selected, onSelect, onContextMenu }) {
  return (
    <div
      className="icq-contact"
      data-status={contact.status || 'offline'}
      data-selected={selected ? 'true' : undefined}
      data-unread={contact.unreadCount > 0 ? 'true' : undefined}
      onClick={() => onSelect(contact)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, contact); }}
      title={contact.uin ? `${contact.name} (${contact.uin})` : contact.name}
    >
      <StatusIcon status={contact.status || 'offline'} title={contact.status || 'offline'} />
      <span className="icq-contact-name">{contact.name || contact.id}</span>
      {contact.statusText && <span className="icq-contact-status">{contact.statusText}</span>}
      {contact.unreadCount > 0 && <span className="icq-contact-unread">{contact.unreadCount}</span>}
    </div>
  );
}

export default function IcqContactList({
  contacts = [],
  showOffline = true,
  search = '',
  selectedId = null,
  onSelect,
  onContextMenu,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const byGroup = new Map();

    for (const contact of contacts) {
      // A search looks through everyone, including the Offline Contacts the
      // Online tab is hiding — otherwise searching for someone who happens to
      // be offline finds nothing and looks broken.
      if (needle) {
        const haystack = `${contact.name || ''} ${contact.uin || ''} ${contact.statusText || ''}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      } else if (!showOffline && (contact.status || 'offline') === 'offline') {
        continue;
      }
      const name = contact.group || DEFAULT_GROUP;
      if (!byGroup.has(name)) byGroup.set(name, []);
      byGroup.get(name).push(contact);
    }

    return [...byGroup.entries()]
      .map(([name, members]) => ({
        name,
        members: members.slice().sort((a, b) => {
          const byStatus = rankOf(a.status) - rankOf(b.status);
          if (byStatus !== 0) return byStatus;
          return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        }),
        onlineCount: members.filter((c) => (c.status || 'offline') !== 'offline').length,
      }))
      .sort((a, b) => {
        const byKind = groupRank(a.name) - groupRank(b.name);
        return byKind !== 0 ? byKind : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  }, [contacts, showOffline, search]);

  const toggle = (name) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  if (groups.length === 0) {
    return (
      <div className="icq-contactlist">
        <div className="icq-empty">
          {search ? 'Nobody matches that.' : showOffline ? 'Your Contact List is empty.' : 'Nobody is online.'}
        </div>
      </div>
    );
  }

  return (
    <div className="icq-contactlist">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.name);
        return (
          <div key={group.name}>
            <div
              className="icq-group"
              onClick={() => toggle(group.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(group.name); } }}
              aria-expanded={!isCollapsed}
            >
              <span className="icq-group-arrow">{isCollapsed ? '▶' : '▼'}</span>
              <span>{group.name}</span>
              {/* ICQ showed reachable-of-total, which is the number that
                  actually told you whether it was worth looking. */}
              <span className="icq-group-count">
                {showOffline ? `${group.onlineCount}/${group.members.length}` : group.members.length}
              </span>
            </div>
            {!isCollapsed && group.members.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                selected={contact.id === selectedId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export { STATUS_RANK, rankOf, groupRank };
