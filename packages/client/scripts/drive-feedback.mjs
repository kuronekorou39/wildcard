import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch();
const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.voices = 0;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args), start = source.start.bind(source);
      source.start = (...args) => { window.voices++; return start(...args); };
      return source;
    };
  });
  await page.goto(`${url}/test/fixtures/table-pacing.html?turnMs=8000`);
  await page.evaluate(async () => {
    // Vite may add an HMR timestamp. Observe the instance already used by the table.
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => new URL(url).pathname === '/src/audio.ts');
    const { tableAudio } = await import(moduleUrl ?? '/src/audio.ts');
    const play = tableAudio.play.bind(tableAudio);
    window.cues = [];
    tableAudio.play = (...args) => { window.cues.push({ sound: args[0], at: Date.now() }); return play(...args); };
  });
  const ready = () => page.waitForFunction(() => Date.now() >= window.pacingFixture.state().runtime.readyAt);
  const advance = async () => { await ready(); await page.evaluate(() => window.pacingFixture.advance()); };
  const ownTurn = async () => {
    while (await page.evaluate(() => window.pacingFixture.state().state.turnPlayerId !== 'p0')) await advance();
    await ready();
    await page.waitForTimeout(100);
  };
  await page.getByRole('button', { name: 'ゲーム開始', exact: true }).click();
  await ownTurn();
  assert.equal(await page.evaluate(() => window.cues.filter(c => c.sound === 'turn').length), 1);
  await page.evaluate(() => window.pacingFixture.cancel());
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.cues.filter(c => c.sound === 'turn').length), 1, 'Refresh does not repeat a turn notice');
  await page.waitForFunction(() => window.cues.some(c => c.sound === 'tick'));
  await advance();
  const ticks = await page.evaluate(() => window.cues.filter(c => c.sound === 'tick' || c.sound === 'urgent').length);
  await page.waitForTimeout(4200);
  assert.equal(await page.evaluate(() => window.cues.filter(c => c.sound === 'tick' || c.sound === 'urgent').length), ticks, 'Acting cancels the remaining countdown');
  await ownTurn();
  assert.ok(await page.evaluate(() => window.cues.some(c => c.sound === 'check')), 'Accepted checks emit a sound');
  const before = await page.evaluate(() => window.cues.length);
  await page.waitForFunction(n => window.cues.slice(n).some(c => c.sound === 'urgent'), before);
  const countdown = await page.evaluate(n => window.cues.slice(n).filter(c => c.sound === 'tick' || c.sound === 'urgent'), before);
  assert.deepEqual(countdown.map(c => c.sound), ['tick', 'tick', 'tick', 'tick', 'urgent']);
  for (let i = 1; i < countdown.length; i++) assert.ok(Math.abs(countdown[i].at - countdown[i - 1].at - 1000) < 150);
  assert.ok(await page.evaluate(() => window.voices > 15), 'Audio buffers actually started');
  assert.deepEqual(errors, []);
  console.log('Check sound, own-turn notice, once-only notice, last-five-second cadence, and cancellation after acting: passed');
} finally { await browser.close(); }
