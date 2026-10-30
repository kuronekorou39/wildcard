import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173/';
const serverUrl = process.env.WILDCARD_SERVER_URL ?? 'http://127.0.0.1:8787';
const settings = { serverUrl, tableId: crypto.randomUUID(), token: 'a'.repeat(64), name: '期限確認' };
const key = `wildcard.server-session.v1:${serverUrl}:${settings.tableId}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem('wildcard.server-url.v1', settings.serverUrl);
    localStorage.setItem(key, JSON.stringify(settings));
  }, { settings, key });
  await page.goto(`${base}#table=${settings.tableId}`);
  await page.getByRole('button', { name: '卓の情報', exact: true }).click();
  await page.getByRole('button', { name: 'この端末の参加情報を削除', exact: true }).waitFor();
  assert.match(await page.locator('.server-lifetime').innerText(), /期限切れ・削除済み/);
  await mkdir('shots-preview-settings', { recursive: true });
  await page.screenshot({ path: 'shots-preview-settings/expired-room.png' });
  await page.getByRole('button', { name: 'この端末の参加情報を削除', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert.notEqual(await page.evaluate(key => localStorage.getItem(key), key), null);
  await page.getByRole('button', { name: 'この端末の参加情報を削除', exact: true }).click();
  await page.getByRole('button', { name: '削除して設定へ戻る', exact: true }).click();
  await page.locator('.setup-shell').waitFor();
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
  assert.equal(new URL(page.url()).hash, '');
  assert.deepEqual(errors, []);
  console.log('PASS: nonexistent room stops reconnecting, explicit cleanup/cancel, setup return');
} finally { await browser.close(); }
