import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { editValue } from './setup-helpers.mjs';

const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.WILDCARD_SHOTS ?? 'shots-preview-settings';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const fit = async page => {
  const size = await page.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight]);
  assert.ok(size.every(n => n <= 1), `page overflow ${size}`);
};
try {
  for (const width of [390, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1080 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto(url);
    await editValue(page, 'アンティ / 人', 5);
    await page.getByRole('group', { name: 'CPU の人数' }).getByRole('button', { name: '9', exact: true }).click();
    await page.getByRole('button', { name: 'これを元に作る', exact: false }).click();
    await page.getByRole('tab', { name: /デッキ/ }).click();
    await page.locator('.deck-card-editor>summary').click();
    await page.getByRole('button', { name: '9♥ 1枚', exact: true }).click();
    await editValue(page, '9♥ の枚数', 3);
    assert.equal(await page.getByRole('button', { name: '9♥ 3枚', exact: true }).count(), 1);
    const preview = page.getByRole('region', { name: 'デッキの構成' });
    assert.match(await preview.innerText(), /54 枚/);
    assert.equal(await preview.locator('.card[aria-label="9♥"]').count(), 3);
    if (width === 1920) {
      await editValue(page, '各カードの枚数', 19);
      await editValue(page, 'ジョーカー', 28);
      assert.match(await preview.innerText(), /1000 枚/);
      for (let i = 0; i < 7; i++) await preview.getByRole('button', { name: '次へ', exact: true }).click();
      assert.equal(await preview.locator('.card').count(), 90);
      assert.equal(await preview.getByRole('button', { name: '次へ', exact: true }).isDisabled(), true);
      await editValue(page, '各カードの枚数', 99);
      assert.equal(await page.locator('.deck-contents .card').count(), 0);
      assert.equal(await page.getByRole('button', { name: '保存して卓に戻る', exact: true }).isDisabled(), true);
      await editValue(page, '各カードの枚数', 1);
      await editValue(page, 'ジョーカー', 0);
      // 54枚は1ページに収まるので、ページ送りは消える
      assert.equal(await preview.getByRole('button', { name: '次へ', exact: true }).count(), 0);
      assert.equal(await preview.locator('.card[aria-label="9♥"]').count(), 3);
    }
    for (const name of ['一覧', '重ね', '扇形']) {
      await preview.getByRole('button', { name, exact: true }).click();
      await preview.scrollIntoViewIfNeeded();
      await fit(page);
      const scroll = preview.locator('.deck-contents-scroll');
      assert.ok(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${name}: 横スクロールが出ない`);
      await page.screenshot({ path: `${out}/deck-${width}-${name === '一覧' ? 'grid' : name === '重ね' ? 'overlap' : 'arc'}.png` });
    }
    // 一覧は強い順（♠の行の先頭が A）、扇形は強い札が一番上（右端）に来る
    assert.equal(await preview.locator('.deck-contents-fan .card').last().getAttribute('aria-label'), 'A♠');
    await preview.getByRole('button', { name: '一覧', exact: true }).click();
    assert.equal(await preview.locator('.deck-contents-row').first().locator('.card').first().getAttribute('aria-label'), 'A♠');
    await page.getByRole('button', { name: '保存して卓に戻る', exact: true }).click();
    await page.getByRole('button', { name: 'このルールを編集', exact: false }).click();
    await page.getByRole('tab', { name: /デッキ/ }).click();
    await page.locator('.deck-card-editor>summary').click();
    assert.equal(await page.getByRole('button', { name: '9♥ 3枚', exact: true }).count(), 1);
    await page.getByRole('button', { name: '保存して卓に戻る', exact: true }).click();
    await page.getByRole('button', { name: /^はじめる/ }).click();
    await page.getByRole('button', { name: '卓の情報', exact: true }).click();
    assert.equal(await page.locator('.cpu-style-list span').count(), 9);
    for (const name of ['慎重', '標準', '強気']) assert.equal(await page.locator('.cpu-style-list span').filter({ hasText: name }).count(), 3);
    assert.match(await page.locator('.table-facts').innerText(), /アンティ \/ 人\s+5/);
    await page.getByRole('tab', { name: '見た目', exact: true }).click();
    const geometry = () => page.locator('.seat, .table-center, .table-position-marker').evaluateAll(nodes => nodes.map(n => {
      const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    }));
    const before = await geometry();
    const wide = await page.locator('.table-surface>.table-felt').boundingBox();
    await page.getByRole('button', { name: '標準', exact: true }).click();
    assert.deepEqual(await geometry(), before);
    assert.ok((await page.locator('.table-surface>.table-felt').boundingBox()).width < wide.width);
    await page.getByRole('button', { name: 'ワイド', exact: true }).click();
    for (const shape of ['オーバル', 'パース', 'ラウンドレクト']) {
      await page.getByRole('radio', { name: shape, exact: true }).check();
      assert.deepEqual(await geometry(), before);
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
      await fit(page);
      await page.screenshot({ path: `${out}/wide-${width}-${shape === 'オーバル' ? 'oval' : shape === 'パース' ? 'perspective' : 'racetrack'}.png` });
      await page.getByRole('button', { name: '卓の情報', exact: true }).click();
      await page.getByRole('tab', { name: '見た目', exact: true }).click();
    }
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: 'ゲーム開始', exact: true }).click();
    await page.clock.runFor(50);
    assert.match(await page.locator('.table-pot').innerText(), /50\s*（\+30）/);
    await page.screenshot({ path: `${out}/ante-${width}.png` });
    await page.getByRole('button', { name: 'もどる', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: 'ゲームを終了しますか？' }).count(), 1);
    await page.getByRole('button', { name: 'プレイを続ける', exact: true }).click();
    await page.getByRole('button', { name: 'もどる', exact: true }).click();
    await page.getByRole('button', { name: '終了して設定へ戻る', exact: true }).click();
    await page.locator('.setup-shell').waitFor();
    await page.close();
    console.log(`PASS ${width}: custom deck saved/reopened/played, all deck views, ante pot, mixed CPU, three shapes, positions fixed, exit`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
