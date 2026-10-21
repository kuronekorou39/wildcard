/**
 * 実際にブラウザで卓を開き、ホットシートで1ハンド遊びきる検証スクリプト。
 *
 * テストは「落ちない」ことまでしか見ていないので、実際に遊べるかは
 * ここで確かめる。スクリーンショットも撮るので見た目の崩れにも気づける。
 *
 *   npm run dev            # 別のターミナルで
 *   npm run drive          # ここ
 *
 * 環境変数:
 *   WILDCARD_URL      既定 http://localhost:5173/
 *   WILDCARD_SHOTS    スクリーンショットの出力先。既定 shots/
 *   WILDCARD_BROWSER  使う Chromium の実行ファイルパス
 *   WILDCARD_RULE     使うルールのプリセット id（既定 standard）
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.WILDCARD_URL ?? 'http://localhost:5173/';
const OUT = process.env.WILDCARD_SHOTS ?? 'shots';
mkdirSync(OUT, { recursive: true });

/**
 * ブラウザの解決。環境によって用意されているものが違うので順に試す。
 *   1. WILDCARD_BROWSER で明示されたパス
 *   2. Playwright が自前で入れた chromium（npx playwright install chromium）
 *   3. ms-playwright 配下にある別リビジョンの chromium
 */
async function launch() {
  const explicit = process.env.WILDCARD_BROWSER;
  if (explicit) return chromium.launch({ executablePath: explicit });

  try {
    return await chromium.launch();
  } catch (error) {
    const root = join(homedir(), 'AppData/Local/ms-playwright');
    const found = existsSync(root)
      ? readdirSync(root)
          .filter((d) => d.startsWith('chromium-'))
          .map((d) => join(root, d, 'chrome-win/chrome.exe'))
          .find((p) => existsSync(p))
      : undefined;
    if (!found) throw error;
    console.log(`既定のブラウザが無いので ${found} を使う`);
    return chromium.launch({ executablePath: found });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const log = [];
const say = (m) => {
  log.push(m);
  console.log(m);
};

page.on('console', (msg) => {
  if (msg.type() === 'error') say(`[browser error] ${msg.text()}`);
});
page.on('pageerror', (err) => say(`[page error] ${err.message}`));

let shot = 0;
const snap = async (name) => {
  shot++;
  const file = `${OUT}/${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  say(`  shot -> ${file}`);
};

/** 卓の上に同じカードが二度出ていないかを確かめる。重複は配牌の致命的な不具合。 */
async function assertNoDuplicateCards(page, label) {
  const labels = await page
    .locator('.table-area .card:not(.card-back):not(.card-slot)')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  const seen = new Set();
  const duplicates = [];
  for (const card of labels) {
    if (card === null) continue;
    if (seen.has(card)) duplicates.push(card);
    seen.add(card);
  }
  if (duplicates.length > 0) {
    say(`[${label}] カードが重複している: ${duplicates.join(' ')}`);
    throw new Error('duplicate cards on table');
  }
  say(`[${label}] 卓上のカード ${labels.length} 枚に重複なし`);
}

await page.goto(URL, { waitUntil: 'networkidle' });
say(`title: ${await page.title()}`);
say(`H1: ${await page.locator('.hero-title').innerText()}`);
await snap('setup');

// 3人目を追加（ホットシートのタブに切り替えてから）
await page.getByRole('tab', { name: 'ホットシート' }).click();
await page.getByRole('button', { name: '＋ 追加' }).click();
const nameInputs = page.locator('.player-row .input');
say(`players: ${await nameInputs.count()}`);
await nameInputs.nth(0).fill('あかり');
await nameInputs.nth(1).fill('ばしょう');
await nameInputs.nth(2).fill('ちとせ');

// ホットシートのタブへ
await page.getByRole('tab', { name: 'ホットシート' }).click();

const ruleId = process.env.WILDCARD_RULE ?? 'standard';
await page.locator('.field', { hasText: 'ルール' }).locator('select').selectOption(ruleId);
say(`ルール: ${await page.locator('.rule-description').innerText()}`);
await page.locator('.rule-sheet-summary').click();
say(`役の数: ${await page.locator('.rule-sheet-list li').count()}`);
say(`デッキ: ${await page.locator('.rule-sheet-deck').innerText()}`);

await page.getByRole('button', { name: '卓につく' }).click();
await page.waitForSelector('.table-area');
say('--- 卓に着いた ---');
say(`seats: ${await page.locator('.seat').count()}`);
say(`pot: ${await page.locator('.table-pot').innerText()}`);
await snap('table-waiting');

await page.getByRole('button', { name: 'ゲーム開始' }).click();
await page.waitForTimeout(150);

// 目隠しが出るはず
const gated = await page.locator('.gate').count();
say(`--- 開始後: 目隠し ${gated > 0 ? 'あり' : 'なし'} ---`);
if (gated > 0) {
  say(`次の手番: ${await page.locator('.gate-name').innerText()}`);
  // 目隠し中は卓が描かれていないことを確認（DOMにカードが載らない）
  say(`目隠し中の卓の要素数: ${await page.locator('.table-area').count()}`);
  say(`目隠し中のカード要素数: ${await page.locator('.card').count()}`);
  await snap('gate');
  await page.getByRole('button', { name: 'カードを見る' }).click();
  await page.waitForSelector('.table-area');
}

say(`手番: ${await page.locator('.turn-label').innerText()}`);
say(`自分の見えるカード枚数: ${await page.locator('.seat-viewer .card:not(.card-back)').count()}`);
say(`他人の裏向きカード枚数: ${await page.locator('.seat:not(.seat-viewer) .card-back').count()}`);
await snap('first-turn');

// 1ハンド遊ぶ
for (let step = 0; step < 60; step++) {
  if (await page.locator('.screen-game[data-phase="showdown"]').count())
    await page.locator('.summary-compact').waitFor({ timeout: 30000 });
  if (await page.locator('.summary').count()) break;

  if (await page.locator('.gate').count()) {
    const who = await page.locator('.gate-name').innerText();
    await page.getByRole('button', { name: 'カードを見る' }).click();
    await page.waitForTimeout(60);
    say(`[${step}] 目隠し -> ${who} が見る`);
    continue;
  }

  const phase = await page.locator('.table-phase').innerText();
  const pot = await page.locator('.table-pot').innerText();

  const check = page.getByRole('button', { name: 'チェック' });
  const call = page.getByRole('button', { name: /^コール/ });

  if (await check.count()) {
    say(`[${step}] ${phase} / ${pot} -> チェック`);
    await check.click();
  } else if (await call.count()) {
    say(`[${step}] ${phase} / ${pot} -> ${(await call.innerText()).replace(/\n/g, ' ')}`);
    await call.click();
  } else {
    say(`[${step}] ${phase} / ${pot} -> 操作ボタンが無い`);
    await snap('stuck');
    break;
  }
  await page.waitForTimeout(60);
}

if (await page.locator('.summary').count()) {
  say('--- ショーダウン ---');
  await assertNoDuplicateCards(page, 'showdown');
  say(await page.locator('.summary').innerText());
  await snap('showdown');
} else {
  say('--- ショーダウンに到達しなかった ---');
  await snap('not-finished');
}

// レイズUIも触ってみる
await page.getByRole('button', { name: '次のハンド' }).click();
await page.waitForTimeout(100);
if (await page.locator('.gate').count()) {
  await page.getByRole('button', { name: 'カードを見る' }).click();
  await page.waitForTimeout(60);
}
const raise = page.getByRole('button', { name: 'レイズ', exact: true });
if (await raise.count()) {
  await raise.click();
  await page.waitForTimeout(60);
  say(`--- レイズUI ---`);
  say(`額: ${await page.locator('.raise-amount').innerText()}`);
  say(`クイック: ${(await page.locator('.btn-quick').allInnerTexts()).join(' / ')}`);
  await snap('raise-ui');
} else {
  say('--- レイズボタンが出なかった ---');
}

await browser.close();
say('done');
