import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch(), errors = [];
await mkdir('shots-review',{recursive:true});
try {
  for(const [width,height] of [[320,568],[390,844],[667,375],[1100,700],[1920,1080]]) {
    const page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5173/test/fixtures/table-results.html?seats=6&twice=1');
    assert.equal(await page.locator('.table-area .card-highlighted').count(),5,'Exactly the selected winning five are highlighted');
    await page.getByRole('button',{name:'次の獲得者',exact:true}).click();
    assert.equal(await page.locator('.table-area .card-highlighted').count(),5,'Changing winners/runs changes the exact best five');
    await page.screenshot({path:`shots-review/${width}-winner.png`});
    await page.getByRole('button',{name:'結果の詳細',exact:true}).click();
    assert.equal(await page.locator('.summary-run-board').count(),2);
    for(const section of await page.locator('.summary-detail .summary-run').all())
      assert.equal(await section.locator('.card-highlighted').count(),5);
    await page.screenshot({path:`shots-review/${width}-result.png`});
    await page.getByRole('tab',{name:/^手順/}).click();
    const slider=page.getByRole('slider',{name:'表示する手順',exact:true});
    const max=Number(await slider.getAttribute('max'));
    assert.ok(max>12);
    for(let i=0;i<=max;i++) {
      await slider.fill(String(i));
      const r=await page.locator('.history-snapshot').evaluate(el=>{
        const values=[...el.querySelectorAll('tbody tr')].map(row=>[...row.querySelectorAll('td')].map(td=>Number(td.firstChild.textContent.replaceAll(',',''))));
        const pot=el.querySelector('.history-pot');
        const central=Number(pot.querySelector('strong').textContent.replaceAll(',',''));
        return {total:central+values.reduce((s,[chips,bet])=>s+chips+bet,0),width:el.scrollWidth,client:el.clientWidth,
          title:el.querySelector('.history-current').textContent,boards:el.querySelectorAll('.history-board .card').length};
      });
      assert.equal(r.total,120,'Every replay step conserves all chips');
      assert.ok(r.width<=r.client+1,'Replay stays inside the dialog');
      if(i===0)assert.equal(r.boards,0,'No future board in the opening step');
      if(r.title.includes('フロップ'))await page.screenshot({path:`shots-review/${width}-history.png`});
    }
    assert.equal(await page.getByRole('button',{name:'次の手順',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'前の手順',exact:true}).click();
    assert.equal(await slider.inputValue(),String(max-1));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),height);
    await page.close();
  }
  for(const enabled of [true,false]) {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5173/test/fixtures/table-controls.html?seats=3');
    await page.getByRole('button',{name:'卓の情報',exact:true}).click();
    await page.getByRole('tab',{name:'見た目',exact:true}).click();
    const toggle=page.getByRole('checkbox',{name:'オールイン勝負は手札を開いてランアウト',exact:true});
    await toggle.setChecked(!enabled);await toggle.setChecked(enabled);
    await page.getByRole('button',{name:'閉じる',exact:true}).click();
    await page.reload();
    assert.equal(await page.evaluate(()=>localStorage.getItem('wildcard.runout-reveal.v1')),String(enabled));
    await page.locator('.table-area').evaluate(async table=>{
      await Promise.all(table.getAnimations({subtree:true}).filter(a=>a.effect?.target?.classList?.contains('card')).map(a=>a.finished.catch(()=>{})));
    });
    await page.evaluate(()=>window.tableFixture.runout());
    await page.waitForFunction(()=>Date.now()>window.tableFixture.state().runtime.runoutAt+200);
    assert.equal(await page.locator('.seat:not(.seat-viewer) .card-back').count(),enabled?0:4);
    assert.equal(await page.locator('.community-cards .card:not(.card-slot)').count(),0,'Hands open before the remaining board');
    assert.equal(await page.locator('.summary-compact').count(),0,'Payout details stay hidden during the runout');
    await page.screenshot({path:`shots-review/runout-${enabled}.png`});
    await page.waitForFunction(()=>document.querySelector('.table-area')?.dataset.settled==='true');
    assert.equal(await page.locator('.seat .card-back').count(),0,'Both modes reveal at showdown');
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Best-five selection, two-board detail, every ledger step, chip conservation, runout setting on/off and persistence: passed');
} finally {await browser.close();}
