import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const out = 'shots-chips';
await mkdir(out,{recursive:true});
const results = [], errors = [];
try {
  const sizes = process.env.WILDCARD_SIZES ? process.env.WILDCARD_SIZES.split(',').map(s=>s.split('x').map(Number))
    : [[320,568],[390,844],[719,800],[1024,768],[1100,700],[1280,900],[1920,1080],[2560,1440],[667,375],[844,390]];
  for (const [width,height] of sizes) for (const count of [2,6,10]) {
    const page = await browser.newPage({viewport:{width,height}});
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:5173/test/fixtures/table-controls.html?seats=${count}`);
    await page.evaluate(count=>{ for(let i=0;i<count-1;i++)window.tableFixture.advance(); },count);
    await page.waitForTimeout(1200);
    await page.locator('.table-area').evaluate(async table => {
      await Promise.all(table.getAnimations({subtree:true})
        .filter(animation=>animation.effect?.target?.classList?.contains('card'))
        .map(animation=>animation.finished.catch(()=>{})));
    });
    const result = await page.evaluate(()=>{
      const rect = n=>n.getBoundingClientRect();
      const textRect = n=>{ const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect(); };
      const hit=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;
      const blockers=[...document.querySelectorAll('.seat-profile,.seat .card,.community-cards .card,.table-position-chip,.stock-pile')];
      const ink=[...document.querySelectorAll('.bet-amount,.posted-chips .chip-stack')];
      const overlaps=ink.flatMap(n=>blockers.filter(b=>hit(n.classList.contains('bet-amount')?textRect(n):rect(n),rect(b))).map(b=>`${n.closest('.table-bet-anchor').dataset.playerId}: ${b.className}`));
      const clipped=ink.filter(n=>{const r=rect(n);return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight}).length;
      const pot = document.querySelector('.table-pot');
      return {overlaps,clipped,posted:[...document.querySelectorAll('.table-bet')].reduce((sum,n)=>sum+Number(n.dataset.amount),0),pot:pot.textContent,collected:Number(pot.dataset.collected),pending:Number(pot.dataset.pending)};
    });
    assert.equal(result.posted,count*20,'Every live bet remains in front');
    assert.equal(result.pot,`0（+${count*20}）`);
    assert.equal(result.collected,0);
    assert.equal(result.pending,count*20);
    assert.equal(await page.locator('.table-pot .chip-stack').count(),0,'Live bets have not reached the central pot');
    assert.equal(await page.locator('.stock-pile small').count(),0,'Stock piles have no visible labels');
    assert.equal(await page.locator('.chip-stack small,.seat-bet').count(),0);
    for(const [selector,expected] of [['.seat-name','text'],['.seat-chips','text'],['.card','none'],['button','none']])
      assert.equal(await page.locator(selector).first().evaluate(e=>getComputedStyle(e).userSelect),expected);
    await page.screenshot({path:`${out}/${width}x${height}-${count}.png`});
    results.push({width,height,count,...result});
    if(width===1920&&count===6){
      await page.evaluate(()=>window.tableFixture.advance());
      await page.waitForTimeout(500);
      assert.ok(await page.locator('.motion-piece[data-kind="collect"]').count()>0);
      assert.equal(await page.locator('.table-pot .chip-stack').count(),0);
      assert.equal(await page.locator('.table-pot').getAttribute('data-pending'),String(count*20));
      await page.screenshot({path:`${out}/collecting.png`});
      await page.waitForFunction(()=>document.querySelectorAll('.table-pot .chip-stack').length>0);
      assert.equal(await page.locator('.bet-amount').count(),0);
      assert.equal(await page.locator('.table-pot').innerText(),String(count*20));
      assert.equal(await page.locator('.table-pot').getAttribute('data-pending'),'0');
      await page.waitForTimeout(2000);
      await page.screenshot({path:`${out}/collected.png`});
    }
    await page.close();
  }
  const failures=results.filter(r=>r.overlaps.length||r.clipped);
  await writeFile(`${out}/qa.json`,JSON.stringify({results,errors,failures},null,2));
  console.log(JSON.stringify({count:results.length,errors,failures},null,2));
  assert.equal(errors.length+failures.length,0);
} finally {await browser.close();}
