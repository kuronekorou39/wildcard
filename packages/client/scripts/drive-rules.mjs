/**
 * 役の順位表（RuleSheet）を実際のブラウザで開いて撮る。
 *
 * 例の生成はエンジン側でテストしてあるが、「読めるか」は画面を見ないと
 * 分からない。札が小さすぎる、ワイルドの注記が折り返して崩れる、
 * 行が詰まって役の区切りが分からない——そういう話。
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { chooseRule } from './setup-helpers.mjs';

const URL = process.env.WILDCARD_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.WILDCARD_SHOTS ?? 'shots';
// 独自役・ワイルド・変則デッキを一通り見る。
const VARIANTS = (process.env.WILDCARD_VARIANTS ?? 'ジョーカー1枚,素数ストレートあり,独自役入り（ミニストレート・ペア＋三連）,ショートデッキ（6+）').split(',');

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.WILDCARD_BROWSER });
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
page.on('console', (m) => m.type() === 'error' && console.log('[browser error]', m.text()));
page.on('pageerror', (e) => console.log('[page error]', e.message));

await page.goto(URL);

for (const name of VARIANTS) {
  await chooseRule(page, name);
  await page.getByRole('button', { name: 'ルール詳細', exact: true }).click();

  // ルール詳細はダイアログで、順位表は最初から開いている（折りたたみの枠は無い）。
  await page.locator('.rule-sheet-list').waitFor();
  await page.waitForTimeout(150);

  const rows = page.locator('.rule-sheet-list > li');
  const count = await rows.count();
  const none = await page.locator('.rule-row-example-none').count();
  const wilds = await page.locator('.rule-row-wilds').allInnerTexts();

  console.log(`\n=== ${name} ===`);
  console.log(`  役の数: ${count} / 例が作れなかった役: ${none}`);
  if (wilds.length > 0) console.log(`  ワイルドの注記: ${wilds.join(' | ')}`);

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const label = (await row.locator('.rule-row-name').innerText()).trim();
    const cards = await row.locator('.card').evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label')),
    );
    console.log(`  ${label.padEnd(16)} ${cards.join(' ')}`);
  }

  const file = `${SHOTS}/rules-${VARIANTS.indexOf(name)}.png`;
  await page.getByRole('dialog').screenshot({ path: file });
  console.log(`  → ${file}`);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
}

await browser.close();
