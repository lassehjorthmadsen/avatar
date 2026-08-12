/* =============================================================================
   AVATAR — End-to-end frontend tests (Playwright)

   Run against a live instance:
     BASE_URL=https://avatar-tekstogtal.fly.dev npx playwright test test/e2e.spec.ts

   Screenshots land in test/screenshots/ and are deleted once the plan is
   checked off (per SPEC "Testing").
   ============================================================================= */

import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://localhost:8010';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SHOTS = 'test/screenshots';

/** Conversation ids created by this run, so the suite can report them for cleanup. */
const createdConversations: string[] = [];

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('avatar-theme', t);
  }, theme);
}

test.describe('Visitor chat', () => {
  test('loads with intro screen, example prompts and focused composer', async ({ page }) => {
    await page.goto(BASE);
    await expect(page).toHaveTitle(/Lasse|Avatar/i);

    // The composer must take focus on load (SPEC: UI).
    const composer = page.locator('#msg-input');
    await expect(composer).toBeFocused();

    // Intro screen offers example prompts.
    const prompts = page.locator('#suggest-row .chip');
    await expect(prompts.first()).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/visitor-01-intro-dark.png`, fullPage: true });
  });

  test('renders correctly in light mode', async ({ page }) => {
    await page.goto(BASE);
    await setTheme(page, 'light');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/visitor-02-intro-light.png`, fullPage: true });

    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );
    // Light theme must not still be painting the dark navy surface.
    expect(bg).not.toBe('rgb(3, 33, 71)');
  });

  test('Qn shortcut returns an instant answer with no LLM call', async ({ page }) => {
    await page.goto(BASE);
    const composer = page.locator('#msg-input');

    await composer.fill('Q2');
    const started = Date.now();
    await composer.press('Enter');

    // Instant answers restate the question first (SPEC).
    const reply = page.locator('.msg--avatar .bubble').first();
    await expect(reply).toContainText(/Q2/, { timeout: 15_000 });
    const elapsed = Date.now() - started;

    // No LLM round-trip: this should be near-instant.
    expect(elapsed).toBeLessThan(10_000);

    await expect(composer).toBeFocused();
    await page.screenshot({ path: `${SHOTS}/visitor-03-qn-shortcut.png`, fullPage: true });
  });

  test('?q=N deep link submits on arrival and clears the parameter', async ({ page }) => {
    await page.goto(`${BASE}/?q=3`);

    const reply = page.locator('.msg--avatar .bubble').first();
    await expect(reply).toContainText(/Q3/, { timeout: 15_000 });

    // The parameter is stripped from the URL afterwards.
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();

    await page.screenshot({ path: `${SHOTS}/visitor-04-deeplink.png`, fullPage: true });
  });

  test('sends a real message and streams a reply from the twin', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#visitor-name').fill('PW');
    const composer = page.locator('#msg-input');

    await composer.fill('In one short sentence: what do you do?');
    await composer.press('Enter');

    // Visitor bubble appears immediately.
    await expect(page.locator('.msg--visitor .bubble').first()).toBeVisible();

    // Avatar reply streams in, then settles.
    const reply = page.locator('.msg--avatar .bubble').last();
    await expect(reply).not.toBeEmpty({ timeout: 90_000 });
    await expect(page.locator('.msg--streaming')).toHaveCount(0, { timeout: 90_000 });
    const text = (await reply.innerText()).trim();
    expect(text.length).toBeGreaterThan(10);

    const cid = await page.evaluate(() =>
      document.cookie.match(/avatar_conv_id=([^;]+)/)?.[1] ?? ''
    );
    if (cid) createdConversations.push(decodeURIComponent(cid));

    await page.screenshot({ path: `${SHOTS}/visitor-05-live-reply.png`, fullPage: true });
  });

  test('replies in Danish to a Danish question', async ({ page }) => {
    await page.goto(BASE);
    const composer = page.locator('#msg-input');

    await composer.fill('Hvad handler dine bøger om? Svar kort.');
    await composer.press('Enter');

    const reply = page.locator('.msg--avatar .bubble').last();
    await expect(reply).not.toBeEmpty({ timeout: 90_000 });

    // Read the finished reply, not a half-streamed prefix: the streaming class
    // is dropped once the last delta lands.
    await expect(page.locator('.msg--streaming')).toHaveCount(0, { timeout: 90_000 });
    const text = (await reply.innerText()).toLowerCase();

    // Danish orthography / common words — a plain English reply would fail.
    expect(/[æøå]|\b(og|er|jeg|som|til|har|ikke|den|det)\b/.test(text)).toBe(true);

    const cid = await page.evaluate(() =>
      document.cookie.match(/avatar_conv_id=([^;]+)/)?.[1] ?? ''
    );
    if (cid) createdConversations.push(decodeURIComponent(cid));

    await page.screenshot({ path: `${SHOTS}/visitor-06-danish.png`, fullPage: true });
  });

  test('Reset chat starts a new conversation id', async ({ page }) => {
    // Reset asks for confirmation before discarding the thread.
    page.on('dialog', (d) => d.accept());

    await page.goto(BASE);
    await page.locator('#msg-input').fill('Q1');
    await page.locator('#msg-input').press('Enter');
    await expect(page.locator('.msg--avatar .bubble').first()).toBeVisible({ timeout: 15_000 });

    const before = await page.evaluate(() =>
      document.cookie.match(/avatar_conv_id=([^;]+)/)?.[1] ?? ''
    );

    await page.locator('#reset-btn').click();
    await page.waitForTimeout(500);

    const after = await page.evaluate(() =>
      document.cookie.match(/avatar_conv_id=([^;]+)/)?.[1] ?? ''
    );
    expect(after).not.toBe(before);

    // Transcript is cleared back to the intro screen.
    await expect(page.locator('.msg--visitor')).toHaveCount(0);

    await page.screenshot({ path: `${SHOTS}/visitor-07-after-reset.png`, fullPage: true });
  });

  test('Keep chat persists the conversation across a reload', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('#msg-input').fill('Q1');
    await page.locator('#msg-input').press('Enter');
    await expect(page.locator('.msg--avatar .bubble').first()).toBeVisible({ timeout: 15_000 });

    const cid = await page.evaluate(() =>
      document.cookie.match(/avatar_conv_id=([^;]+)/)?.[1] ?? ''
    );

    await page.reload();

    // Same conversation, transcript restored from the server.
    const after = await page.evaluate(() =>
      document.cookie.match(/avatar_conv_id=([^;]+)/)?.[1] ?? ''
    );
    expect(after).toBe(cid);
    await expect(page.locator('.msg--visitor').first()).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: `${SHOTS}/visitor-08-persisted.png`, fullPage: true });
  });

  test('is usable on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE);
    await page.locator('#msg-input').fill('Q1');
    await page.locator('#msg-input').press('Enter');
    await expect(page.locator('.msg--avatar .bubble').first()).toBeVisible({ timeout: 15_000 });

    // Nothing may overflow horizontally.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${SHOTS}/visitor-09-mobile.png`, fullPage: true });
  });
});

test.describe('Admin dashboard', () => {
  test.skip(!ADMIN_PASSWORD, 'ADMIN_PASSWORD not provided');

  test('rejects a wrong password', async ({ page }) => {
    await page.goto(`${BASE}/admin/`);
    await page.locator('#login-password').fill('definitely-not-the-password');
    await page.locator('#login-form button[type=submit]').click();

    await expect(page.locator('#login-error')).toContainText(/invalid/i);
    await expect(page.locator('#dashboard')).toBeHidden();

    await page.screenshot({ path: `${SHOTS}/admin-01-login-error.png`, fullPage: true });
  });

  test('logs in, lists conversations, opens a thread and replies', async ({ page }) => {
    // Seed a conversation the admin can open.
    const cid = randomUUID();
    createdConversations.push(cid);
    await page.request.post(`${BASE}/api/chat`, {
      data: { conversation_id: cid, message: 'Q1', conversation_name: 'PW-ADMIN' },
    });

    await page.goto(`${BASE}/admin/`);
    await page.locator('#login-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-form button[type=submit]').click();

    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/admin-02-inbox.png`, fullPage: true });

    // The seeded conversation shows up in the inbox.
    const row = page.locator(`.convo-item[data-id="${cid}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveClass(/is-unread/);

    await row.click();
    await expect(page.locator('#thread-view')).toBeVisible();
    await expect(page.locator('#thread-inner .msg')).not.toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/admin-03-thread.png`, fullPage: true });

    // Opening the thread clears the unread marker.
    await expect(row).not.toHaveClass(/is-unread/);

    // The human posts into the thread.
    const reply = page.locator('#reply-input');
    await expect(reply).toBeFocused();
    await reply.fill('Hi from the human — jumping in here.');
    await reply.press('Enter');

    await expect(page.locator('#thread-inner .msg--human')).toHaveCount(1, { timeout: 15_000 });
    await expect(reply).toBeFocused();
    await page.screenshot({ path: `${SHOTS}/admin-04-human-reply.png`, fullPage: true });
  });

  test('arrow keys move through the inbox', async ({ page }) => {
    await page.goto(`${BASE}/admin/`);
    await page.locator('#login-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-form button[type=submit]').click();
    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 15_000 });

    const rows = page.locator('.convo-item');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    // Focus must be off the composer for navigation keys to apply.
    await page.locator('.sidebar-title, #convo-list').first().click();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.convo-item.is-active')).toHaveCount(1);

    await page.screenshot({ path: `${SHOTS}/admin-05-keyboard-nav.png`, fullPage: true });
  });

  test('mobile uses a master/detail flow with a back control', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/admin/`);
    await page.locator('#login-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-form button[type=submit]').click();
    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 15_000 });

    // Inbox fills the screen.
    await page.screenshot({ path: `${SHOTS}/admin-06-mobile-inbox.png`, fullPage: true });

    const first = page.locator('.convo-item').first();
    await expect(first).toBeVisible({ timeout: 15_000 });
    await first.click();

    // Tapping a row slides the thread in over the inbox.
    await expect(page.locator('#main-panel')).toHaveClass(/is-open/);
    await page.screenshot({ path: `${SHOTS}/admin-07-mobile-thread.png`, fullPage: true });

    await page.locator('#back-btn').click();
    await expect(page.locator('#main-panel')).not.toHaveClass(/is-open/);
  });

  test('light mode renders on the dashboard', async ({ page }) => {
    await page.goto(`${BASE}/admin/`);
    await setTheme(page, 'light');
    await page.locator('#login-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-form button[type=submit]').click();
    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: `${SHOTS}/admin-08-light.png`, fullPage: true });
  });

  test('signing out locks the dashboard again', async ({ page }) => {
    await page.goto(`${BASE}/admin/`);
    await page.locator('#login-password').fill(ADMIN_PASSWORD);
    await page.locator('#login-form button[type=submit]').click();
    await expect(page.locator('#dashboard')).toBeVisible({ timeout: 15_000 });

    await page.locator('#logout-btn').click();
    await expect(page.locator('#login-screen')).toBeVisible();

    // The protected API rejects the cleared session.
    const res = await page.request.get(`${BASE}/admin/api/conversations`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Three-way conversation', () => {
  test.skip(!ADMIN_PASSWORD, 'ADMIN_PASSWORD not provided');

  test("the human's message reaches the visitor's open chat", async ({ browser }) => {
    const visitor = await browser.newPage();
    const admin = await browser.newPage();

    // Visitor starts a conversation.
    await visitor.goto(BASE);
    await visitor.locator('#visitor-name').fill('3W');
    await visitor.locator('#msg-input').fill('Q1');
    await visitor.locator('#msg-input').press('Enter');
    await expect(visitor.locator('.msg--avatar .bubble').first()).toBeVisible({ timeout: 15_000 });

    const cid = decodeURIComponent(
      await visitor.evaluate(() =>
        document.cookie.match(/avatar_conv_id=([^;]+)/)?.[1] ?? ''
      )
    );
    expect(cid).not.toBe('');
    createdConversations.push(cid);

    // Human opens it in admin and posts.
    await admin.goto(`${BASE}/admin/`);
    await admin.locator('#login-password').fill(ADMIN_PASSWORD);
    await admin.locator('#login-form button[type=submit]').click();
    await expect(admin.locator('#dashboard')).toBeVisible({ timeout: 15_000 });

    const row = admin.locator(`.convo-item[data-id="${cid}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await admin.locator('#reply-input').fill('Lasse here — happy to answer that myself.');
    await admin.locator('#reply-input').press('Enter');
    await expect(admin.locator('#thread-inner .msg--human')).toHaveCount(1, { timeout: 15_000 });
    await admin.screenshot({ path: `${SHOTS}/threeway-01-admin-posts.png`, fullPage: true });

    // The visitor's poll picks it up without a reload.
    await expect(visitor.locator('.msg--human')).toHaveCount(1, { timeout: 40_000 });
    await expect(visitor.locator('.msg--human .bubble')).toContainText('Lasse here');
    await visitor.screenshot({ path: `${SHOTS}/threeway-02-visitor-receives.png`, fullPage: true });

    // The avatar does NOT react to the human's message on its own (SPEC Q&A #4),
    // but does see it as context on the visitor's next turn.
    const avatarBubblesBefore = await visitor.locator('.msg--avatar').count();
    await visitor.waitForTimeout(3_000);
    expect(await visitor.locator('.msg--avatar').count()).toBe(avatarBubblesBefore);

    await visitor.close();
    await admin.close();
  });
});

test.afterAll(() => {
  if (createdConversations.length) {
    console.log('\nConversation ids created by this run (delete from Supabase):');
    for (const id of new Set(createdConversations)) console.log('  ' + id);
  }
});
