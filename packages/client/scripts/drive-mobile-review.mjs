/** Sparse tables, phone space, exit confirmation and showdown separation. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
const out = 'shots-mobile-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [], measurements = [];
async function settle(page) {
  const delay = await page.evaluate(() => {
    const runtime = window.tableFixture.state().runtime;
    return Math.max(0, runtime.readyAt, ...runtime.events.map(e => e.at + 3000)) - Date.now();
  });
  if (delay > 0) await page.clock.fastForward(delay);
  await page.clock.runFor(50);
  // Browser animations use a separate clock from the server-style deadlines.
  await page.evaluate(() => { for (const animation of document.getAnimations()) animation.finish(); });
  await page.clock.runFor(50);
}
async function inspect(page, name) {
  const metrics = await page.evaluate(() => {
    const rect = el => el.getBoundingClientRect();
    const overlaps = (a,b) => Math.min(a.right,b.right) - Math.max(a.left,b.left) > 2 && Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 2;
    const seats = [...document.querySelectorAll('.seat')];
    const board = [...document.querySelectorAll('.community-cards .card')];
    const raise = document.querySelector('.raise-controls');
    const problems = [];
    const pot = document.querySelector('.table-pot');
    if (pot) for (const bet of document.querySelectorAll('.table-bet:not([data-amount="0"])'))
      if (overlaps(rect(pot),rect(bet))) problems.push('posted bet covers pot');
    for (const bet of document.querySelectorAll('.table-bet:not([data-amount="0"])'))
      for (const marker of document.querySelectorAll('.table-position-chip'))
        if (overlaps(rect(marker),rect(bet))) problems.push(`${bet.getAttribute('aria-label')} covers ${marker.getAttribute('aria-label')}`);
    for (const stock of document.querySelectorAll('.stock-pile')) for (const seat of seats)
      if (overlaps(rect(stock),rect(seat))) problems.push(`stock covers seat ${seat.dataset.slot}`);
    for (let i = 0; i < seats.length; i++) for (let j = i+1; j < seats.length; j++)
      if (overlaps(rect(seats[i]),rect(seats[j]))) problems.push(`seats ${seats[i].dataset.slot}/${seats[j].dataset.slot}`);
    for (const card of board) {
      for (const seat of seats) if (overlaps(rect(card),rect(seat))) problems.push('board covers seat');
      for (const object of document.querySelectorAll('.stock-pile,.table-position-chip,.table-bet:not([data-amount="0"])'))
        if (overlaps(rect(card),rect(object))) problems.push(`board covers ${object.className}`);
    }
    if (raise) for (const el of document.querySelectorAll('.seat,.table-area .card,.table-bet:not([data-amount="0"])'))
      if (overlaps(rect(raise),rect(el))) problems.push('raise covers player/card');
    for (const el of document.querySelectorAll('.table-area .card,.seat,.bottombar .btn,.raise-controls')) {
      const b = rect(el);
      if (b.left < -1 || b.right > innerWidth + 1 || b.top < -1 || b.bottom > innerHeight + 1) problems.push(`clipped ${el.className}`);
    }
    const hand = rect(document.querySelector('.seat-viewer'));
    return { problems, width: innerWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth, surface: rect(document.querySelector('.table-surface')).height,
      handCenter: hand.left + hand.width / 2, raising: !!raise };
  });
  measurements.push({ name, ...metrics });
  await page.screenshot({ path: `${out}/${name}.png` });
  assert.deepEqual(metrics.problems, [], name);
  assert.ok(metrics.scrollHeight <= metrics.height + 1 && metrics.scrollWidth <= metrics.width + 1, `${name}: no page scroll`);
  if (metrics.width < 500 && metrics.height > 500 && !metrics.raising) {
    assert.ok(metrics.surface >= metrics.height * .5, `${name}: table takes at least half the screen`);
    assert.ok(Math.abs(metrics.handCenter - metrics.width / 2) < 1, `${name}: centered hand`);
  }
}
try {
  for (const [width,height] of [[320,568],[390,666],[390,844],[667,375],[1920,1080]]) {
    for (const players of [2,6,10]) {
      const page = await browser.newPage({ viewport: { width,height } });
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.goto(`${url}/test/fixtures/table-controls.html?seats=10&players=${players}`);
      await settle(page);
      assert.equal(await page.locator('.seat-empty').count(), 10-players);
      const label = `${width}x${height}-${players}`;
      await inspect(page, `${label}-playing`);
      await page.getByRole('button', {name:'もどる',exact:true}).click();
      assert.equal(await page.evaluate(() => window.tableFixture.exits()), 0);
      await page.getByRole('button', {name:'プレイを続ける',exact:true}).click();
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.evaluate(() => window.tableFixture.view(window.tableFixture.state().state.turnPlayerId));
      await page.getByRole('button', {name:'レイズ',exact:true}).click();
      await inspect(page, `${label}-raise`);
      await page.getByRole('button', {name:'やめる',exact:true}).click();
      await page.evaluate(() => window.tableFixture.view('p0'));
      while (await page.evaluate(() => window.tableFixture.state().state.phase === 'betting')) {
        await page.evaluate(() => window.tableFixture.advance());
        await settle(page);
      }
      await inspect(page, `${label}-showdown`);
      assert.ok(await page.locator('.card-highlighted').count() > 0);
      const offsets = await page.locator('.card-highlighted').evaluateAll(cards => cards.map(card => parseFloat(getComputedStyle(card).outlineOffset)));
      assert.ok(offsets.every(offset => offset <= -2), 'Highlights stay inside their card');
      await page.getByRole('button', {name:'もどる',exact:true}).click();
      await page.getByRole('button', {name:'終了して設定へ戻る',exact:true}).click();
      assert.equal(await page.evaluate(() => window.tableFixture.exits()), 1);
      await page.close();
      console.log(`PASS ${label}: space, empty seats, raise, showdown, exit confirmation`);
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(`${out}/geometry.json`, JSON.stringify(measurements,null,2));
  await browser.close();
}
