/** Exercise the real React hook with engine snapshots, StrictMode and delayed acknowledgements. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch();
const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/test/fixtures/table-controls.html`);
  const button = page.getByRole('button', { name: /フォールド予約/ });
  const call = async (method, argument) => {
    await page.evaluate(({ method, argument }) => window.tableFixture[method](argument), { method, argument });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const sent = () => page.evaluate(() => window.tableFixture.sent());
  const reserve = async () => {
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await sent(), [], 'Selecting early never sends an out-of-turn action');
  };
  const reachTurn = async () => { for (let i = 0; i < 3; i++) await call('advance'); };

  await reserve();
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await reachTurn();
  assert.deepEqual(await sent(), [], 'Cancelled reservations do not fold');

  await call('reset');
  await reserve();
  await reachTurn();
  assert.deepEqual(await sent(), [{ type: 'fold', playerId: 'p0' }]);
  await call('refresh');
  await call('refresh');
  assert.equal((await sent()).length, 1, 'No duplicate while acknowledgement is delayed');
  await call('acknowledge');
  assert.equal(await page.locator('.seat-viewer.seat-folded').count(), 1);
  assert.equal(await button.count(), 0);

  await call('reset');
  for (let i = 0; i < 6; i++) await call('advance');
  await reserve();
  for (let i = 0; i < 5; i++) await call('advance');
  assert.deepEqual(await sent(), [{ type: 'fold', playerId: 'p0' }], 'Fold reservation also applies when checking is free');

  await call('reset');
  await reserve();
  await call('connection', 'disconnected');
  assert.equal(await button.count(), 0);
  await call('connection', 'connected');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await reachTurn();
  assert.deepEqual(await sent(), [], 'Reconnection does not restore a stale reservation');

  await call('reset');
  await reserve();
  await call('finish');
  assert.equal(await button.count(), 0);
  await call('next');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await sent(), [], 'Hand end clears the reservation');

  await call('reset');
  await reserve();
  await call('replaceHand');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await reachTurn();
  assert.deepEqual(await sent(), [], 'A fresh deal clears even if the end snapshot was missed');

  await call('reset');
  await reserve();
  await call('view', null);
  assert.equal(await button.count(), 0, 'Spectators cannot reserve');
  await call('view', 'p0');
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await reachTurn();
  assert.deepEqual(await sent(), [], 'A changed viewer cannot inherit a reservation');
  assert.deepEqual(errors, []);
  console.log('Reservation: toggle, cancel, automatic fold, exactly-once dispatch, reconnect, hand reset and viewer changes passed.');

  // Exercise the same control with the real CPU scheduler and local transport.
  await page.goto(url);
  await page.getByRole('tab', { name: 'ソロ' }).click();
  await page.locator('.field', { hasText: 'CPU の人数' }).locator('input').fill('9');
  await page.getByRole('button', { name: 'はじめる', exact: true }).click();
  await page.getByRole('button', { name: 'ゲーム開始', exact: true }).click();
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  await button.click();
  const shots = process.env.WILDCARD_SHOTS ?? 'shots-reservation';
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/reserved.png` });
  await page.locator('.seat-viewer.seat-folded').waitFor({ timeout: 30000 });
  assert.equal(await button.count(), 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${shots}/executed.png` });
  console.log('Solo with nine CPUs: reserve, cancel, reselect and automatic fold passed.');
} finally { await browser.close(); }
