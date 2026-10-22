import { expect, it } from 'vitest';
import { createGame, reduce, legalActions, project, type GameState } from '../src/index.js';

function table(stacks = [1000,1000,1000], twice = false) {
  let s = createGame({seatCount:stacks.length, variant:{...createGame().variant, options:twice ? {runItTwice:{max:2}} : {}}});
  stacks.forEach((chips,seat) => { s=reduce(s,{type:'sit',playerId:`p${seat}`,name:`P${seat}`,seat,chips}); });
  return reduce(s,{type:'startHand',seed:5});
}
function checkLedger(s: GameState, total: number) {
  for (const step of s.history!) {
    expect(step.pot + step.players.reduce((v,p)=>v+p.chips+p.bet,0), step.kind).toBe(total);
    expect(step.pot).toBeGreaterThanOrEqual(0);
    for (const p of step.players) { expect(p.chips).toBeGreaterThanOrEqual(0);expect(p.bet).toBeGreaterThanOrEqual(0); }
  }
  if (s.phase==='showdown') {
    expect(s.history!.at(-1)!.pot).toBe(0);
    expect(s.history!.at(-1)!.players.map(p=>p.chips)).toEqual(s.players.map(p=>p.chips));
  }
}
it('records blind top-ups, collections and each board without hidden cards',()=>{
  let s=table();
  expect(s.history!.map(h=>h.kind)).toEqual(['deal','blind','blind']);
  while(s.phase!=='showdown') {
    const playerId=s.turnPlayerId!;
    s=reduce(s,{type:legalActions(s,playerId)!.canCheck?'check':'call',playerId});
  }
  checkLedger(s,3000);
  const sb=s.history!.find(h=>h.kind==='call'&&h.playerId==='p1')!;
  expect(sb.amount).toBe(10);expect(sb.players.find(p=>p.id==='p1')!.bet).toBe(20);
  expect(s.history!.filter(h=>h.kind==='board').map(h=>h.boards[0]!.length)).toEqual([3,4,5]);
  expect(s.history!.filter(h=>h.kind==='collect')).toHaveLength(1);
  const publicHistory=JSON.stringify(project(s,null).history);
  for(const privateKey of ['holeCards','seed','deck','burned']) expect(publicHistory).not.toContain(`"${privateKey}"`);
  const next=reduce(s,{type:'startHand',seed:8});expect(next.history!.length).toBe(3);
});
it('separates uncalled refunds from awards',()=>{
  let s=table();s=reduce(s,{type:'raise',playerId:s.turnPlayerId!,to:200});
  while(s.phase!=='showdown')s=reduce(s,{type:'fold',playerId:s.turnPlayerId!});
  checkLedger(s,3000);
  expect(s.history!.find(h=>h.kind==='refund')!.amount).toBe(180);
  expect(s.history!.find(h=>h.kind==='award')!.amount).toBe(50);
  expect(s.summary!.revealed).toEqual([]);
});
it('keeps unequal all-ins and two runouts balanced at every step',()=>{
  for(const twice of [false,true]) {
    let s=table([1000,400,700],twice);
    s=reduce(s,{type:'raise',playerId:s.turnPlayerId!,to:1000});
    while(s.phase!=='showdown') s=reduce(s,s.phase==='runChoice'?{type:'runItTwice',playerId:s.turnPlayerId!,agree:true}:{type:'call',playerId:s.turnPlayerId!});
    checkLedger(s,2100);
    expect(s.history!.filter(h=>h.kind==='board')).toHaveLength(twice?6:3);
    expect(s.history!.filter(h=>h.kind==='collect')).toHaveLength(1);
    for(const run of s.summary!.runs??[s.summary!]) for(const hand of run.revealed) expect(hand.usedCards).toHaveLength(5);
  }
});
it('records automatic folds once and ignores rejected actions',()=>{
  let s=table();const original=s;
  expect(reduce(s,{type:'check',playerId:'p0'})).toBe(original);
  s=reduce(s,{type:'timeout',playerId:'p0'});
  expect(s.history!.at(-1)!.kind).toBe('timeout-fold');
  s=reduce(s,{type:'setAway',playerId:'p1',away:true});
  checkLedger(s,3000);
  expect(s.history!.filter(h=>h.kind==='fold'&&h.playerId==='p1')).toHaveLength(1);
});

it('places an away fold after the flop that triggers it, and excludes waiting joiners',()=>{
  let s=table();
  s=reduce(s,{type:'call',playerId:'p0'});s=reduce(s,{type:'call',playerId:'p1'});
  s=reduce(s,{type:'setAway',playerId:'p1',away:true});
  s=reduce(s,{type:'check',playerId:'p2'});
  const fold=s.history!.findIndex(h=>h.kind==='fold'&&h.playerId==='p1');
  const flop=s.history!.findIndex(h=>h.kind==='board');
  expect(fold).toBeGreaterThan(flop);expect(s.history![fold]!.streetIndex).toBe(0);
  checkLedger(s,3000);
  expect(project(s,null).history).toBeUndefined();
  let joined=createGame({seatCount:4});
  for(let i=0;i<3;i++)joined=reduce(joined,{type:'sit',playerId:`p${i}`,name:`P${i}`,seat:i,chips:1000});
  joined=reduce(joined,{type:'startHand',seed:3});
  joined=reduce(joined,{type:'sit',playerId:'new',name:'New',seat:3,chips:500});
  joined=reduce(joined,{type:'call',playerId:joined.turnPlayerId!});
  checkLedger(joined,3000);
  expect(joined.history!.at(-1)!.players.some(p=>p.id==='new')).toBe(false);
});
