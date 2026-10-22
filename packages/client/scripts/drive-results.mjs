import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const out = 'shots-results';
await mkdir(out, { recursive: true });
const checks = [], errors = [];
try {
  for (const [width, height] of [[320,568], [390,844], [719,800], [1024,768], [1100,700], [1280,900], [1920,1080], [2560,1440], [667,375], [844,390]]) {
    for (const [count, twice] of [[2, false], [6, false], [10, false], [2, true], [10, true]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:5173/test/fixtures/table-results.html?seats=${count}${twice ? '&twice=1' : ''}`);
      await page.waitForTimeout(650);
      const result = await page.evaluate(() => {
        const r = n => n.getBoundingClientRect();
        const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        const blockers = [...document.querySelectorAll('.seat,.game-corner,.table-position-chip')];
        const overlap = [...document.querySelectorAll('.showdown-result,.community-cards .card')].flatMap(n => blockers.filter(b => hit(r(n), r(b))).map(b => b.className));
        const footerOverlap = [...document.querySelectorAll('.seat,.showdown-result')].filter(n => hit(r(n), r(document.querySelector('.summary-compact')))).map(n => n.className);
        const incorrectDepletion = [...document.querySelectorAll('.seat')].filter(seat =>
          seat.classList.contains('seat-depleted') !== (seat.querySelector('.seat-chips')?.textContent === '0')).length;
        return { scroll: document.documentElement.scrollHeight > innerHeight, overlap, footerOverlap,
          incorrectDepletion,
          winners: document.querySelectorAll('.seat-winner').length, ranking: document.querySelector('.winner-ranking').textContent };
      });
      checks.push({ width, height, count, twice, ...result });
      if (twice) assert.equal(await page.locator('.community-cards').count(), 2);
      const next = page.getByRole('button', { name: '次の獲得者', exact: true });
      if (await next.count()) {
        const name = await page.locator('.winner-name').innerText();
        await next.click();
        assert.notEqual(await page.locator('.winner-name').innerText(), name);
      }
      await page.screenshot({ path: `${out}/${width}x${height}-${count}${twice ? '-twice' : ''}.png` });
      await page.close();
    }
  }
  const failures = checks.filter(c => c.scroll || c.overlap.length || c.footerOverlap.length || c.incorrectDepletion || !c.winners || !c.ranking);
  await writeFile(`${out}/qa.json`, JSON.stringify({ checks, errors, failures }, null, 2));
  console.log(JSON.stringify({ count: checks.length, errors, failures }, null, 2));
  assert.equal(errors.length + failures.length, 0);
} finally { await browser.close(); }
