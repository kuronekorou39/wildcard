/** Actual browser checks for repeated taps, authoritative deadlines and decorative motion. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
const out = process.env.WILDCARD_SHOTS ?? 'shots-motion';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/test/fixtures/table-controls.html`);
  const call = async (method, argument) => {
    await page.evaluate(({ method, argument }) => window.tableFixture[method](argument), { method, argument });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const sent = () => page.evaluate(() => window.tableFixture.sent());
  const center = async locator => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await call('reset'); await call('view', 'p3');
    const raise = page.getByRole('button', { name: 'レイズ', exact: true });
    await raise.click();
    // Start over to measure the actual opening button (landscape uses a different layout).
    await page.getByRole('button', { name: 'やめる', exact: true }).click();
    await raise.click({ trial: true });
    const point = await center(raise);
    await page.mouse.click(...point);
    await page.waitForTimeout(60);
    await page.mouse.click(...point);
    await page.waitForTimeout(650);
    await page.mouse.click(...point);
    assert.deepEqual(await sent(), [], 'Repeated taps at the opening position never confirm a raise');
    if (await raise.count()) await raise.click();
    const confirm = page.getByRole('button', { name: /にレイズ$/ });
    await confirm.click({ trial: true });
    const confirmPoint = await center(confirm);
    await page.mouse.click(...confirmPoint);
    await page.mouse.click(...confirmPoint);
    assert.equal((await sent()).length, 1, 'A slow acknowledgement cannot send two raises');
    assert.equal((await sent())[0].type, 'raise');

    await call('reset');
    const reserve = page.getByRole('button', { name: /フォールド予約/ });
    const oldReserve = await center(reserve);
    await reserve.click(); await reserve.click();
    for (let i = 0; i < 3; i++) await call('advance');
    const foldPoint = await center(page.getByRole('button', { name: 'フォールド', exact: true }));
    await page.mouse.click(...foldPoint);
    assert.deepEqual(await sent(), [], 'A tap carried into the new turn is ignored');
    await page.waitForTimeout(650);
    await page.mouse.click(...oldReserve);
    assert.deepEqual(await sent(), [], 'The old reservation position does not become fold');
    if (await page.getByRole('button', { name: 'やめる', exact: true }).count())
      await page.getByRole('button', { name: 'やめる', exact: true }).click();
    await page.getByRole('button', { name: 'フォールド', exact: true }).click();
    assert.deepEqual(await sent(), [{ type: 'fold', playerId: 'p0' }]);
    console.log(`Tap protection ${viewport.width}x${viewport.height}: passed`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await call('reset');
  assert.ok(await page.locator('.motion-piece[data-kind="deal"]').count() > 0);
  assert.equal(await page.locator('.table-motion .card').count(), 0, 'Motion never adds hidden card faces');
  await page.screenshot({ path: `${out}/deal.png` });
  await page.waitForTimeout(1200);
  for (let i = 0; i < 6; i++) await call('advance');
  assert.equal(await page.locator('.community-cards .card:not(.card-slot)').count(), 3);
  assert.ok(await page.locator('.motion-piece[data-kind="burn"]').count() > 0);
  assert.equal(await page.locator('.stock-burn-used').count(), 1);
  await page.screenshot({ path: `${out}/burn-and-flop.png` });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/flop.png` });
  assert.ok(await page.locator('.chip-stack i').count() > 0);
  await call('finish');
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.motion-piece[data-kind="win"]').count() > 0);
  assert.equal(await page.locator('.seat-folded .card').count(), 0);
  assert.equal(await page.locator('.seat-tag', { hasText: 'フォールド' }).count(), 0);
  await page.screenshot({ path: `${out}/payout.png` });
  await page.waitForTimeout(1900);
  assert.equal(await page.locator('.motion-piece').count(), 0, 'Finished motion is removed');

  await call('timed', 1500);
  await page.waitForTimeout(500);
  const dash = Number(await page.locator('.turn-ring rect').getAttribute('stroke-dashoffset'));
  assert.ok(dash > 20 && dash < 80, `Time ring is decreasing (${dash})`);
  await page.screenshot({ path: `${out}/time-running-out.png` });
  await page.locator('[data-player-id="p3"].seat-folded').waitFor({ timeout: 2000 });
  assert.equal(await page.locator('[data-player-id="p3"] .card').count(), 0);
  assert.equal(await page.locator('[data-player-id="p4"].seat-turn').count(), 1);
  const snapshot = await page.evaluate(() => window.tableFixture.state());
  assert.equal(snapshot.state.pot + snapshot.state.players.reduce((sum, player) => sum + player.chips, 0), 6000);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await call('reset');
  assert.equal(await page.locator('.motion-piece').count(), 0);
  assert.equal(await page.locator('.seat-viewer .card').first().evaluate(card => getComputedStyle(card).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log('Deal, burn, flop, payout, pot chips, hidden folded cards, real timeout and reduced motion: passed');
} finally {
  await browser.close();
}
