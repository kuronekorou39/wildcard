/** Keep a ten-seat game and every primary control inside the viewport. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.WILDCARD_URL ?? 'http://127.0.0.1:5173';
const out = process.env.WILDCARD_SHOTS ?? 'shots-viewport';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const checks = [], errors = [];
const inspect = async (page, name) => {
  // Layout assertions compare resting positions, not the staggered deal animation.
  await page.locator('.table-area').evaluate(async table => {
    await Promise.all(table.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.target?.classList?.contains('card'))
      .map(animation => animation.finished.catch(() => {})));
  });
  const result = await page.evaluate(() => {
    const w = innerWidth, h = innerHeight;
    const rect = el => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const intersects = (a, b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>2 &&
      Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;
    const seats = [...document.querySelectorAll('.seat')].map(el => ({ id: el.dataset.slot, r: rect(el) }));
    const overlaps = [];
    for (let i=0; i<seats.length; i++) for (let j=i+1; j<seats.length; j++)
      if (intersects(seats[i].r, seats[j].r)) overlaps.push([seats[i].id, seats[j].id]);
    const obstructions = [...document.querySelectorAll('.table-surface .table-position-chip, .game-corner, .stock-pile')]
      .map(el => ({ id: el.getAttribute('aria-label') ?? el.textContent, r: rect(el) }));
    const coveredCards = [];
    for (const card of document.querySelectorAll('.community-cards .card'))
      for (const object of [...seats, ...obstructions])
        if (intersects(rect(card),object.r)) coveredCards.push(object.id);
    const stockCovered = [...document.querySelectorAll('.stock-pile')].flatMap(el => seats.filter(seat => intersects(rect(el), seat.r)).map(seat => seat.id));
    const clipped = [...document.querySelectorAll('.table-area .card, .seat, .table-surface .table-position-chip, .bottombar .btn, .raise-controls')]
      .filter(el => {
        const r = rect(el);
        return r.left < -1 || r.right > w+1 || r.top < -1 || r.bottom > h+1;
      }).map(el => el.className);
    const cornerCovered = seats.filter(seat => obstructions.filter(o => o.id === 'もどる' || o.id === '卓の情報').some(o => intersects(o.r, seat.r)));
    const blockedActions = [...document.querySelectorAll('.bottombar .action-row .btn')].filter(el => {
      const r = rect(el);
      const target = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return !el.contains(target);
    }).map(el => el.textContent);
    const hand = [...document.querySelectorAll('.seat-viewer .seat-held-card')];
    const handWrapped = hand.some(card => card.offsetTop !== hand[0].offsetTop);
    const controls = document.querySelector('.raise-controls');
    const coveredByRaise = controls ? [...document.querySelectorAll('.seat, .table-area .card')]
      .filter(el => intersects(rect(controls), rect(el))).map(el => el.className) : [];
    const footer = rect(document.querySelector('.bottombar'));
    const raiseNotVertical = controls && (getComputedStyle(document.querySelector('.raise-slider')).writingMode !== 'vertical-lr');
    return { w, h, pageHeight: document.documentElement.scrollHeight, pageWidth: document.documentElement.scrollWidth,
      footer, overlaps, coveredCards, stockCovered, clipped, cornerCovered, blockedActions, handWrapped, coveredByRaise, raiseNotVertical };
  });
  checks.push({ name, ...result });
  await page.screenshot({ path: `${out}/${name}.png` });
};

try {
  const sizes = process.env.WILDCARD_SIZES ? process.env.WILDCARD_SIZES.split(',').map(s => s.split('x').map(Number))
    : [[320,568], [390,844], [719,800], [720,800], [1024,768], [1100,700], [1280,900], [1920,1080], [2560,1440], [844,390], [667,375]];
  const cases = process.env.WILDCARD_QUICK === '1' ? [[10,'standard']] : [[2,'standard'], [6,'standard'], [10,'standard'], [10,'omaha'], [6,'six-card-flop']];
  for (const [width,height] of sizes) for (const [count,rule] of cases) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.getByRole('tab',{name:'ホットシート'}).click();
    for(let i=2;i<count;i++) await page.getByRole('button',{name:'＋ 追加'}).click();
    await page.locator('select.input').selectOption(rule);
    await page.getByRole('button',{name:'卓につく',exact:true}).click();
    await inspect(page, `${width}x${height}-${count}-${rule}-waiting`);
    await page.getByRole('button',{name:'ゲーム開始',exact:true}).click();
    assert.equal(await page.locator('.card').count(),0);
    await page.getByRole('button',{name:'カードを見る',exact:true}).click();
    await inspect(page, `${width}x${height}-${count}-${rule}-playing`);
    assert.equal(await page.locator('.seat-avatar').count(),count);
    assert.equal(await page.locator('.table-surface .position-d').count(),1);
    assert.equal(await page.locator('.table-surface .position-sb').count(),1);
    assert.equal(await page.locator('.table-surface .position-bb').count(),1);
    if(count===10 && rule==='standard') {
      const footer = await page.locator('.bottombar').boundingBox();
      await page.getByRole('button',{name:'レイズ',exact:true}).click();
      await inspect(page, `${width}x${height}-raise`);
      const raisedFooter = await page.locator('.bottombar').boundingBox();
      assert.ok(Math.abs(raisedFooter.y-footer.y)<1,'The raise picker does not push the table or actions');
      await page.getByRole('button',{name:'やめる',exact:true}).click();
      await page.getByRole('button',{name:'卓の情報',exact:true}).click();
      await page.getByRole('tab',{name:'ルール',exact:true}).click();
      assert.ok(await page.locator('.game-dialog .rule-sheet-list li').count()>0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),height);
      await page.screenshot({path:`${out}/${width}x${height}-rules.png`});
      await page.getByRole('tab',{name:'見た目',exact:true}).click();
      for(const shape of ['oval','perspective','racetrack']) {
        await page.locator(`input[name="table-shape"][value="${shape}"]`).check();
        assert.equal(await page.locator('.table-area').getAttribute('data-shape'),shape);
      }
      await page.screenshot({path:`${out}/${width}x${height}-appearance.png`});
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'卓の情報',exact:true}).evaluate(el=>document.activeElement===el),true);
      await inspect(page, `${width}x${height}-panel-closed`);
    }
    await page.close();
  }
  // The actual solo setup can create a table of one human and nine CPUs.
  const solo=await browser.newPage({viewport:{width:390,height:844}});
  solo.on('pageerror',e=>errors.push(e.message));
  await solo.goto(url);
  await solo.getByRole('tab',{name:'ソロ',exact:false}).click();
  await solo.locator('.field',{hasText:'CPU の人数'}).locator('input').fill('9');
  await solo.getByRole('button',{name:'はじめる',exact:true}).click();
  assert.equal(await solo.locator('.seat').count(),10);
  await solo.getByRole('button',{name:'ゲーム開始',exact:true}).click();
  await inspect(solo,'solo-nine-cpus');
  await solo.close();
  const failures=checks.filter(c=>c.pageHeight>c.h+1||c.pageWidth>c.w+1||Math.abs(c.footer.bottom-c.h)>1||
    c.overlaps.length||c.coveredCards.length||c.stockCovered.length||c.clipped.length||c.cornerCovered.length||c.blockedActions.length||c.handWrapped||c.coveredByRaise.length||c.raiseNotVertical);
  await writeFile(`${out}/qa.json`,JSON.stringify({errors,checks,failures},null,2));
  console.log(JSON.stringify({count:checks.length,errors,failures},null,2));
  assert.equal(errors.length+failures.length,0);
} finally { await browser.close(); }
