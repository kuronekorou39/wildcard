import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
const out = process.env.WILDCARD_SHOTS ?? 'shots-seat-markers';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [], failures = [];
async function settle(page) {
  const end = await page.evaluate(() => Math.max(window.tableFixture.state().runtime.readyAt,
    ...window.tableFixture.state().runtime.events.map(e => e.at + 3000)) - Date.now());
  if (end > 0) await page.clock.fastForward(end);
  await page.clock.runFor(50);
  await page.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });
  await page.clock.runFor(50);
}
async function inspect(page) {
  return page.evaluate(() => {
    const problems = [];
    const box = el => el.getBoundingClientRect();
    const overlaps = (a, b) => Math.min(a.right,b.right) - Math.max(a.left,b.left) > 2 && Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 2;
    const markers = [...document.querySelectorAll('.table-seat-markers .table-position-chip')];
    const bets = [...document.querySelectorAll('.table-bet:not([data-amount="0"])')];
    const obstacles = [...document.querySelectorAll('.seat-profile,.seat-empty,.seat-cards .card,.stock-pile,.community-cards .card,.table-pot')];
    for (const [i, marker] of markers.entries()) {
      for (const object of [...obstacles, ...bets, ...markers.slice(i + 1)]) {
        if (overlaps(box(marker), box(object))) problems.push(`${marker.getAttribute('aria-label')} covers ${object.className} ${object.closest('.seat')?.dataset.slot ?? ''}`);
      }
    }
    for (const [i, bet] of bets.entries()) for (const object of [...obstacles, ...bets.slice(i + 1)]) {
      if (overlaps(box(bet), box(object))) problems.push(`${bet.getAttribute('aria-label')} covers ${object.className} ${object.closest('.seat')?.dataset.slot ?? ''}`);
    }
    for (const el of [...markers, ...bets, ...document.querySelectorAll('.seat-cards .card')]) {
      const r = box(el);
      if (r.top < -1 || r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) problems.push(`clipped ${el.className}`);
    }
    if (document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1) problems.push('page scroll');
    return problems;
  });
}
try {
  for (const [width,height] of [[320,568],[360,640],[390,666],[390,844],[667,375],[844,390],[768,1024]]) {
    for (const [seats, players] of [[2,2],[6,6],[10,6],[10,10]]) {
      const page = await browser.newPage({ viewport: { width,height } });
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.install();
      await page.goto(`${base}/test/fixtures/table-controls.html?seats=${seats}&players=${players}`);
      // Every player has chips in front; stop before BB checks and collects the round.
      await page.evaluate(() => {
        while (window.tableFixture.state().state.players.find(p => p.id === window.tableFixture.state().state.turnPlayerId).bet < 20)
          window.tableFixture.advance();
      });
      await settle(page);
      const ids = await page.evaluate(() => window.tableFixture.state().state.players.map(p => p.id));
      for (const id of ids) {
        await page.evaluate(id => window.tableFixture.view(id), id);
        await page.clock.runFor(50);
        const label = `${width}x${height}-${seats}seats-${players}players-${id}`;
        const problems = await inspect(page);
        if (problems.length) {
          failures.push({ label, problems });
          await page.screenshot({ path: `${out}/${label}.png` });
        } else if (seats === 10 && players === 10 && id === 'p7') await page.screenshot({ path: `${out}/${label}.png` });
      }
      await page.close();
    }
    console.log(`Checked ${width}x${height}: all viewpoints, 2/6/10 players, all live bets`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
} finally {
  await writeFile(`${out}/failures.json`, JSON.stringify(failures, null, 2));
  await browser.close();
}
