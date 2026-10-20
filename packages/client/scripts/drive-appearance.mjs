/** Card choices, persistence, privacy and table layout in a real browser. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.env.WILDCARD_SHOTS ?? 'shots-appearance';
const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [], checks = [];
const faces = ['classic', 'bold', 'four-color'];
const backs = ['dragon', 'diamond', 'monogram'];
const start = async (page, count = 6, rule = 'standard') => {
  await page.goto(url);
  await page.getByRole('tab', { name: 'ホットシート' }).click();
  for (let i = 2; i < count; i++) await page.getByRole('button', { name: '＋ 追加' }).click();
  await page.locator('select.input').selectOption(rule);
  await page.getByRole('button', { name: '卓につく', exact: true }).click();
  await page.getByRole('button', { name: 'ゲーム開始', exact: true }).click();
  assert.equal(await page.locator('.card').count(), 0, 'No cards in the handoff gate');
  await page.getByRole('button', { name: 'カードを見る', exact: true }).click();
};
const inspect = async (page, name) => {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflowing = [...document.querySelectorAll('body *')].filter(el => {
      if (!el.getClientRects().length || el.tagName === 'IMG') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.left < -2 || r.right > width + 2);
    }).map(el => `${el.tagName}.${el.className}`);
    const seats = [...document.querySelectorAll('.seat')].map(el => ({ slot: el.dataset.slot, r: el.getBoundingClientRect() }));
    const overlaps = [];
    for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i].r, b = seats[j].r;
      if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>2 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)
        overlaps.push([seats[i].slot,seats[j].slot]);
    }
    const coveredCards = [];
    for (const card of document.querySelectorAll('.table-center .card')) {
      const a = card.getBoundingClientRect();
      for (const {slot, r: b} of seats)
        if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>2 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)
          coveredCards.push(slot);
    }
    return { overflowing, overlaps, coveredCards, tableWidth: document.querySelector('.table-surface')?.getBoundingClientRect().width,
      brokenImages: [...document.images].filter(im => !im.complete || !im.naturalWidth).length };
  });
  checks.push({ name, ...result });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  const hand = await page.locator('.seat-viewer .card').evaluateAll(cards => cards.map(c => c.getAttribute('aria-label')));
  await inspect(page, 'table-desktop');
  const trigger = page.getByRole('button', { name: 'カードのデザイン' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  for (const face of faces) for (const back of backs) {
    await dialog.locator(`input[name="card-face"][value="${face}"]`).check();
    await dialog.locator(`input[name="card-back"][value="${back}"]`).check();
    assert.equal(await page.locator(`.seat-viewer .card-face-${face}`).count(), 2);
    assert.equal(await page.locator(`.seat:not(.seat-viewer) .card-back-${back}`).count(), 10);
    assert.deepEqual(await page.locator('.seat-viewer .card').evaluateAll(cards => cards.map(c => c.getAttribute('aria-label'))), hand);
    assert.equal(await dialog.locator('.appearance-preview .card').count(), 5);
  }
  await page.screenshot({ path: `${out}/card-designs-desktop.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true, 'Focus returns to the trigger');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wildcard.card-appearance.v1')));
  assert.deepEqual(saved, { face: 'four-color', back: 'monogram' });
  await start(page);
  assert.equal(await page.locator('.seat-viewer .card-face-four-color').count(), 2);
  assert.equal(await page.locator('.seat:not(.seat-viewer) .card-back-monogram').count(), 10);
  // See the enlarged board with real face-up cards.
  for (let i = 0; i < 20 && await page.locator('.community-cards .card:not(.card-slot)').count() === 0; i++) {
    if (await page.locator('.gate').count()) await page.getByRole('button', { name: 'カードを見る', exact: true }).click();
    else if (await page.getByRole('button', { name: 'チェック', exact: true }).count())
      await page.getByRole('button', { name: 'チェック', exact: true }).click();
    else await page.getByRole('button', { name: /^コール/ }).click();
  }
  await inspect(page, 'table-desktop-flop');
  // A browser that rejects persistence must still apply the design for this session.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await trigger.click();
  await dialog.locator('input[name="card-face"][value="bold"]').check();
  assert.equal(await page.locator('.seat-viewer .card-face-bold').count(), 2);
  assert.match(await dialog.getByRole('status').innerText(), /保存はできませんでした/);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.close();

  for (const width of [320, 390, 720, 1024]) {
    for (const [count, rule] of [[2, 'standard'], [6, 'standard'], [7, 'standard'], [8, 'standard'], [9, 'standard'], [10, 'omaha'], [6, 'six-card-flop']]) {
      const p = await browser.newPage({ viewport: { width, height: width < 720 ? 844 : 900 } });
      p.on('pageerror', error => errors.push(error.message));
      await start(p, count, rule);
      await inspect(p, `table-${width}-${count}-${rule}`);
      if (count === 6 && rule === 'standard') {
        await p.getByRole('button', { name: 'カードのデザイン' }).click();
        await p.getByRole('dialog').waitFor();
        await inspect(p, `card-designs-${width}`);
        // All settings remain reachable on a narrow screen.
        await p.locator('input[name="card-back"][value="diamond"]').check();
        await p.getByRole('button', { name: '閉じる', exact: true }).click();
        await p.getByRole('dialog').waitFor({ state: 'detached' });
      }
      await p.close();
    }
  }
  const failures = checks.filter(c => c.overflowing.length || c.overlaps.length || c.coveredCards.length || c.brokenImages);
  await writeFile(`${out}/qa.json`, JSON.stringify({ errors, checks }, null, 2));
  console.log(JSON.stringify({ combinations: 9, persistence: 'passed', privacy: 'passed', total: checks.length, errors, failures }, null, 2));
  assert.equal(errors.length + failures.length, 0);
} finally {
  await browser.close();
}
