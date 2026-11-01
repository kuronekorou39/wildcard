/**
 * ルールの編集画面を実際に触る。
 *
 * ここは Wildcard の主役なので、「保存できた」ではなく
 * **作ったルールでそのまま遊べる**ところまでを一度に確かめる。
 * 旧 poker-web-20250702 の HouseRulesPage.tsx は、作る画面だけが育って
 * 遊ぶところへ繋がらないまま 3,651行で止まった。
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { editValue } from './setup-helpers.mjs';

/** −／＋ の数字を押して直接入力する。 */
async function setNumber(page, label, value) {
  await page.getByRole('button', { name: new RegExp(`^${label}を入力`) }).click();
  await page.getByRole('spinbutton', { name: label, exact: true }).fill(String(value));
  await page.keyboard.press('Enter');
}

const URL = process.env.WILDCARD_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.WILDCARD_SHOTS ?? 'shots';

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.WILDCARD_BROWSER });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on('console', (m) => m.type() === 'error' && console.log('[browser error]', m.text()));
page.on('pageerror', (e) => console.log('[page error]', e.message));

const shot = async (name) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`  shot -> ${SHOTS}/${name}.png`);
};

await page.goto(URL);

// ---- 編集画面を開く ----
await page.getByRole('tab', { name: 'ソロ' }).click();
await page.getByRole('button', { name: 'これを元に作る' }).click();
await page.getByRole('heading', { name: 'ルールを設定' }).waitFor();
console.log('--- 編集画面を開いた ---');

// 矛盾は見出し下の要約を押すと開く（狭い画面では右の欄が無い）。
const problems = async () => {
  await page.locator('.editor-summary').click();
  await page.locator('.editor-inspector-dialog').waitFor();
  const list = await page.locator('.editor-inspector-dialog .editor-problems li').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.locator('.editor-inspector-dialog').waitFor({ state: 'hidden' });
  return list;
};
console.log(`  最初の矛盾: ${(await problems()).length}件`);

// ---- 名前を付ける ----
await editValue(page, '名前', '六枚フロップ・素数入り');

// ---- デッキ: クラブを抜く ----
await page.getByRole('tab', { name: /デッキ/ }).click();
await page.getByRole('button', { name: '♣', exact: true }).click();
const deckLine = await page.locator('.deck-contents-toolbar strong').innerText();
console.log(`  クラブを抜いた: ${deckLine.trim()}`);

// ---- 配り方: フロップを6枚に ----
await page.getByRole('tab', { name: /配り方/ }).click();
await page.locator('.street-details>summary').click();
await page.getByRole('button', { name: /^フロップで開く枚数を入力/ }).click();
await page.getByRole('spinbutton', { name: 'フロップで開く枚数' }).fill('6');
await page.keyboard.press('Enter');
console.log('  フロップを6枚にした');

// ---- 役: 独自役を足す ----
await page.getByRole('tab', { name: /役の強さ/ }).click();
await page.getByRole('button', { name: '役を足す' }).click();
const editor = page.locator('.ranking-editor');
await editor.waitFor();
await editor.getByRole('textbox').first().fill('スリーカード＋ペア（自作）');

// 「ペア＋三連」を組む: 同じランク2枚 ＋ 連続3枚
await editor.getByRole('button', { name: 'まとまりを足す' }).click();
const second = editor.locator('.block-row').nth(1);
await second.locator('select').selectOption('run');
await setNumber(page, '2つめのまとまりの枚数', 3);
console.log(`  条件: ${(await editor.locator('.block-total').innerText()).trim()}`);

const exampleOf = async () =>
  (
    await editor
      .locator('.rule-row-cards .card')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  ).join(' ');

// いちばん下にあるうちは例が出ない。上の役に先に当たるため。
console.log(`  いちばん下での例: ${(await exampleOf()) || '(出ない — 上の役に先に当たる)'}`);

// 強さを2つ上げる（ハイカード・ワンペアより上へ）
const item = page.locator('.ranking-item', { has: page.locator('.ranking-editor') });
const up = item.locator('.ranking-move button').first();
await up.click();
await up.click();
console.log(`  強さを2つ上げた → 例: ${(await exampleOf()) || '(出ない)'}`);

await shot('10-editor');

// ---- 矛盾の表示を確かめる ----
// 手札10枚 × 6人 ＝ 60枚。クラブを抜いた39枚では配りきれない。
await page.getByRole('tab', { name: /配り方/ }).click();
await setNumber(page, '手札', 10);
const bad = await problems();
console.log(`--- わざと壊す（手札10枚） --- 矛盾 ${bad.length}件`);
for (const line of bad) console.log(`  ${line.replace(/\s+/g, ' ').trim()}`);
await setNumber(page, '手札', 2);
console.log(`  戻したら ${(await problems()).length}件`);

// ---- 順位表で確かめる ----
await page.locator('.editor-summary').click();
await page.getByRole('button', { name: '役の順位と例' }).click();
await page.waitForTimeout(200);
const rows = page.locator('.rule-sheet-list > li');
console.log(`--- できあがり --- 役 ${await rows.count()}種`);
for (let i = 0; i < (await rows.count()); i++) {
  const row = rows.nth(i);
  const label = (await row.locator('.rule-row-name').innerText()).trim();
  const cards = await row.locator('.card').evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')),
  );
  console.log(`  ${label.padEnd(20)} ${cards.join(' ')}`);
}
await shot('11-editor-preview');
await page.keyboard.press('Escape');

// ---- 保存して遊ぶ ----
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.getByRole('button', { name: '保存済み', exact: true }).waitFor();
await page.getByRole('button', { name: '戻る', exact: true }).click();
await page.getByRole('tab', { name: 'ソロ' }).waitFor();
// 編集に入る前のモード（ソロ）のまま戻ってきているはず。
const activeTab = await page.locator('.tab-active').innerText();
console.log(`  戻ってきたタブ: ${activeTab.trim()}`);

console.log(`--- 戻った --- 選ばれているルール: ${await page.locator('.selected-rule-title').innerText()}`);

await page.getByRole('button', { name: 'はじめる' }).click();
await page.getByRole('button', { name: 'ゲーム開始' }).click();
await page.waitForTimeout(800);

const slots = await page.locator('.community-cards .card').count();
console.log(`  場の枠: ${slots}（フロップ6＋ターン＋リバー＝8のはず）`);

// フロップまで進める。実際に配られた札でデッキを確かめたい。
const labels = async (selector) =>
  (await page.locator(selector).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')),
  )).filter((label) => label && label !== '裏向きのカード');

for (let step = 0; step < 40; step++) {
  if ((await labels('.community-cards .card')).length > 0) break;

  const check = page.getByRole('button', { name: 'チェック' });
  const call = page.getByRole('button', { name: /^コール/ });
  if (await check.count()) await check.click();
  else if (await call.count()) await call.click();
  else {
    // CPU の番。描画が追いつくのを待つ。
    await page.waitForTimeout(300);
    continue;
  }
  await page.waitForTimeout(300);
}

const board = await labels('.community-cards .card');
const mine = await labels('.seat-viewer .card');
console.log(`  配られた場: ${board.join(' ') || '(まだ)'}`);
console.log(`  自分の手札: ${mine.join(' ') || '(見えない)'}`);

const clubs = [...board, ...mine].filter((label) => label.includes('♣'));
console.log(`  クラブ: ${clubs.length}枚（デッキから抜いたので0のはず）`);
await shot('12-playing-custom');

await browser.close();
