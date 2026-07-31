/**
 * The sign-in screen is a security surface, not just a form.
 *
 * ADR 0002 makes two promises about it, and both are the kind that decay
 * quietly during a refactor unless something fails loudly:
 *
 *   1. Connecting to a server with no encryption requires a deliberate act
 *      each session — there is no remembered consent.
 *   2. The password is never handed back to the renderer.
 *
 * These tests exist to break the build if either stops being true.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import IcqLogin from './IcqLogin';

const ICQR = '132.145.202.182';

function mockApi(overrides = {}) {
  const icq = {
    getStatus: jest.fn().mockResolvedValue({ status: 'disconnected', account: null }),
    connect: jest.fn().mockResolvedValue({ status: 'ready' }),
    register: jest.fn().mockResolvedValue({ uin: '999' }),
    ...overrides,
  };
  window.api = { icq };
  return icq;
}

afterEach(() => { delete window.api; });

const fillCredentials = async (user, { uin = '265019842', password = 'hunter2' } = {}) => {
  await user.type(screen.getByLabelText(/^ICQ number$/i), uin);
  await user.type(screen.getByLabelText(/^Password$/i), password);
};

describe('the unencrypted-server gate', () => {
  it('warns before anything is typed, because the server is known to be cleartext', () => {
    mockApi();
    render(<IcqLogin />);
    expect(screen.getByRole('alert')).toHaveTextContent(/does not encrypt anything/i);
  });

  it('refuses to sign in until the Owner acknowledges the warning', async () => {
    const user = userEvent.setup();
    const icq = mockApi();
    render(<IcqLogin />);
    await fillCredentials(user);

    expect(screen.getByRole('button', { name: /Sign in/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(icq.connect).not.toHaveBeenCalled();
  });

  it('signs in once acknowledged, passing the consent through explicitly', async () => {
    const user = userEvent.setup();
    const icq = mockApi();
    render(<IcqLogin />);
    await fillCredentials(user);
    await user.click(screen.getByLabelText(/connect without encryption/i));
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => expect(icq.connect).toHaveBeenCalled());
    expect(icq.connect.mock.calls[0][0]).toMatchObject({
      uin: '265019842', server: ICQR, allowInsecure: true,
    });
  });

  it('never sends allowInsecure without the acknowledgement', async () => {
    const user = userEvent.setup();
    const icq = mockApi();
    render(<IcqLogin />);
    await fillCredentials(user);
    // A server with no known encryption problem needs no tick.
    await user.clear(screen.getByLabelText(/^Server$/i));
    await user.type(screen.getByLabelText(/^Server$/i), 'xmpp.example.org');
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => expect(icq.connect).toHaveBeenCalled());
    expect(icq.connect.mock.calls[0][0].allowInsecure).toBe(false);
  });

  it('drops the acknowledgement when the server is changed', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<IcqLogin />);
    await fillCredentials(user);
    await user.click(screen.getByLabelText(/connect without encryption/i));
    expect(screen.getByLabelText(/connect without encryption/i)).toBeChecked();

    // Consent was given for one server, so pointing at another drops both the
    // warning and the consent...
    await user.type(screen.getByLabelText(/^Server$/i), '9');
    expect(screen.queryByLabelText(/connect without encryption/i)).not.toBeInTheDocument();

    // ...and coming back does not restore it. The Owner has to agree again.
    await user.type(screen.getByLabelText(/^Server$/i), '{backspace}');
    expect(screen.getByLabelText(/connect without encryption/i)).not.toBeChecked();
  });

  it('offers no way to suppress the warning permanently', () => {
    mockApi();
    render(<IcqLogin />);
    // A "don't ask again" here would defeat the point of asking.
    expect(screen.queryByText(/again/i)).not.toBeInTheDocument();
  });

  it('re-arms the gate when the main process refuses as insecure', async () => {
    const user = userEvent.setup();
    const icq = mockApi({
      connect: jest.fn().mockRejectedValue(
        Object.assign(new Error('offers no encryption and only PLAIN'), { code: 'INSECURE_SERVER' }),
      ),
    });
    render(<IcqLogin />);
    await fillCredentials(user);
    await user.click(screen.getByLabelText(/connect without encryption/i));
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => expect(icq.connect).toHaveBeenCalled());
    // It must not silently retry with consent it no longer has.
    await waitFor(() => expect(screen.getByLabelText(/connect without encryption/i)).not.toBeChecked());
  });
});

describe('the password', () => {
  it('is never requested back from the main process', async () => {
    const icq = mockApi();
    render(<IcqLogin />);
    await waitFor(() => expect(icq.getStatus).toHaveBeenCalled());
    // Only the UIN may be restored. There is no channel for the rest.
    expect(icq).not.toHaveProperty('getPassword');
    expect(Object.keys(icq).some((k) => /password/i.test(k))).toBe(false);
  });

  it('is cleared from the form once the connection succeeds', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<IcqLogin />);
    await fillCredentials(user);
    await user.click(screen.getByLabelText(/connect without encryption/i));
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => expect(screen.getByLabelText(/^Password$/i)).toHaveValue(''));
  });

  it('is entered in a masked field', () => {
    mockApi();
    render(<IcqLogin />);
    expect(screen.getByLabelText(/^Password$/i)).toHaveAttribute('type', 'password');
  });
});

describe('the UIN field', () => {
  it('accepts only digits, because a UIN is a number', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<IcqLogin />);
    await user.type(screen.getByLabelText(/^ICQ number$/i), '26a5b019');
    expect(screen.getByLabelText(/^ICQ number$/i)).toHaveValue('265019');
  });

  it('is restored from the last sign-in, but nothing else is', async () => {
    mockApi({
      getStatus: jest.fn().mockResolvedValue({ account: { uin: '265019842' } }),
    });
    render(<IcqLogin />);
    await waitFor(() => expect(screen.getByLabelText(/^ICQ number$/i)).toHaveValue('265019842'));
    expect(screen.getByLabelText(/^Password$/i)).toHaveValue('');
  });
});

describe('reporting what went wrong', () => {
  it('says so plainly when the credentials do not match', async () => {
    const user = userEvent.setup();
    mockApi({ connect: jest.fn().mockRejectedValue(new Error('not-authorized - Invalid username or password')) });
    render(<IcqLogin />);
    await fillCredentials(user);
    await user.click(screen.getByLabelText(/connect without encryption/i));
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    await waitFor(() => expect(screen.getByText(/do not match/i)).toBeInTheDocument());
  });

  it('names the taken UIN when registration collides', async () => {
    const user = userEvent.setup();
    mockApi({ register: jest.fn().mockRejectedValue(Object.assign(new Error('UIN_TAKEN'), { code: 'UIN_TAKEN' })) });
    render(<IcqLogin />);
    await user.click(screen.getByRole('button', { name: /New UIN/i }));
    await fillCredentials(user);
    await user.click(screen.getByLabelText(/connect without encryption/i));
    await user.click(screen.getByRole('button', { name: /Create UIN/i }));

    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());
  });

  it('does not sign in when registration failed', async () => {
    const user = userEvent.setup();
    const icq = mockApi({ register: jest.fn().mockRejectedValue(new Error('UIN_TAKEN')) });
    render(<IcqLogin />);
    await user.click(screen.getByRole('button', { name: /New UIN/i }));
    await fillCredentials(user);
    await user.click(screen.getByLabelText(/connect without encryption/i));
    await user.click(screen.getByRole('button', { name: /Create UIN/i }));

    await waitFor(() => expect(icq.register).toHaveBeenCalled());
    expect(icq.connect).not.toHaveBeenCalled();
  });
});

describe('creating a UIN', () => {
  it('registers and then signs in with the same details', async () => {
    const user = userEvent.setup();
    const icq = mockApi();
    render(<IcqLogin />);
    await user.click(screen.getByRole('button', { name: /New UIN/i }));
    await fillCredentials(user, { uin: '777', password: 'neu' });
    await user.click(screen.getByLabelText(/connect without encryption/i));
    await user.click(screen.getByRole('button', { name: /Create UIN/i }));

    await waitFor(() => expect(icq.connect).toHaveBeenCalled());
    expect(icq.register.mock.calls[0][0]).toMatchObject({ uin: '777' });
    expect(icq.connect.mock.calls[0][0]).toMatchObject({ uin: '777' });
  });
});
