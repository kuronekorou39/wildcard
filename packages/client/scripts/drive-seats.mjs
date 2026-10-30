import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
const out = process.env.WILDCARD_SHOTS ?? 'shots-seats';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  for (const [width, height] of [[320,568], [390,844], [719,800], [1280,900], [667,375]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${url}/test/fixtures/seat-layout.html`);
    const set = async next => {
      await page.evaluate(next => window.seatFixture.set(next), next);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const positions = () => page.locator('.seat-profile,.seat-avatar,.seat-name,.seat-chips,.seat-cards').evaluateAll(es =>
      es.map(e => ({ class: e.className, ...e.getBoundingClientRect().toJSON() })));
    for (const [seats, cards] of [[10,2], [10,4], [6,6], [2,8]]) {
      await set({ seats, cards, chips: 1234567890123, folded: false, exposed: false, dealt: true });
      assert.equal(await page.locator('.seat-viewer .card').count(), cards);
      assert.equal(await page.locator('.seat:not(.seat-viewer) .card:not(.card-back)').count(), 0);
      const before = await positions();
      const problems = await page.evaluate(() => {
        const r = el => el.getBoundingClientRect();
        const overlaps = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>2 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;
        const seats = [...document.querySelectorAll('.seat')];
        const problems = [];
        for (const seat of seats) {
          const chips = seat.querySelector('.seat-chips');
          if (chips.scrollWidth > chips.clientWidth + 1) problems.push('chip overflow');
          const text = document.createRange(); text.selectNodeContents(chips);
          if (overlaps(r(seat.querySelector('.seat-avatar')), text.getBoundingClientRect())) problems.push('avatar covers chip count');
          for (const card of seat.querySelectorAll('.card')) {
            if (overlaps(r(card), text.getBoundingClientRect())) problems.push('hand covers chip count');
            for (const other of seats.filter(s => s !== seat))
              if (overlaps(r(card), r(other.querySelector('.seat-profile')))) problems.push('hand covers another profile');
            const box = r(card);
            if (box.left < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight) problems.push('hand clipped');
          }
        }
        return problems;
      });
      assert.deepEqual(problems, [], `${width} / ${seats} seats / ${cards} cards`);
      await page.screenshot({ path: `${out}/${width}-${seats}-${cards}.png` });
      await set({ folded: true });
      assert.equal(await page.locator('.seat .card').count(), 0);
      assert.deepEqual(await positions(), before, 'Folding must not move any profile or reserved hand slot');
      await set({ exposed: true });
      assert.equal(await page.locator('.seat .card').count(), seats, 'Only explicitly exposed cards remain after folding');
      assert.ok(await page.locator('.seat:not(.seat-viewer) .card-index:not(.card-index-bottom)').evaluateAll(indices => indices.every(index => {
        const r = index.getBoundingClientRect();
        return index.closest('.card').contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })), 'Exposed opponent ranks and suits remain visible above their profiles');
      assert.deepEqual(await positions(), before);
      await set({ chips: 1000 });
      assert.deepEqual(await positions(), before, 'Changing the number of chip digits keeps the same slots');
      await set({ folded: false, exposed: false, dealt: false });
      const waiting = await positions();
      await set({ dealt: true });
      assert.deepEqual((await positions()).filter(p => p.class !== 'seat-cards'), waiting.filter(p => p.class !== 'seat-cards'), 'Dealing keeps every profile in place');
      await set({ depleted: true });
      assert.equal(await page.locator('.seat-depleted').count(), seats);
      assert.equal(await page.locator('.seat-viewer .card').count(), cards, 'An all-in player retains their hand');
      assert.equal(await page.locator('.seat-folded').count(), 0, 'Zero chips do not fold a player');
      assert.ok(await page.locator('.seat-depleted').first().evaluate(e => Number(getComputedStyle(e).opacity) < 1));
      await set({ depleted: false });
      assert.equal(await page.locator('.seat-depleted').count(), 0, 'A replenished stack restores the profile');
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('Stable profiles before deal, after folding, with exposed cards and large chip counts; 2/4/6/8-card fans: passed');
} finally { await browser.close(); }
