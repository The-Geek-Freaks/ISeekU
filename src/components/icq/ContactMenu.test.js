/*
 * Tests for the ContactMenu component.
 *
 * The menu is the right-click action surface on a Contact in the Contact List.
 * The tests confirm its section structure matches the original ICQ layout,
 * that disabled items stay consistently present rather than disappearing,
 * that each enabled action fires the right callback, and that dismissal
 * works reliably for both keyboard and pointer users.
 *
 * The portal test specifically checks that the menu renders as a direct child
 * of document.body — not inside whatever element triggered the menu — because
 * that is the fix for the overflow-clipping problem the Status menu once had.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ContactMenu from './ContactMenu';

const contact = { id: '123456@s', name: 'Alice', uin: '123456' };
const position = { x: 100, y: 200 };

function renderMenu(props = {}) {
  return render(
    <ContactMenu
      contact={contact}
      position={position}
      onClose={props.onClose ?? (() => {})}
      {...props}
    />,
  );
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('menu structure', () => {
  it('renders a menu element with an accessible label', () => {
    renderMenu();
    expect(screen.getByRole('menu', { name: /Alice/ })).toBeInTheDocument();
  });

  it('has a Send section with Send Message, Send File and Send Contacts', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Send Message' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Send File' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Send Contacts' })).toBeInTheDocument();
  });

  it('has a Launch section with Tic-Tac-Toe and Quatro', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Tic-Tac-Toe' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Quatro' })).toBeInTheDocument();
  });

  it('has a User section with Info, Alert/Accept, Move To Group, Rename and Delete', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: "User's Details" })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Alert\/Accept Modes/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Move To Group' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Disabled items — presence and explanation
// ---------------------------------------------------------------------------

describe('disabled items without callbacks', () => {
  it('disables Send Message when no onSendMessage callback is provided', () => {
    renderMenu(); // no onSendMessage
    expect(screen.getByRole('menuitem', { name: 'Send Message' })).toBeDisabled();
  });

  it('always disables Send File with an explanatory title', () => {
    renderMenu();
    const item = screen.getByRole('menuitem', { name: 'Send File' });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('title');
    expect(item.title).not.toBe('');
  });

  it('always disables Send Contacts', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Send Contacts' })).toBeDisabled();
  });

  it('disables Tic-Tac-Toe when no onInviteGame callback is provided', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Tic-Tac-Toe' })).toBeDisabled();
  });

  it('disables Quatro when no onInviteGame callback is provided', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Quatro' })).toBeDisabled();
  });

  it("disables User's Details when no onInfo callback is provided", () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: "User's Details" })).toBeDisabled();
  });

  it('always disables Alert/Accept Modes with an explanatory title', () => {
    renderMenu();
    const item = screen.getByRole('menuitem', { name: /Alert\/Accept Modes/ });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('title');
    expect(item.title).toMatch(/not yet implemented/i);
  });

  it('always disables Move To Group', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Move To Group' })).toBeDisabled();
  });

  it('disables Rename when no onRename callback is provided', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeDisabled();
  });

  it('disables Delete when no onDelete callback is provided', () => {
    renderMenu();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Enabled items — correct callback and shape
// ---------------------------------------------------------------------------

describe('enabled items', () => {
  it('calls onSendMessage with the contact and closes when Send Message is clicked', async () => {
    const user = userEvent.setup();
    const onSendMessage = jest.fn();
    const onClose = jest.fn();
    renderMenu({ onSendMessage, onClose });
    await user.click(screen.getByRole('menuitem', { name: 'Send Message' }));
    expect(onSendMessage).toHaveBeenCalledWith(contact);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onInfo with the contact when User's Details is clicked", async () => {
    const user = userEvent.setup();
    const onInfo = jest.fn();
    const onClose = jest.fn();
    renderMenu({ onInfo, onClose });
    await user.click(screen.getByRole('menuitem', { name: "User's Details" }));
    expect(onInfo).toHaveBeenCalledWith(contact);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onRename with the contact when Rename is clicked', async () => {
    const user = userEvent.setup();
    const onRename = jest.fn();
    const onClose = jest.fn();
    renderMenu({ onRename, onClose });
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledWith(contact);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onDelete with the contact when Delete is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = jest.fn();
    const onClose = jest.fn();
    renderMenu({ onDelete, onClose });
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(contact);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onInviteGame with the contact and "ttt" for Tic-Tac-Toe', async () => {
    const user = userEvent.setup();
    const onInviteGame = jest.fn();
    renderMenu({ onInviteGame });
    await user.click(screen.getByRole('menuitem', { name: 'Tic-Tac-Toe' }));
    expect(onInviteGame).toHaveBeenCalledWith(contact, 'ttt');
  });

  it('calls onInviteGame with the contact and "quatro" for Quatro', async () => {
    const user = userEvent.setup();
    const onInviteGame = jest.fn();
    renderMenu({ onInviteGame });
    await user.click(screen.getByRole('menuitem', { name: 'Quatro' }));
    expect(onInviteGame).toHaveBeenCalledWith(contact, 'quatro');
  });

  it('enables all game items when onInviteGame is provided', () => {
    renderMenu({ onInviteGame: jest.fn() });
    expect(screen.getByRole('menuitem', { name: 'Tic-Tac-Toe' })).not.toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Quatro' })).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Dismissal
// ---------------------------------------------------------------------------

describe('dismissal', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    renderMenu({ onClose });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the user clicks outside the menu', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <>
        <ContactMenu
          contact={contact}
          position={position}
          onClose={onClose}
        />
        <button type="button">Elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open when the user clicks inside the menu', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    // Click a disabled item: nothing happens and the menu does not close.
    renderMenu({ onClose });
    await user.click(screen.getByRole('menuitem', { name: 'Send File' }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Portal — menu must not be clipped by the Contact List's overflow container
// ---------------------------------------------------------------------------

describe('portal rendering', () => {
  it('renders the menu as a direct child of document.body, not the trigger element', () => {
    const { container } = renderMenu();
    // container is the div that Testing Library renders the component into.
    // The menu itself must NOT be inside that wrapper — it is in document.body.
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('positions the menu at the coordinates supplied by the caller', () => {
    renderMenu({ position: { x: 42, y: 99 } });
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu.style.left).toBe('42px');
    expect(menu.style.top).toBe('99px');
  });
});
