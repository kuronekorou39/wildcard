/** Deterministic layout checks use the development-only fixture, not a player mode. */
const clockPages = new WeakSet();

export async function settleTable(page) {
  const delay = await page.evaluate(() => {
    const { runtime } = window.tableFixture.state();
    return Math.max(runtime.readyAt, ...runtime.events.map(event => event.at + 3000)) - Date.now();
  });
  if (delay > 0) await page.clock.fastForward(delay);
  await page.clock.runFor(50);
  await page.evaluate(() => { for (const animation of document.getAnimations()) animation.finish(); });
  await page.clock.runFor(50);
}

export async function openTableFixture(page, base, count = 6, rule = 'standard', waiting = false) {
  if (!clockPages.has(page)) { await page.clock.install(); clockPages.add(page); }
  const url = new URL('test/fixtures/table-controls.html', `${base.replace(/\/$/, '')}/`);
  url.search = new URLSearchParams({ seats: String(count), rule, waiting: waiting ? '1' : '0' }).toString();
  await page.goto(url.href);
  await page.evaluate(() => window.tableFixture.view(window.tableFixture.state().state.turnPlayerId ?? 'p0'));
  await settleTable(page);
}
