import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { editValue } from './setup-helpers.mjs';

const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.WILDCARD_SHOTS ?? 'shots-setup-options';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
async function fits(page, name) {
  const dimensions = await page.evaluate(() => {
    const fields = document.querySelector('[role=tabpanel]:not([hidden]) .session-fields');
    const launch = document.querySelector('[role=tabpanel]:not([hidden]) .session-launch');
    return { overflow: document.documentElement.scrollHeight - innerHeight,
      width: document.documentElement.scrollWidth - innerWidth,
      fields: fields.scrollHeight - fields.clientHeight, bottom: launch.getBoundingClientRect().bottom - innerHeight };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  assert.ok(Object.values(dimensions).every(value => value <= 1), `${name}: ${JSON.stringify(dimensions)}`);
}
try {
  for (const [width, height] of [[320,568],[390,844],[768,1024],[667,375],[1920,1080]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await fits(page, `${width}-solo`);
    assert.equal(await page.getByRole('button', { name: 'バナー', exact: true }).count(), 0);
    const preview = page.locator('.preview-badge');
    const trigger = await preview.boundingBox();
    await preview.click();
    const dialog = await page.locator('.preview-dialog').boundingBox();
    assert.ok(dialog.y >= trigger.y + trigger.height + 7, 'Preview remains below its button');
    assert.ok(dialog.y + dialog.height <= height - 10, 'Preview fits the viewport');
    await page.screenshot({ path: `${out}/${width}-preview.png` });
    await page.keyboard.press('Escape');
    assert.equal(await preview.evaluate(el => el === document.activeElement), true);

    await page.locator('.rule-select-trigger').click();
    assert.equal(await page.getByRole('searchbox').count(), 0);
    const all = await page.locator('.rule-option').count();
    await page.getByRole('button', { name: '検索・絞り込み', exact: true }).click();
    await page.getByRole('searchbox').fill('オマハ');
    assert.ok(await page.locator('.rule-option').count() > 0);
    assert.ok(await page.locator('.rule-option').count() < all);
    await page.getByRole('button', { name: '自作', exact: true }).click();
    assert.equal(await page.locator('.rule-option').count(), 0);
    await page.getByRole('button', { name: '条件をクリア', exact: true }).click();
    await page.getByRole('button', { name: /^詳細条件/ }).click();
    await page.getByLabel('手札枚数', { exact: true }).selectOption('4');
    assert.ok(await page.locator('.rule-option').count() > 0);
    assert.ok((await page.locator('.rule-option').allTextContents()).every(text => text.includes('手札4枚')));
    await page.screenshot({ path: `${out}/${width}-filters.png` });
    const list = await page.locator('.rule-options').boundingBox();
    assert.ok(list.height >= 60 && list.y + list.height <= height, 'Results remain reachable with advanced filters');
    await page.getByRole('button', { name: '検索を閉じる', exact: true }).click();
    assert.equal(await page.locator('.rule-option').count(), all, 'Collapsed search clears hidden conditions');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'オンライン', exact: true }).click();
    for (const connection of ['P2P', 'サーバー']) {
      await page.locator('.online-connection-switch').getByRole('button', { name: connection, exact: true }).click();
      await page.locator('.session-fields .segmented').getByRole('button', { name: '部屋を作る', exact: true }).click();
      await fits(page, `${width}-${connection === 'P2P' ? 'p2p' : 'server'}-host`);
      if (connection === 'サーバー') {
        await editValue(page, 'あなたの名前', '接続確認');
        await page.getByRole('button', { name: '作成キーの設定', exact: true }).click();
        assert.equal(await page.getByRole('textbox', { name: '接続先URL' }).count(), 0, '接続先URLは画面に出さない');
        await page.getByLabel('作成キー', { exact: true }).fill('');
        await page.screenshot({ path: `${out}/${width}-server-settings.png` });
        await page.keyboard.press('Escape');
        assert.match(await page.locator('.server-endpoint').innerText(), /キーが必要/);
        assert.equal(await page.getByRole('button', { name: '卓を作る', exact: false }).isDisabled(), true);
        await page.getByRole('button', { name: '作成キーの設定', exact: true }).click();
        await page.getByLabel('作成キー', { exact: true }).fill('qa-key-not-sent');
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('button', { name: '卓を作る', exact: false }).isEnabled(), true);
        await page.getByRole('button', { name: '作成キーの設定', exact: true }).click();
        await page.getByLabel('作成キー', { exact: true }).fill('');
        await page.keyboard.press('Escape');
      }
      await page.locator('.session-fields .segmented').getByRole('button', { name: '参加する', exact: true }).click();
      await fits(page, `${width}-${connection === 'P2P' ? 'p2p' : 'server'}-guest`);
      if (connection === 'サーバー') {
        assert.match(await page.locator('.server-endpoint').innerText(), /キー不要/);
        await page.getByRole('textbox', { name: '招待リンク / 卓ID', exact: true }).fill('00000000-0000-4000-8000-000000000001');
        assert.equal(await page.locator('.server-session .session-launch .btn').isEnabled(), true);
        assert.equal(await page.getByRole('button', { name: '作成キーの設定', exact: true }).count(), 0, '参加者にキー設定は出さない');
      }
    }
    await page.close();
    console.log(`PASS ${width}x${height}: preview, search, filters, form spacing, host/guest connection settings`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
