import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { editValue } from './setup-helpers.mjs';

const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.WILDCARD_SHOTS ?? 'shots-preview-settings';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
/** −／＋ を delta 回押す。枚数は数字を打たず、ボタンで動かす。 */
const step = async (page, label, delta) => {
  const name = `${label}を${delta > 0 ? '増やす' : '減らす'}`;
  for (let i = 0; i < Math.abs(delta); i++) await page.getByRole('button', { name, exact: true }).click();
};
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
    await editValue(page, '名前', '9♥ が3枚');
    await page.getByRole('tab', { name: /デッキ/ }).click();
    await page.getByRole('button', { name: '9♥ 1枚', exact: true }).click();
    await step(page, '9♥', 2);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: '9♥ 3枚', exact: true }).count(), 1);
    const preview = page.getByRole('region', { name: 'デッキの構成' });
    assert.match(await preview.innerText(), /54 枚/);
    // 種類ごとに1枚で、枚数は札の右上
    assert.equal(await preview.locator('button[aria-label="9♥ 3枚"] .deck-count').innerText(), '×3');
    if (width === 1920) {
      await step(page, '各カードの枚数', 18);
      await step(page, 'ジョーカー', 28);
      // 9♥ だけ3枚なので 52×19 − 19 + 3 + 28 = ちょうど 1000 枚。上限ぴったりは通る。
      assert.match(await preview.innerText(), /1000 枚/);
      assert.equal(await preview.locator('.hint-warn').count(), 0);
      assert.equal(await preview.locator('button[aria-label="JOKER 28枚"] .deck-count').innerText(), '×28');
      await step(page, '各カードの枚数', 1);
      assert.match(await preview.innerText(), /1000 枚を超えています/);
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
      await step(page, '各カードの枚数', -19);
      await step(page, 'ジョーカー', -28);
      // ジョーカーは0枚なら一覧に出ない
      assert.equal(await preview.locator('button[aria-label^="JOKER"]').count(), 0);
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), false);
    }
    await preview.scrollIntoViewIfNeeded();
    await fit(page);
    const scroll = page.locator('.editor-content');
    assert.ok(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth + 1), '一覧: 横スクロールが出ない');
    await page.screenshot({ path: `${out}/deck-${width}.png` });
    // 一覧は強い順（♠の行の先頭が A）。ジョーカーは0枚なので行が無い。
    assert.equal(await preview.locator('.deck-contents-row').first().locator('.card').first().getAttribute('aria-label'), 'A♠');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await page.getByRole('button', { name: 'このルールを編集', exact: false }).click();
    await page.getByRole('tab', { name: /デッキ/ }).click();
    assert.equal(await page.getByRole('button', { name: '9♥ 3枚', exact: true }).count(), 1);
    await page.getByRole('button', { name: '戻る', exact: true }).click();
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
