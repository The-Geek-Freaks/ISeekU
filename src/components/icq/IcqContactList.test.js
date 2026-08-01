/**
 * The Contact List's ordering rules.
 *
 * ICQ's order was not arbitrary: reachable people at the top of their Group,
 * Not In List at the bottom of the window, and a count that said how many of a
 * Group were worth writing to. Getting that wrong makes the client feel like a
 * generic messenger wearing a skin.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import IcqContactList from './IcqContactList';

const contact = (id, over = {}) => ({
  id: `${id}@s`, name: id, uin: id, group: 'General', status: 'online', unreadCount: 0, ...over,
});

const rowNames = () => screen.getAllByTitle(/\(/).map((el) => within(el).getByText(/^[^(]+$/, { selector: '.icq-contact-name' }).textContent);

describe('ordering within a Group', () => {
  it('puts reachable Contacts above Offline ones', () => {
    render(<IcqContactList contacts={[
      contact('Anna', { status: 'offline' }),
      contact('Bernd', { status: 'online' }),
      contact('Cem', { status: 'away' }),
    ]} onSelect={() => {}} />);
    expect(rowNames()).toEqual(['Bernd', 'Cem', 'Anna']);
  });

  it('follows ICQ Status order, not alphabetical, among reachable Contacts', () => {
    render(<IcqContactList contacts={[
      contact('Zoe', { status: 'online' }),
      contact('Anna', { status: 'dnd' }),
      contact('Bernd', { status: 'away' }),
    ]} onSelect={() => {}} />);
    expect(rowNames()).toEqual(['Zoe', 'Bernd', 'Anna']);
  });

  it('sorts alphabetically, case-insensitively, within one Status', () => {
    render(<IcqContactList contacts={[
      contact('zoe'), contact('Anna'), contact('bernd'),
    ]} onSelect={() => {}} />);
    expect(rowNames()).toEqual(['Anna', 'bernd', 'zoe']);
  });
});

describe('ordering of Groups', () => {
  it('places named Groups first, then General, then Not In List', () => {
    render(<IcqContactList contacts={[
      contact('a', { group: 'Not In List' }),
      contact('b', { group: 'General' }),
      contact('c', { group: 'Work' }),
    ]} onSelect={() => {}} />);
    const headers = screen.getAllByRole('button').map((el) => el.textContent);
    expect(headers[0]).toMatch(/Work/);
    expect(headers[1]).toMatch(/General/);
    expect(headers[2]).toMatch(/Not In List/);
  });

  it('defaults a Contact with no Group to General', () => {
    render(<IcqContactList contacts={[contact('a', { group: undefined })]} onSelect={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent(/General/);
  });
});

describe('the Group count', () => {
  it('shows reachable-of-total, which is the number that mattered', () => {
    render(<IcqContactList contacts={[
      contact('a', { group: 'Work', status: 'online' }),
      contact('b', { group: 'Work', status: 'offline' }),
      contact('c', { group: 'Work', status: 'away' }),
    ]} onSelect={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent('2/3');
  });

  it('shows a plain total when Offline Contacts are hidden anyway', () => {
    render(<IcqContactList showOffline={false} contacts={[
      contact('a', { group: 'Work', status: 'online' }),
      contact('b', { group: 'Work', status: 'offline' }),
    ]} onSelect={() => {}} />);
    expect(screen.getByRole('button')).toHaveTextContent(/Work\s*1/);
  });
});

describe('hiding Offline Contacts', () => {
  it('drops them, and drops a Group that empties completely', () => {
    render(<IcqContactList showOffline={false} contacts={[
      contact('a', { group: 'Work', status: 'online' }),
      contact('b', { group: 'Gone', status: 'offline' }),
    ]} onSelect={() => {}} />);
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('says nobody is online rather than showing an empty window', () => {
    render(<IcqContactList showOffline={false} contacts={[contact('a', { status: 'offline' })]} onSelect={() => {}} />);
    expect(screen.getByText(/Nobody is online/i)).toBeInTheDocument();
  });
});

describe('search', () => {
  it('matches on name, UIN and Status Text', () => {
    const contacts = [
      contact('Bernd', { uin: '111', statusText: 'in a meeting' }),
      contact('Anna', { uin: '222', statusText: 'Just Vibing' }),
    ];
    const { rerender } = render(<IcqContactList contacts={contacts} search="222" onSelect={() => {}} />);
    expect(rowNames()).toEqual(['Anna']);

    rerender(<IcqContactList contacts={contacts} search="meeting" onSelect={() => {}} />);
    expect(rowNames()).toEqual(['Bernd']);
  });

  it('reaches Offline Contacts even while the Online filter is on', () => {
    // Searching for someone who happens to be offline must not come back empty.
    render(<IcqContactList showOffline={false} search="Anna" onSelect={() => {}} contacts={[
      contact('Anna', { status: 'offline' }),
    ]} />);
    expect(rowNames()).toEqual(['Anna']);
  });

  it('says so when nothing matches', () => {
    render(<IcqContactList contacts={[contact('a')]} search="nobody" onSelect={() => {}} />);
    expect(screen.getByText(/Nobody matches that/i)).toBeInTheDocument();
  });
});

describe('collapsing a Group', () => {
  it('hides its members and keeps the header', async () => {
    const user = userEvent.setup();
    render(<IcqContactList contacts={[contact('a', { group: 'Work' })]} onSelect={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Work/ }));
    expect(screen.queryByText('a')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Work/ })).toBeInTheDocument();
  });

  it('is reachable from the keyboard', async () => {
    const user = userEvent.setup();
    render(<IcqContactList contacts={[contact('a', { group: 'Work' })]} onSelect={() => {}} />);
    screen.getByRole('button', { name: /Work/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByText('a')).not.toBeInTheDocument();
  });

  it('collapses only the Group that was clicked', async () => {
    const user = userEvent.setup();
    render(<IcqContactList onSelect={() => {}} contacts={[
      contact('a', { group: 'Work' }),
      contact('b', { group: 'Friends' }),
    ]} />);
    await user.click(screen.getByRole('button', { name: /Work/ }));
    expect(screen.queryByText('a')).not.toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });
});

describe('unread Events', () => {
  it('marks the row so the skin can blink it', () => {
    render(<IcqContactList contacts={[contact('a', { unreadCount: 3 })]} onSelect={() => {}} />);
    expect(screen.getByTitle(/a \(a\)/)).toHaveAttribute('data-unread', 'true');
  });

  it('leaves a read row unmarked rather than setting it false', () => {
    // The CSS selector is [data-unread='true']; an explicit "false" would be
    // dead weight in the DOM on every row.
    render(<IcqContactList contacts={[contact('a')]} onSelect={() => {}} />);
    expect(screen.getByTitle(/a \(a\)/)).not.toHaveAttribute('data-unread');
  });
});

describe('opening a Contact', () => {
  it('hands the whole Contact to the caller', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(<IcqContactList contacts={[contact('a')]} onSelect={onSelect} />);
    await user.click(screen.getByText('a'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a@s', uin: 'a' }));
  });

  it('right-click shows the Contact Menu instead of the browser default', async () => {
    const user = userEvent.setup();
    render(<IcqContactList contacts={[contact('Alice')]} onSelect={() => {}} />);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Alice') });
    expect(screen.getByRole('menu', { name: /Alice/ })).toBeInTheDocument();
  });
});

describe('Contact context menu', () => {
  it('right-click opens the menu for the correct Contact', async () => {
    const user = userEvent.setup();
    render(<IcqContactList contacts={[contact('Anna'), contact('Bernd')]} onSelect={() => {}} />);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Bernd') });
    // The aria-label names the Contact the menu is for.
    expect(screen.getByRole('menu', { name: /Bernd/ })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: /Anna/ })).not.toBeInTheDocument();
  });

  it('Escape closes the menu', async () => {
    const user = userEvent.setup();
    render(<IcqContactList contacts={[contact('Alice')]} onSelect={() => {}} />);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Alice') });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking outside the menu closes it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <IcqContactList contacts={[contact('Alice')]} onSelect={() => {}} />
        <button type="button">Outside</button>
      </>,
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Alice') });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Send Message calls onSendMessage with that Contact and closes the menu', async () => {
    const user = userEvent.setup();
    const onSendMessage = jest.fn();
    const alice = contact('Alice');
    render(<IcqContactList contacts={[alice]} onSelect={() => {}} onSendMessage={onSendMessage} />);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Alice') });
    await user.click(screen.getByRole('menuitem', { name: 'Send Message' }));
    expect(onSendMessage).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
