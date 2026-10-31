import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { api, close, connect, pause, token } from '../../server/scripts/harness.mjs';
import { editValue } from './setup-helpers.mjs';

const base = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173/';
const server = process.env.WILDCARD_SERVER_URL ?? 'http://127.0.0.1:8787';
const createKey = process.env.WILDCARD_CREATE_KEY_FILE
  ? (await readFile(process.env.WILDCARD_CREATE_KEY_FILE, 'utf8')).trim().replace(/^CREATE_KEY=/, '')
  : process.env.WILDCARD_CREATE_KEY ?? 'local-preview-only';
const out = process.env.WILDCARD_SHOTS ?? 'shots-server';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.WILDCARD_BROWSER });
const snapshots = new Map();
const receivedAt = new Map();
const errors = [];
const bots = [];
const until = async (test, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (test()) return; await pause(30); }
  throw new Error('Timed out waiting for table');
};
function observe(page, label) {
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
  page.on('websocket', socket => socket.on('framereceived', event => {
    try { const value = JSON.parse(String(event.payload)); if (value.type === 'snapshot') { snapshots.set(label, value); receivedAt.set(label, Date.now()); } } catch {}
  }));
}
async function fits(page, label, settings = false) {
  const geometry = await page.evaluate(settings => {
    const fields = document.querySelector('.server-session .session-fields');
    const launch = document.querySelector('.server-session .session-launch');
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      ...(settings && fields && launch ? { fieldScroll: fields.scrollHeight - fields.clientHeight, launchBottom: launch.getBoundingClientRect().bottom } : {}) };
  }, settings);
  assert.ok(geometry.documentWidth <= geometry.width + 1 && geometry.documentHeight <= geometry.height + 1, `${label}: ${JSON.stringify(geometry)}`);
  if (settings) assert.ok(geometry.fieldScroll <= 1 && geometry.launchBottom <= geometry.height + 1, `${label}: ${JSON.stringify(geometry)}`);
}
async function configureServer(page, owner = false) {
  await page.getByRole('button', { name: 'サーバー接続設定', exact: true }).click();
  await page.getByRole('textbox', { name: '接続先URL', exact: true }).fill(server);
  if (owner) await page.getByLabel('作成キー', { exact: true }).fill(createKey);
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).click();
}
try {
  const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = await hostContext.newPage(); const guest = await guestContext.newPage();
  observe(host, 'host'); observe(guest, 'guest');
  await host.goto(base);
  await host.getByRole('tab', { name: /^オンライン/ }).click();
  await host.getByRole('button', { name: 'サーバー', exact: true }).click();
  await configureServer(host, true);
  for (const [width, height] of [[320,568], [390,844], [768,1024], [667,375], [1280,720], [1920,1080]]) {
    await host.setViewportSize({ width, height });
    await fits(host, `setup ${width}`, true);
    await host.screenshot({ path: `${out}/setup-${width}.png` });
  }
  await host.setViewportSize({ width: 390, height: 666 });
  await editValue(host, 'あなたの名前', 'はる');
  await editValue(host, 'アンティ / 人', 5);
  await host.getByRole('button', { name: /^卓を作る/ }).click();
  await host.locator('.screen-game').waitFor();
  await until(() => snapshots.has('host'));
  const room = new URLSearchParams(new URL(host.url()).hash.slice(1)).get('table');
  assert.ok(room);
  await guest.goto(host.url());
  await configureServer(guest);
  await editValue(guest, 'あなたの名前', 'あおい');
  await guest.getByRole('button', { name: /^参加する/ }).last().click();
  await guest.locator('.screen-game').waitFor();
  await until(() => snapshots.has('guest'));
  await until(() => snapshots.get('host').online.length === 2);
  const guestId = snapshots.get('guest').viewerId;
  const guestSeat = snapshots.get('guest').state.players.find(player => player.id === guestId).seat;
  const hostSeat = snapshots.get('host').state.players.find(player => player.id === snapshots.get('host').viewerId).seat;
  assert.equal(Math.abs(guestSeat - hostSeat), 5, 'The first two players sit opposite each other');
  const invitation = host.url();
  await guest.getByRole('button', {name: 'もどる', exact: true}).click();
  await guest.getByRole('button', {name: '卓に残る', exact: true}).click();
  assert.equal(snapshots.get('host').online.length, 2, 'Cancel keeps the connection');
  await guest.getByRole('button', {name: 'もどる', exact: true}).click();
  await guest.getByRole('button', {name: '設定へ戻る', exact: true}).click();
  await until(() => snapshots.get('host').online.length === 1);
  assert.equal(await host.getByRole('button', {name: 'ゲーム開始', exact: true}).isDisabled(), true);
  // Open the invitation as a document, rather than a same-document hash change.
  await guest.goto('about:blank');
  await guest.goto(invitation);
  await guest.locator('.screen-game').waitFor();
  await until(() => snapshots.get('host').online.length === 2);
  assert.equal(snapshots.get('guest').viewerId, guestId);
  assert.equal(snapshots.get('guest').state.players.find(player => player.id === guestId).seat, guestSeat);
  console.log('PASS: spaced seats, exit confirmation, one-player wait, same-seat return');
  for (let i = 2; i < 10; i++) {
    const credential = token();
    await api(server, room, '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: credential, name: `テスター${i + 1}`, play: true }) });
    bots.push(await connect(server, room, credential));
  }
  await until(() => snapshots.get('host').online.length === 10);
  await host.getByRole('button', { name: 'ゲーム開始', exact: true }).click();
  await until(() => snapshots.get('host').runtime.handId === 1);
  for (const label of ['host', 'guest']) {
    await until(() => snapshots.get(label).runtime.handId === 1);
    const snapshot = snapshots.get(label);
    assert.equal(snapshot.state.ante, 5);
    assert.equal(snapshot.state.pot, 80);
    assert.equal(snapshot.state.players.reduce((sum, p) => sum + p.bet, 0), 30);
    assert.equal('deck' in snapshot.state, false);
    assert.equal('burned' in snapshot.state, false);
    for (const player of snapshot.state.players) assert.equal(player.holeCards.filter(Boolean).length, player.id === snapshot.viewerId ? 2 : 0);
  }
  for (const page of [host, guest]) await fits(page, '10 seat table');
  await pause(3800);
  await host.screenshot({ path: `${out}/table-mobile.png` });
  await guest.screenshot({ path: `${out}/table-desktop.png` });
  console.log('PASS: browser-created table, invite, 10 players, six setup viewports');
  for (let n = 0; snapshots.get('host').state.phase !== 'showdown' && n < 60; n++) {
    const snapshot = snapshots.get('host');
    await pause(Math.max(0, receivedAt.get('host') + snapshot.runtime.readyAt - snapshot.serverNow - Date.now()) + 700);
    const playerId = snapshot.state.turnPlayerId;
    const player = snapshot.state.players.find(value => value.id === playerId);
    const canCheck = player.bet === snapshot.state.currentBet;
    const revision = snapshot.revision;
    const label = snapshots.get('host').viewerId === playerId ? 'host' : snapshots.get('guest').viewerId === playerId ? 'guest' : null;
    if (label) {
      const page = label === 'host' ? host : guest;
      await page.getByRole('button', { name: canCheck ? /^チェック$/ : /^コール/ }).click();
    } else {
      const bot = bots.find(value => value.snapshot.viewerId === playerId);
      await bot.send({ type: canCheck ? 'check' : 'call' });
    }
    await until(() => snapshots.get('host').revision > revision);
    if (n === 4) {
      const current = snapshots.get('host');
      const cards = current.state.players.find(value => value.id === current.viewerId).holeCards;
      snapshots.delete('host');
      await host.reload();
      await until(() => snapshots.has('host'));
      assert.deepEqual(snapshots.get('host').state.players.find(value => value.id === current.viewerId).holeCards, cards);
      console.log('PASS: page reload resumes same seat and cards');
    }
  }
  assert.equal(snapshots.get('host').state.phase, 'showdown');
  await host.getByRole('button', { name: '自動開始を停止', exact: true }).click();
  await until(() => snapshots.get('host').runtime.nextHandAt === null);
  await host.screenshot({ path: `${out}/showdown-mobile.png` });
  await guest.screenshot({ path: `${out}/showdown-desktop.png` });
  await host.getByRole('button', { name: '卓の情報', exact: true }).click();
  await host.getByRole('button', { name: '保存したハンド', exact: true }).click();
  await host.locator('.server-history-list button').first().click();
  await host.locator('.server-history-dialog .summary-detail').waitFor();
  await host.getByRole('tab', { name: /^手順/ }).click();
  let anteInHistory = false;
  for (let step = 0; step < snapshots.get('host').state.history.length && !(await host.locator('.server-history-dialog').innerText()).includes('チェック'); step++) {
    await host.locator('.server-history-dialog').getByRole('button', { name: '次の手順', exact: true }).click();
    anteInHistory ||= (await host.locator('.server-history-dialog').innerText()).includes('アンティ');
  }
  await host.screenshot({ path: `${out}/saved-history-mobile.png` });
  assert.ok(await host.locator('.server-history-dialog').innerText().then(text => text.includes('チェック')));
  assert.ok(anteInHistory, 'Ante payments are separate steps in saved history');
  console.log('PASS: saved hand opens with action and chip-transfer history');
  const ownToken = await host.evaluate(({ server, room }) => JSON.parse(localStorage.getItem(`wildcard.server-session.v1:${server}:${room}`)).token, { server, room });
  const metrics = await api(server, room, '/metrics', { headers: { Authorization: `Bearer ${ownToken}` } });
  await writeFile(`${out}/metrics.json`, JSON.stringify({ server, measuredAt: new Date().toISOString(), ...metrics }, null, 2));
  await host.locator('.server-history-dialog').getByRole('button', { name: '閉じる', exact: true }).click();
  await host.getByRole('button', { name: '卓を終了', exact: true }).click();
  await host.getByRole('button', { name: '卓を終了する', exact: true }).click();
  await until(() => snapshots.get('host').closed);
  assert.deepEqual(errors, []);
  console.log('PASS: close table, no browser errors');
} finally { close(bots); await browser.close(); }
