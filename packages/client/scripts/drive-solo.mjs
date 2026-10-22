import { chooseRule } from './setup-helpers.mjs';
/**
 * CPU を相手に実ブラウザで1ハンド遊ぶ検証スクリプト。
 *
 * CPU の判断はエンジン側でテストしてあるが、画面で手番が回り続けるか、
 * 考えている間の表示が出るか、固まらないかは、ここでしか分からない。
 *
 *   npm run dev         # 別のターミナルで
 *   npm run drive:solo  # ここ
 *
 * 環境変数:
 *   WILDCARD_URL      既定 http://localhost:5173/
 *   WILDCARD_SHOTS    既定 shots-solo/
 *   WILDCARD_RULE     ルールのプリセット id（既定 standard）
 *   WILDCARD_CPUS     CPU の人数（1〜9、省略時は画面の初期値）
 *   WILDCARD_FOLD     1 にすると最初の手番で降りる（ラビットハントの確認用）
 *   WILDCARD_BROWSER  使う Chromium の実行ファイルパス
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.WILDCARD_URL ?? 'http://localhost:5173/';
const OUT = process.env.WILDCARD_SHOTS ?? 'shots-solo';
const RULE = process.env.WILDCARD_RULE ?? 'standard';

mkdirSync(OUT, { recursive: true });

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
    return chromium.launch({ executablePath: found });
  }
}

const say = (m) => console.log(m);
const flattenText = (t) => t.split(String.fromCharCode(10)).join(' ');

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (err) => say(`[page error] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') say(`[console error] ${msg.text()}`);
});

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

/**
 * ショーダウンの内容を文字として読み出す。
 *
 * スクリーンショットではダイヤとハートを読み分けられず、役の判定が
 * 正しいか目で確かめられない。aria-label は曖昧さがないのでこちらを使う。
 */
async function readShowdown(page) {
  const board = await page
    .locator('.table-center .card:not(.card-slot)')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));

  const rows = await page.locator('.summary-hand').evaluateAll((nodes) =>
    nodes.map((row) => ({
      name: row.querySelector('.summary-hand-name')?.textContent ?? '',
      cards: [...row.querySelectorAll('.card')].map((c) => c.getAttribute('aria-label')),
      ranking: row.querySelector('.summary-hand-ranking')?.textContent ?? '',
    })),
  );

  say(`  ボード: ${board.join(' ')}`);
  for (const row of rows) say(`  ${row.name}: ${row.cards.join(' ')} -> ${row.ranking}`);
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: 'ソロ' }).click();
await chooseRule(page, RULE);
if (process.env.WILDCARD_CPUS) {
  await page.getByRole('group', { name: 'CPU の人数', exact: true }).getByRole('button', { name: process.env.WILDCARD_CPUS, exact: true }).click();
}
say(`ルール: ${await page.locator('.rule-description').innerText()}`);
await snap('setup');

await page.getByRole('button', { name: 'はじめる' }).click();
await page.waitForSelector('.table-area');
say(`席: ${await page.locator('.seat:not(.seat-empty)').count()}`);

await page.getByRole('button', { name: 'ゲーム開始' }).click();
await page.waitForTimeout(400);
say(`自分の見えるカード: ${await page.locator('.seat-viewer .card:not(.card-back)').count()} 枚`);
// ディーラーが札を表にしていれば告知が出る。不具合に見えないための表示。
if (await page.locator('.table-notice-link').count()) {
  await page.getByRole('button', { name: '卓の情報', exact: true }).click();
}
if (await page.locator('.deal-notice').count()) {
  say(`告知: ${flattenText(await page.locator('.deal-notice').innerText())}`);
  const exposed = await page
    .locator('.deal-notice-cards .card')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  if (exposed.length > 0) say(`  表になった札: ${exposed.join(' ')}`);
  // 手札は公開されないはず
  say(`  他人の表向きの札: ${await page.locator('.seat:not(.seat-viewer) .card:not(.card-back)').count()} 枚`);
}
if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
say(`CPU の裏向きカード: ${await page.locator('.seat:not(.seat-viewer) .card-back').count()} 枚`);
await snap('preflop');

let sawThinking = false;
let myTurns = 0;

for (let step = 0; step < 400; step++) {
  if (await page.locator('.summary').count()) break;

  if (await page.locator('.waiting-actions').count()) {
    sawThinking = true;
    await page.waitForTimeout(300);
    continue;
  }

  // 最初の手番で降りると、勝負が流れた後の表示（ラビットハント）を確かめられる。
  if (process.env.WILDCARD_FOLD === '1') {
    const fold = page.getByRole('button', { name: 'フォールド' });
    if (await fold.count()) {
      say(`[${step}] 自分 -> フォールド`);
      await fold.click();
      await page.waitForTimeout(400);
      continue;
    }
  }

  const check = page.getByRole('button', { name: 'チェック' });
  const call = page.getByRole('button', { name: /^コール/ });

  if (await check.count()) {
    myTurns++;
    say(`[${step}] 自分 -> チェック（${await page.locator('.table-phase').innerText()}）`);
    await check.click();
  } else if (await call.count()) {
    myTurns++;
    say(`[${step}] 自分 -> ${(await call.innerText()).replace(/\n/g, ' ')}`);
    await call.click();
  } else {
    // CPU の番。描画が追いつくのを待つ。
    await page.waitForTimeout(300);
    continue;
  }
  await page.waitForTimeout(250);
}

say(`CPU が考えている表示: ${sawThinking ? 'あり' : 'なし'}`);
say(`自分が行動した回数: ${myTurns}`);

if (await page.locator('.summary').count()) {
  say('--- ショーダウン ---');
  await assertNoDuplicateCards(page, 'showdown');
  await snap('showdown-table');
  await page.getByRole('button', { name: '結果の詳細', exact: true }).click();
  await readShowdown(page);
  const rabbit = await page
    .locator('.summary-rabbit-cards .card')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
  if (rabbit.length > 0) say(`  配られるはずだった札: ${rabbit.join(' ')}`);
  const shown = await page.locator('.show-cards .btn').count();
  if (shown > 0) say(`  手札を見せるボタン: ${shown}個`);
  await snap('showdown');
} else {
  say('--- ショーダウンに到達しなかった ---');
  await snap('stuck');
  process.exitCode = 1;
}

await browser.close();
say('done');
