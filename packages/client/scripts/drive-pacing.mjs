import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
const out = process.env.WILDCARD_SHOTS ?? 'shots-pacing';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/test/fixtures/table-pacing.html`);
  const call = async (method, arg) => {
    await page.evaluate(({ method, arg }) => window.pacingFixture[method](arg), { method, arg });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const state = () => page.evaluate(() => window.pacingFixture.state());
  const settle = async () => {
    const time = await page.evaluate(() => Math.max(0, window.pacingFixture.state().runtime.readyAt - Date.now()));
    await page.waitForTimeout(time + 130);
  };
  for (const count of [6, 10]) {
    await call('reset', count); await call('start');
    const before = await state();
    await call('advance');
    assert.equal((await state()).state.pot, before.state.pot, 'Cannot act during the deal');
    assert.ok(before.runtime.readyAt - before.runtime.handStartedAt >= 2000);
    await settle();
    const gap = await page.evaluate(() => {
      const own = document.querySelector('.seat-viewer').getBoundingClientRect();
      const others = [...document.querySelectorAll('.seat:not(.seat-viewer)')].map(s => s.getBoundingClientRect());
      return own.top - Math.max(...others.map(r => r.bottom));
    });
    assert.ok(gap >= 28, `${count} players: own area gap ${gap}`);
    assert.doesNotMatch(await page.locator('.bottombar').innerText(), /あなたのアクション|チェックできます|金額を調整|手番が来たら実行/);
    await page.screenshot({ path: `${out}/${count}-players.png` });
  }
  await call('reset', 6); await call('start'); await settle();
  for (let i = 0; i < 5; i++) { await call('advance'); await settle(); }
  await call('advance');
  const flop = await state();
  const burn = flop.runtime.events.find(e => e.kind === 'burn');
  const board = flop.runtime.events.find(e => e.kind === 'board');
  assert.ok(board.at - burn.at >= 680);
  assert.equal(await page.locator('.community-cards .card:not(.card-slot)').count(), 0, 'Board waits for the burn');
  await page.waitForTimeout(850);
  await page.screenshot({ path: `${out}/burn.png` });
  await settle();
  assert.equal(await page.locator('.community-cards .card:not(.card-slot)').count(), 3);
  assert.equal(await page.locator('.chip-stack[data-value="10"]').getAttribute('data-count'), '12');
  assert.equal(await page.locator('.chip-stack[data-value="100"]').count(), 0, 'Twelve tens stay twelve tens');
  await page.screenshot({ path: `${out}/flop-chips.png` });
  while ((await state()).state.phase === 'betting') { await call('fold'); await settle(); }
  await page.getByRole('button', { name: '次のハンド', exact: true }).waitFor();
  const finished = await state();
  assert.equal(finished.runtime.nextHandAt - finished.runtime.readyAt, 8000);
  await page.screenshot({ path: `${out}/next-hand-countdown.png` });
  await page.waitForFunction(() => window.pacingFixture.state().runtime.handId === 2, { timeout: 10000 });
  assert.equal((await state()).state.phase, 'betting');
  await settle();
  while ((await state()).state.phase === 'betting') { await call('fold'); await settle(); }
  await page.getByRole('button', { name: '自動開始を停止', exact: true }).click();
  await page.waitForTimeout(8500);
  assert.equal((await state()).runtime.handId, 2);
  assert.equal((await state()).state.phase, 'showdown');
  assert.deepEqual(errors, []);
  console.log('6/10 seats, slower deal/burn/flop, stable chip denominations, auto next hand and cancellation: passed');
} finally { await browser.close(); }
