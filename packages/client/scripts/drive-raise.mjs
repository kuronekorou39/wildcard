/** Exercise chip-accurate entry, the nonlinear range, and real hit targets. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch();
const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
const out = 'shots-raise';
await mkdir(out, { recursive: true });
const errors = [];
try {
  const sizes = process.env.WILDCARD_SIZES ? process.env.WILDCARD_SIZES.split(',').map(s => s.split('x').map(Number))
    : [[320,568], [390,844], [667,375], [1100,700], [1920,1080], [2560,1440]];
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${url}/test/fixtures/table-controls.html`);
    await page.evaluate(() => window.tableFixture.view('p3'));
    await page.getByRole('button', { name: 'レイズ', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'レイズ先の金額', exact: true });
    const plus = page.getByRole('button', { name: '1チップ増やす', exact: true });
    const minus = page.getByRole('button', { name: '1チップ減らす', exact: true });
    const slider = page.getByRole('slider', { name: 'レイズ額', exact: true });
    const confirm = page.locator('.action-row-confirm .btn-raise');
    const sent = () => page.evaluate(() => window.tableFixture.sent());
    assert.equal(await input.inputValue(), '40');
    assert.equal(await minus.isDisabled(), true);
    await plus.click(); assert.equal(await input.inputValue(), '41');
    await minus.click(); assert.equal(await input.inputValue(), '40');
    await input.fill('125');
    await input.press('ArrowUp'); assert.equal(await input.inputValue(), '126');
    await input.press('ArrowDown'); assert.equal(await input.inputValue(), '125');
    await input.press('Enter'); assert.deepEqual(await sent(), [], 'Enter does not place a bet');
    for (const invalid of ['', '39', '1001', '40.5', '-40', '9007199254740992']) {
      await input.fill(invalid);
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal(await confirm.isDisabled(), true, `Invalid entry ${invalid} cannot be sent`);
      await input.press('Enter'); assert.deepEqual(await sent(), []);
    }
    await slider.fill('500'); assert.equal(await input.inputValue(), '200');
    await slider.press('ArrowUp'); assert.equal(await input.inputValue(), '201');
    await slider.press('ArrowDown'); assert.equal(await input.inputValue(), '200');
    await slider.press('PageUp'); assert.equal(await input.inputValue(), '220');
    await slider.press('Home'); assert.equal(await input.inputValue(), '40');
    await slider.press('End'); assert.equal(await input.inputValue(), '1000');
    assert.equal(await plus.isDisabled(), true);
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.ok(Math.abs(Number(await input.inputValue()) - 200) <= 3, 'Halfway along the physical slider selects 200');
    for (const button of await page.locator('.btn-quick').all()) {
      const expected = Number((await button.locator('strong').innerText()).replaceAll(',', ''));
      await button.click();
      assert.equal(Number(await input.inputValue()), expected);
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    const clipped = await page.locator('.raise-controls .btn').evaluateAll(buttons => buttons.flatMap(button => {
      const b = button.getBoundingClientRect(), problems = [];
      if (b.height < 35 || b.width < 29) problems.push('small target');
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      if (!button.contains(hit)) problems.push('blocked target');
      for (const text of button.querySelectorAll('span,strong')) {
        const range = document.createRange(); range.selectNodeContents(text);
        const r = range.getBoundingClientRect();
        if (r.top < b.top || r.bottom > b.bottom || r.left < b.left || r.right > b.right) problems.push('clipped label');
      }
      return problems;
    }));
    assert.deepEqual(clipped, [], `${width}: every preset and increment button is readable and clickable`);
    await input.fill('125'); await input.blur();
    await page.screenshot({ path: `${out}/${width}x${height}.png` });
    await confirm.click();
    assert.deepEqual(await sent(), [{ type: 'raise', playerId: 'p3', to: 125 }]);
    console.log(`${width}x${height}: ±1, direct entry, invalid input, nonlinear slider, keyboard, presets, exact bet: passed`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
