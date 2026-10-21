/**
 * ブラウザを2つ開いて、実際に P2P で繋いで1ハンド遊ぶ検証スクリプト。
 *
 * 偽の PeerLink を使ったテスト（test/online.test.ts）は通信そのものを見ていない。
 * WebRTC が本当に繋がるか、トラッカー経由のシグナリングが機能するかは
 * ここでしか分からない。**公開トラッカーに繋がる必要があるので要インターネット。**
 *
 *   npm run dev           # 別のターミナルで
 *   npm run drive:online  # ここ
 *
 * 環境変数:
 *   WILDCARD_URL      既定 http://localhost:5173/
 *   WILDCARD_SHOTS    スクリーンショットの出力先。既定 shots-online/
 *   WILDCARD_BROWSER  使う Chromium の実行ファイルパス
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.WILDCARD_URL ?? 'http://localhost:5173/';
const OUT = process.env.WILDCARD_SHOTS ?? 'shots-online';
const CONNECT_TIMEOUT_MS = 90000;

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

/** 複数行のテキストを1行に畳む。ログを1行1項目に保つため。 */
const flatten = (text, joiner) => text.split(String.fromCharCode(10)).join(joiner);

const browser = await launch();
// 別々のコンテキストにすることで localStorage が分かれ、別端末として扱われる。
const hostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();

for (const [label, page] of [
  ['host', host],
  ['guest', guest],
]) {
  page.on('pageerror', (err) => say(`[${label} page error] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') say(`[${label} console error] ${msg.text()}`);
  });
}

let shot = 0;
const snap = async (page, name) => {
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

// ---- host 側: 部屋を作る ----
await host.goto(URL, { waitUntil: 'networkidle' });
await host.getByRole('button', { name: '部屋を作る', exact: true }).first().click();
await host.locator('.field', { hasText: 'あなたの名前' }).locator('input').fill('あかり');
await snap(host, 'host-setup');
await host.getByRole('button', { name: '部屋を作る', exact: true }).last().click();

await host.getByRole('button', { name: '卓の情報', exact: true }).click();
await host.waitForSelector('.room-code');
const roomCode = (await host.locator('.room-code').innerText()).trim();
say(`ルームコード: ${roomCode}`);
await snap(host, 'host-room');
await host.keyboard.press('Escape');

// ---- guest 側: 参加する ----
await guest.goto(URL, { waitUntil: 'networkidle' });
await guest.getByRole('button', { name: '参加する', exact: true }).first().click();
await guest.locator('.field', { hasText: 'あなたの名前' }).locator('input').fill('ばしょう');
await guest.locator('.input-code').fill(roomCode);
await snap(guest, 'guest-setup');
await guest.getByRole('button', { name: '参加する', exact: true }).last().click();

// ---- 接続を待つ ----
say('P2P の確立を待っています（公開トラッカー経由のシグナリング）…');
const started = Date.now();
let connected = false;
while (Date.now() - started < CONNECT_TIMEOUT_MS) {
  const seats = await host.locator('.seat:not(.seat-empty)').count();
  if (seats >= 2) {
    connected = true;
    break;
  }
  await host.waitForTimeout(1000);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (!connected) {
  say(`--- ${elapsed}s 待っても繋がりませんでした ---`);
  await snap(host, 'host-not-connected');
  await snap(guest, 'guest-not-connected');
  await browser.close();
  process.exit(1);
}

say(`--- ${elapsed}s で接続 ---`);
say(`host から見える席: ${await host.locator('.seat:not(.seat-empty)').count()}`);
say(`guest から見える席: ${await guest.locator('.seat:not(.seat-empty)').count()}`);
await snap(host, 'host-connected');
await snap(guest, 'guest-connected');

// ---- 1ハンド遊ぶ ----
await host.getByRole('button', { name: 'ゲーム開始' }).click();
await host.waitForTimeout(800);

say(`host の自分のカード: ${await host.locator('.seat-viewer .card:not(.card-back)').count()} 枚`);
say(`guest の自分のカード: ${await guest.locator('.seat-viewer .card:not(.card-back)').count()} 枚`);
say(`host から見える他人の裏向き: ${await host.locator('.seat:not(.seat-viewer) .card-back').count()} 枚`);
await snap(host, 'host-preflop');
await snap(guest, 'guest-preflop');

for (let step = 0; step < 40; step++) {
  if (await host.locator('.summary').count()) break;

  // どちらの端末に操作ボタンが出ているかを見て、出ているほうを押す。
  let acted = false;
  for (const [label, page] of [
    ['host', host],
    ['guest', guest],
  ]) {
    const check = page.getByRole('button', { name: 'チェック' });
    const call = page.getByRole('button', { name: /^コール/ });
    if (await check.count()) {
      say(`[${step}] ${label} -> チェック`);
      await check.click();
      acted = true;
      break;
    }
    if (await call.count()) {
      say(`[${step}] ${label} -> ${(await call.innerText()).replace(/\n/g, ' ')}`);
      await call.click();
      acted = true;
      break;
    }
  }

  if (!acted) {
    say(`[${step}] どちらにも操作ボタンが無い`);
    await snap(host, 'host-stuck');
    await snap(guest, 'guest-stuck');
    break;
  }
  await host.waitForTimeout(500);
}

if (await host.locator('.summary').count()) {
  say('--- ショーダウン ---');
  await assertNoDuplicateCards(host, 'host showdown');
  say(await host.locator('.summary').innerText());
  await snap(host, 'host-showdown');
  await snap(guest, 'guest-showdown');
} else {
  say('--- ショーダウンに到達しなかった ---');
}

// ---- 配牌の検証 ----
say('--- 配牌の検証 ---');
for (const [label, page] of [
  ['host', host],
  ['guest', guest],
]) {
  await page.getByRole('button', { name: '卓の情報', exact: true }).click();
  await page.locator('.fair-panel .rule-sheet-summary').click();
  say(`[${label}] ${flatten(await page.locator('.fair-summary').innerText(), ' / ')}`);
}

// host が秘密を公開すると、guest 側で検証が通るようになる
await host.getByRole('button', { name: /秘密を公開/ }).click();
await host.waitForTimeout(800);

for (const [label, page] of [
  ['host', host],
  ['guest', guest],
]) {
  say(`[${label}] 公開後: ${flatten(await page.locator('.fair-summary').innerText(), ' / ')}`);
  const rows = await page.locator('.fair-row').allInnerTexts();
  for (const row of rows) say(`   ${flatten(row, ' ')}`);
}
await snap(host, 'host-fairness');
await snap(guest, 'guest-fairness');

// ---- 切断と復帰 ----
say('--- guest のタブを閉じて切断を起こす ---');
const closedAt = Date.now();
await guest.close();

let detectedMs = null;
while (Date.now() - closedAt < 45000) {
  if ((await host.locator('.seat-away').count()) > 0) {
    detectedMs = Date.now() - closedAt;
    break;
  }
  await host.waitForTimeout(500);
}
say(
  detectedMs === null
    ? '45秒待っても離席として検知されなかった'
    : `離席として検知するまで ${(detectedMs / 1000).toFixed(1)}s`,
);
await snap(host, 'host-after-disconnect');

await browser.close();
say('done');
