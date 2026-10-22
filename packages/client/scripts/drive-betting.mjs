/**
 * 賭け方の制度を実際に触る。
 *
 * **画面が自前で上限を計算していないこと**を確かめるのが目的。
 * 制度を切り替えたとき、ボタンの出方と額がエンジンの legalActions に
 * ついてきていればよい。
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.WILDCARD_URL ?? 'http://localhost:5173/';
const SHOTS = process.env.WILDCARD_SHOTS ?? 'shots';

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.WILDCARD_BROWSER });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on('console', (m) => m.type() === 'error' && console.log('[browser error]', m.text()));
page.on('pageerror', (e) => console.log('[page error]', e.message));

/** ソロ卓を立てて、自分の手番まで進める。 */
async function sitDown(rule) {
  await page.goto(URL);
  await page.getByRole('tab', { name: 'ソロ' }).click();
  await page.locator('.field', { hasText: 'ルール' }).locator('select').selectOption(rule);
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.getByRole('button', { name: 'ゲーム開始' }).click();

  for (let i = 0; i < 30; i++) {
    if (await page.locator('.action-bar').count()) return true;
    if (await page.locator('.summary').count()) return false;
    await page.waitForTimeout(250);
  }
  return false;
}

/** 手番で押せるボタンの文字。 */
const buttons = async () =>
  (await page.locator('.action-bar .btn').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );

// ---- フィックスリミット ----
console.log('=== リミットホールデム ===');
if (await sitDown('リミットホールデム')) {
  console.log(`  ボタン: ${(await buttons()).join(' / ')}`);
  // 額が1つしかないので、レイズは一発で通るはず。
  const raise = page.getByRole('button', { name: /^レイズ/ });
  if (await raise.count()) {
    await raise.click();
    await page.waitForTimeout(400);
    console.log(`  レイズ後のポット: ${(await page.locator('.table-pot').innerText()).trim()}`);
    console.log(`  額を選ぶ画面: ${(await page.locator('.raise-slider').count()) ? 'あり' : 'なし（刻みが決まっているため）'}`);
  }
  await page.screenshot({ path: `${SHOTS}/30-fixed-limit.png`, fullPage: true });
}

// ---- ポットリミット ----
console.log('=== オマハ（ポットリミット） ===');
if (await sitDown('オマハ（ポットリミット）')) {
  const pot = (await page.locator('.table-pot').innerText()).replace(/[^0-9]/g, '');
  await page.getByRole('button', { name: 'レイズ', exact: true }).click();
  await page.waitForTimeout(200);

  const slider = page.locator('.raise-slider');
  const max = await slider.getAttribute('aria-valuemax');
  const quick = await page.locator('.raise-quick .btn').allInnerTexts();
  console.log(`  ポット ${pot} / レイズ上限 ${max}`);
  console.log(`  クイック: ${quick.join(' / ')}`);
  console.log(`  「オールイン」が出ない: ${quick.some((q) => q.includes('オールイン')) ? 'いいえ' : 'はい'}`);
  await page.screenshot({ path: `${SHOTS}/31-pot-limit.png`, fullPage: true });
}

// ---- ストラドル ----
console.log('=== ストラドルあり ===');
if (await sitDown('ストラドルあり')) {
  await page.getByRole('button', { name: '卓の情報', exact: true }).click();
  const toggle = page.locator('.straddle-control input');
  console.log(`  申告の口: ${(await toggle.count()) ? 'あり' : 'なし'}`);
  await toggle.check();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  // ストラドルを出せるのは BB の左隣にいるハンドだけ。
  // 席は毎ハンド回るので、自分の番が来るまで畳んで進める。
  let posted = null;
  for (let hand = 0; hand < 6 && posted === null; hand++) {
    for (let i = 0; i < 40; i++) {
      if (await page.locator('.summary').count()) break;
      const fold = page.getByRole('button', { name: 'フォールド' });
      if (await fold.count()) await fold.click();
      else await page.waitForTimeout(250);
    }

    const next = page.getByRole('button', { name: '次のハンド' });
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(700);

    const pot = Number((await page.locator('.table-pot').innerText()).replace(/[^0-9]/g, ''));
    const mine = Number(
      ((await page.locator('.table-bet-anchor[data-viewer="true"] .bet-amount').innerText().catch(() => '0')) || '0').replace(
        /[^0-9]/g,
        '',
      ),
    );
    console.log(`  ${hand + 1}ハンド目: ポット ${pot} / 自分が出した額 ${mine}`);
    if (mine >= 40) posted = { pot, mine };
  }

  console.log(
    posted
      ? `  ストラドルを出せた: 自分の額 ${posted.mine}（BB 20 の倍）`
      : '  この席順ではストラドルの番が回ってこなかった',
  );
  await page.screenshot({ path: `${SHOTS}/32-straddle.png`, fullPage: true });
}

// ---- プリフロップ・オールイン禁止 ----
console.log('=== プリフロップはオールイン禁止 ===');
if (await sitDown('プリフロップはオールイン禁止')) {
  await page.getByRole('button', { name: 'レイズ', exact: true }).click();
  await page.waitForTimeout(200);
  const max = await page.locator('.raise-slider').getAttribute('aria-valuemax');
  const quick = await page.locator('.raise-quick .btn').allInnerTexts();
  console.log(`  レイズ上限 ${max}（手持ち1000 ＋ 出した額 のはず）`);
  console.log(`  クイック: ${quick.join(' / ')}`);
  await page.screenshot({ path: `${SHOTS}/33-no-allin.png`, fullPage: true });
}

await browser.close();
