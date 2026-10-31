import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chooseRule } from './setup-helpers.mjs';

const URL = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173/';
const OUT = process.env.WILDCARD_SHOTS ?? 'shots-workspace';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.WILDCARD_BROWSER });
const errors = [];
const viewports = [[320,568], [390,844], [768,1024], [667,375], [1280,720], [1920,1080]];
try {
  for (const [width, height] of viewports) {
    const page = await browser.newPage({ viewport: { width, height }, isMobile: width < 800, hasTouch: width < 800 });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(URL);
    await page.locator('.rule-select-trigger').waitFor();
    for (const mode of ['ソロ', 'オンライン']) {
      await page.getByRole('tab', { name: new RegExp(`^${mode}`) }).click();
      await page.screenshot({ path: `${OUT}/${width}-${mode === 'ソロ' ? 'solo' : 'online'}.png` });
      const geometry = await page.evaluate(() => {
        const launch = document.querySelector('[role=tabpanel]:not([hidden]) .session-launch').getBoundingClientRect();
        const fields = document.querySelector('[role=tabpanel]:not([hidden]) .session-fields');
        return { width: innerWidth, height: innerHeight, docWidth: document.documentElement.scrollWidth, docHeight: document.documentElement.scrollHeight, launchBottom: launch.bottom, fieldsScroll: fields.scrollHeight - fields.clientHeight };
      });
      assert.ok(geometry.docWidth <= width && geometry.docHeight <= height + 1 && geometry.launchBottom <= height, JSON.stringify({ width, mode, geometry }));
      assert.ok(geometry.fieldsScroll <= 1, `${width} ${mode}: settings need ${geometry.fieldsScroll}px scrolling`);
      console.log(`${width}x${height} ${mode}: page fits, settings scroll ${geometry.fieldsScroll}px`);
    }
    await page.getByRole('tab', { name: /^ソロ/ }).click();
    await page.getByRole('button', { name: '初期チップを編集', exact: true }).click();
    await page.getByRole('spinbutton', { name: '初期チップ', exact: true }).fill('2000');
    await page.keyboard.press('Enter');
    assert.match(await page.getByRole('button', { name: '初期チップを編集', exact: true }).innerText(), /2,000/);
    await page.getByRole('button', { name: '初期チップを編集', exact: true }).click();
    await page.getByRole('spinbutton', { name: '初期チップ', exact: true }).fill('3000');
    await page.keyboard.press('Escape');
    assert.match(await page.getByRole('button', { name: '初期チップを編集', exact: true }).innerText(), /2,000/);
    await page.locator('.rule-select-trigger').click();
    await page.screenshot({ path: `${OUT}/${width}-rules.png` });
    await page.getByRole('button', { name: '検索・絞り込み', exact: true }).click();
    await page.getByRole('searchbox', { name: 'ルールを検索' }).fill('オマハ');
    await page.getByRole('option').first().click();
    assert.match(await page.locator('.selected-rule-title').innerText(), /オマハ/);
    await page.getByRole('button', { name: 'これを元に作る' }).click();
    await page.locator('.rules-shell').waitFor();
    for (const section of ['ルール情報', 'デッキ', '配り方', '賭け方', '役の強さ', '卓の作法', '受け渡し']) {
      await page.getByRole('tab', { name: new RegExp(section) }).click();
      if (['ルール情報', 'デッキ', '配り方', '役の強さ'].includes(section)) await page.screenshot({ path: `${OUT}/${width}-editor-${section === 'ルール情報' ? 'info' : section === '配り方' ? 'structure' : section === '役の強さ' ? 'ranking' : 'deck'}.png` });
      const geometry = await page.evaluate(() => {
        const content = document.querySelector('.editor-content').getBoundingClientRect();
        return { docHeight: document.documentElement.scrollHeight, docWidth: document.documentElement.scrollWidth, bottom: content.bottom };
      });
      assert.ok(geometry.docHeight <= height + 1 && geometry.docWidth <= width + 1 && geometry.bottom <= height + 1, `${width} ${section}: ${JSON.stringify(geometry)}`);
    }
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await page.locator('.setup-shell').waitFor({ state: 'visible' });
    assert.match(await page.getByRole('button', { name: '初期チップを編集', exact: true }).innerText(), /2,000/);
    assert.match(await page.locator('.selected-rule-title').innerText(), /写し/);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(URL);
  await page.getByRole('button', { name: '初期チップを編集', exact: true }).click();
  await page.getByRole('spinbutton', { name: '初期チップ', exact: true }).fill('0');
  await page.keyboard.press('Enter');
  assert.match(await page.getByRole('alert').innerText(), /整数/);
  assert.match(await page.getByRole('button', { name: '初期チップを編集', exact: true }).innerText(), /1,000/);
  await page.getByRole('button', { name: 'BBを編集', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'BB', exact: true }).fill('2000');
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('button', { name: 'はじめる', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'BBを編集', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'BB', exact: true }).fill('20');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'これを元に作る', exact: true }).click();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 300;
    const context = canvas.getContext('2d');
    context.fillStyle = '#263f42'; context.fillRect(0, 0, 900, 300);
    context.fillStyle = '#dbc5a6'; context.beginPath(); context.arc(700, 150, 140, 0, Math.PI * 2); context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('バナー画像', { exact: true }).setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await page.locator('.banner-editor img').waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  const source = await page.locator('.rule-select-trigger img').getAttribute('src');
  assert.match(source, /^data:image\/webp;base64,/);
  await page.locator('.rule-select-trigger').click();
  const customId = await page.getByRole('option', { selected: true }).getAttribute('data-variant');
  await page.keyboard.press('Escape');
  await page.reload();
  await chooseRule(page, customId);
  assert.equal(await page.locator('.rule-select-trigger img').getAttribute('src'), source);
  await page.locator('.rule-select-trigger').click();
  assert.equal(await page.locator(`[data-variant="${customId}"] img`).getAttribute('src'), source);
  await page.getByRole('button', { name: '検索・絞り込み', exact: true }).click();
  await page.getByRole('searchbox').fill('オマハ');
  await page.getByRole('searchbox').press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('.selected-rule-title').innerText(), /オマハ/);
  assert.equal(await page.locator('.rule-select-trigger img').count(), 0);
  await chooseRule(page, customId);
  await page.getByRole('button', { name: 'このルールを編集' }).click();
  assert.equal(await page.locator('.banner-editor img').getAttribute('src'), source);
  await page.getByRole('button', { name: '名前を編集', exact: true }).click();
  await page.getByRole('textbox', { name: '名前', exact: true }).fill('バナー確認');
  await page.getByRole('textbox', { name: '名前', exact: true }).dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  assert.equal(await page.getByRole('textbox', { name: '名前', exact: true }).isVisible(), true, 'IME confirmation must keep editing');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  assert.equal(await page.locator('.rule-select-trigger img').getAttribute('src'), source);
  assert.match(await page.locator('.selected-rule-title').innerText(), /バナー確認/);
  await page.screenshot({ path: `${OUT}/uploaded-banner.png` });
  await page.getByRole('button', { name: 'このルールを編集' }).click();
  await page.getByRole('button', { name: 'フォレスト', exact: true }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = () => { throw new Error('quota'); };
  });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /保存できません/);
  await page.evaluate(() => window.restoreStorage());
  // 未保存のまま戻ろうとすると聞かれる。捨てて戻る。
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await page.getByRole('button', { name: '保存せずに戻る', exact: true }).click();
  assert.equal(await page.locator('.rule-select-trigger img').getAttribute('src'), source);
  await page.getByRole('button', { name: 'このルールを編集' }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = () => { throw new Error('quota'); };
  });
  await page.getByRole('button', { name: 'フォレスト', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.match(await page.getByRole('alert').innerText(), /保存できません/);
  assert.equal(await page.locator('.rules-shell').isVisible(), true);
  await page.evaluate(() => window.restoreStorage());
  await page.close();
  assert.deepEqual(errors, []);
  console.log('Workspace: viewports, editing, rule selection, upload persistence, inherited banners, keyboard selection and quota failures: passed');
} finally { await browser.close(); }
