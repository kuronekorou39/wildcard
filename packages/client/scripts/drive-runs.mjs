/**
 * ランイットトゥワイスを実際に触る。
 *
 * ソロ卓でわざとオールインし、「2本走るか」を聞かれ、同意して
 * **2本のボードが並ぶ**ところまでを見る。CPU は断らない。
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const URL = process.env.WILDCARD_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.WILDCARD_SHOTS ?? 'shots';
const RULE = process.env.WILDCARD_RULE ?? 'カジュアル卓';

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.WILDCARD_BROWSER });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on('console', (m) => m.type() === 'error' && console.log('[browser error]', m.text()));
page.on('pageerror', (e) => console.log('[page error]', e.message));

const labels = async (selector) =>
  (
    await page
      .locator(selector)
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  ).filter((label) => label && label !== '裏向きのカード');

await page.goto(URL);
await page.getByRole('tab', { name: 'ソロ' }).click();
await page.locator('.field', { hasText: 'ルール' }).locator('select').selectOption(RULE);
console.log(`ルール: ${RULE}`);

// CPU 1人（ヘッズアップ）にして、オールインまでの手数を減らす。
const opponents = page.locator('.field', { hasText: 'CPU' }).locator('input[type=range]');
if (await opponents.count()) await opponents.first().fill('1');

await page.getByRole('button', { name: 'はじめる' }).click();
await page.getByRole('button', { name: 'ゲーム開始' }).click();
await page.waitForTimeout(600);

// オールインする。
let asked = false;
for (let step = 0; step < 40; step++) {
  if (await page.locator('.run-choice').count()) {
    asked = true;
    break;
  }
  if (await page.locator('.summary').count()) break;

  const raise = page.getByRole('button', { name: 'レイズ', exact: true });
  if (await raise.count()) {
    await raise.click();
    await page.getByRole('button', { name: 'オールイン' }).click();
    const confirm = page.getByRole('button', { name: /^(オールイン|にレイズ|レイズ)/ }).last();
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(500);
    continue;
  }

  const call = page.getByRole('button', { name: /^コール/ });
  const check = page.getByRole('button', { name: 'チェック' });
  if (await call.count()) await call.click();
  else if (await check.count()) await check.click();
  else {
    await page.waitForTimeout(300);
    continue;
  }
  await page.waitForTimeout(400);
}

console.log(`聞かれた: ${asked ? 'はい' : 'いいえ'}`);
if (!asked) {
  console.log('オールインまで行けなかった。CPU が降りた可能性がある。');
  await page.screenshot({ path: `${SHOTS}/20-runs-failed.png`, fullPage: true });
  await browser.close();
  process.exit(1);
}

console.log(`  文言: ${(await page.locator('.run-choice-note').innerText()).replace(/\s+/g, ' ').trim()}`);
await page.screenshot({ path: `${SHOTS}/20-run-choice.png`, fullPage: true });

// 同意する。CPU も同意するので2本走る。
await page.locator('.run-choice').getByRole('button', { name: /本走る/ }).click();
await page.locator('.summary-compact').waitFor({ timeout: 30000 });
const stopAuto = page.getByRole('button', { name: '自動開始を停止', exact: true });
if (await stopAuto.count()) await stopAuto.click();

const rows = page.locator('.community-cards');
console.log(`--- 走った --- ボード ${await rows.count()}本`);
for (let i = 0; i < (await rows.count()); i++) {
  const cards = await rows
    .nth(i)
    .locator('.card')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  console.log(`  ${i + 1}本目: ${cards.filter(Boolean).join(' ')}`);
}

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [667, 375]]) {
  await page.setViewportSize({ width, height });
  const layout = await page.evaluate(() => {
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const objects = [...document.querySelectorAll('.seat, .table-surface .table-position-chip')].map(el => el.getBoundingClientRect());
    const covered = [...document.querySelectorAll('.community-cards .card')].some(el => objects.some(r => intersects(el.getBoundingClientRect(), r)));
    return { covered, overflow: document.documentElement.scrollHeight > innerHeight };
  });
  assert.deepEqual(layout, { covered: false, overflow: false });
  await page.screenshot({ path: `${SHOTS}/21-boards-${width}x${height}.png` });
}
await page.setViewportSize({ width: 420, height: 900 });
await page.getByRole('button', { name: '結果の詳細', exact: true }).click();
const runs = page.locator('.summary-run');
console.log(`--- 内訳 --- ${await runs.count()}件`);
for (let i = 0; i < (await runs.count()); i++) {
  console.log(`  ${(await runs.nth(i).innerText()).replace(/\s+/g, ' ').trim()}`);
}

const payouts = await page.locator('.summary-payouts li').allInnerTexts();
console.log(`合計の配当: ${payouts.map((t) => t.replace(/\s+/g, ' ').trim()).join(' / ')}`);

// 同じ札が2本のボードに出ていないこと。
const all = await labels('.community-cards .card');
console.log(`場の札 ${all.length}枚 / 重複 ${all.length - new Set(all).size}枚`);

await page.screenshot({ path: `${SHOTS}/21-run-result.png`, fullPage: true });
await browser.close();
