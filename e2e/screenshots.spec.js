/**
 * Produces the screenshots the README uses.
 *
 * Run it against the real Electron app with the demo fixture loaded, so the
 * pictures show a populated client and are identical between runs:
 *
 *   npm run build && npm run screenshots
 *
 * The images land in docs/screenshots/ and are committed. Regenerating them is
 * one command, which is the point — a README screenshot that costs effort to
 * refresh is a README screenshot that goes stale.
 *
 * This is a spec rather than a plain script so it reuses the Electron launch
 * that e2e/smoke.spec.js already proved works on all three platforms. It also
 * asserts as it goes: a screenshot of a blank window is worse than no
 * screenshot, so each capture checks that what it is photographing is there.
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

let app;
let win;

test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iseeku-shot-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      // Skip the WhatsApp/Telegram bridges — they need a browser and a session.
      ICQ_E2E: '1',
      // Populate the ICQ account from the fixture.
      ICQ_DEMO: '1',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // The Contact List renders after the first IPC round trip.
  await win.waitForTimeout(1500);
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('contact list', async () => {
  // Photographing an empty window would produce a README that lies.
  await expect(win.locator('.contact-list, .icq-contactlist').first()).toBeVisible();
  await win.screenshot({ path: path.join(OUT, 'contact-list.png') });
});

test('status menu', async () => {
  const trigger = win.locator('.icq-own-status');
  if (await trigger.count()) {
    await trigger.first().click();
    await expect(win.locator('.icq-status-menu')).toBeVisible();
    await win.screenshot({ path: path.join(OUT, 'status-menu.png') });
    await win.keyboard.press('Escape');
  } else {
    test.skip(true, 'own-status control not present in this skin yet');
  }
});

test('chat window', async () => {
  // Kathrin is the Contact the fixture gives a full conversation to. Clicking
  // whichever row happens to be first got the one-line unread teaser instead,
  // which makes a poor picture of a chat window.
  const contact = win.locator('.icq-contact, .contact-item').filter({ hasText: 'Kathrin' }).first();
  await expect(contact).toBeVisible();
  await contact.click();

  // Opening a chat spawns a second BrowserWindow.
  const chat = await app.waitForEvent('window', { timeout: 15_000 });
  await chat.waitForLoadState('domcontentloaded');
  await chat.waitForTimeout(1200);
  await expect(chat.locator('.chat-main, .icq-messages').first()).toBeVisible();
  await chat.screenshot({ path: path.join(OUT, 'chat-window.png') });
  await chat.close();
});

test('sign-in screen', async () => {
  // Sign out of the demo account so the login screen is what is on screen.
  await win.evaluate(() => window.api?.icq?.disconnect?.());
  await win.waitForTimeout(1200);
  const login = win.locator('.icq-login');
  if (await login.count()) {
    await expect(login).toBeVisible();
    await win.screenshot({ path: path.join(OUT, 'sign-in.png') });
  } else {
    test.skip(true, 'sign-in screen not reachable from this state');
  }
});

test('preferences', async () => {
  // Reached the way a user reaches it: the flower button, then the menu entry.
  const flower = win.locator('.icq-flower-btn');
  if (!(await flower.count())) { test.skip(true, 'flower button not present'); return; }
  await flower.click();
  await win.getByRole('menuitem', { name: /Preferences/ }).click();
  await expect(win.locator('.icq-pref')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, 'preferences.png') });
  await win.keyboard.press('Escape');
});
