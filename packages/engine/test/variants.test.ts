import { describe, expect, it } from 'vitest';
import { compareHands, evaluateHand } from '../src/rules/evaluate.js';
import { STANDARD_RULESET } from '../src/rules/presets.js';
import {
  ACE_LOW,
  FLUSH_OVER_FULL_HOUSE,
  HOUSE_HANDS,
  RULE_PRESETS,
  SHORT_DECK,
  SUIT_RANKED,
  activeRankings,
  findPreset,
} from '../src/rules/variants.js';
import { buildDeck } from '../src/deck.js';
import type { RuleSet } from '../src/types.js';
import { cards } from './helpers.js';

function hand(notation: string, ruleSet: RuleSet) {
  const result = evaluateHand(cards(notation), ruleSet);
  if (!result) throw new Error(`役が成立しなかった: ${notation}`);
  return result;
}

describe('プリセット一覧', () => {
  it('id が重複していない', () => {
    const ids = RULE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('id から引ける', () => {
    for (const preset of RULE_PRESETS) {
      expect(findPreset(preset.id)).toBe(preset);
    }
    expect(findPreset('存在しない')).toBeUndefined();
  });

  it('どのプリセットでも役が判定できる', () => {
    for (const preset of RULE_PRESETS) {
      const deck = buildDeck(preset.deck);
      const five = deck.slice(0, 5);
      expect(evaluateHand(five, preset), `${preset.name} で判定できない`).not.toBeNull();
    }
  });

  it('有効な役の一覧を取れる', () => {
    expect(activeRankings(STANDARD_RULESET)).toHaveLength(12);
    // エース最弱はロイヤルと2種のホイールを落としている
    expect(activeRankings(ACE_LOW)).toHaveLength(9);
  });
});

describe('ショートデッキ（6+）', () => {
  it('デッキが36枚になる', () => {
    expect(buildDeck(SHORT_DECK.deck)).toHaveLength(36);
  });

  it('フラッシュがフルハウスより強い', () => {
    const flush = hand('As Ks Qs Js 9s', SHORT_DECK);
    const fullHouse = hand('Ah Ad Ac Kh Kd', SHORT_DECK);
    expect(flush.rankingId).toBe('flush');
    expect(compareHands(flush, fullHouse)).toBeGreaterThan(0);
    // 標準では逆
    expect(
      compareHands(hand('As Ks Qs Js 9s', STANDARD_RULESET), hand('Ah Ad Ac Kh Kd', STANDARD_RULESET)),
    ).toBeLessThan(0);
  });

  it('最弱のストレートが A-6-7-8-9 になる', () => {
    const wheel = hand('Ah 6s 7d 8c 9s', SHORT_DECK);
    expect(wheel.rankingId).toBe('wheel');
    // 7-8-9-10-J のほうが強い
    expect(compareHands(hand('7h 8s 9d Tc Js', SHORT_DECK), wheel)).toBeGreaterThan(0);
    // スリーカードよりは強い
    expect(compareHands(wheel, hand('6h 6s 6d Kc Qs', SHORT_DECK))).toBeGreaterThan(0);
  });

  it('A-2-3-4-5 は存在しない（2〜5がデッキにない）', () => {
    expect(() => hand('Ah 2s 3d 4c 5s', SHORT_DECK)).toThrow();
  });
});

describe('エースが最弱', () => {
  it('A のペアが2のペアに負ける', () => {
    expect(compareHands(hand('2s 2h 5c 4h 3s', ACE_LOW), hand('As Ah Kc Qh Js', ACE_LOW))).toBeGreaterThan(0);
  });

  it('A-2-3-4-5 が普通のストレートになる', () => {
    const low = hand('Ah 2s 3d 4c 5s', ACE_LOW);
    expect(low.rankingId).toBe('straight');
  });

  it('一番強いストレートは 9-10-J-Q-K', () => {
    const top = hand('9h Ts Jd Qc Ks', ACE_LOW);
    expect(top.rankingId).toBe('straight');
    expect(compareHands(top, hand('Ah 2s 3d 4c 5s', ACE_LOW))).toBeGreaterThan(0);
  });

  it('10-J-Q-K-A はストレートにならない', () => {
    // A が最弱なので連続していない。同スートでもフラッシュ止まり。
    expect(hand('Ts Js Qs Ks As', ACE_LOW).rankingId).toBe('flush');
    expect(hand('Th Js Qd Kc As', ACE_LOW).rankingId).toBe('high_card');
  });
});

describe('スートに強弱あり', () => {
  it('同じ役・同じランクでも決着がつく', () => {
    const a = hand('As Ah Kc 3h 2s', SUIT_RANKED);
    const b = hand('Ad Ac Kd 3d 2d', SUIT_RANKED);
    expect(compareHands(a, b)).toBeGreaterThan(0);
    // 標準なら引き分け
    expect(
      compareHands(hand('As Ah Kc 3h 2s', STANDARD_RULESET), hand('Ad Ac Kd 3d 2d', STANDARD_RULESET)),
    ).toBe(0);
  });
});

describe('フラッシュ > フルハウス', () => {
  it('順位が入れ替わっている', () => {
    expect(
      compareHands(
        hand('As Ks Qs Js 9s', FLUSH_OVER_FULL_HOUSE),
        hand('Ah Ad Ac Kh Kd', FLUSH_OVER_FULL_HOUSE),
      ),
    ).toBeGreaterThan(0);
  });

  it('他の序列は壊れていない', () => {
    const quads = hand('As Ah Ad Ac Kh', FLUSH_OVER_FULL_HOUSE);
    const flush = hand('2s 5s 7s 9s Js', FLUSH_OVER_FULL_HOUSE);
    const straight = hand('9h Ts Jd Qc Ks', FLUSH_OVER_FULL_HOUSE);
    expect(compareHands(quads, flush)).toBeGreaterThan(0);
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });
});

describe('独自役入り', () => {
  it('ミニストレートがワンペアより強い', () => {
    const mini = hand('5h 6s 7d Kc 2s', HOUSE_HANDS);
    // A,K,9,5 には3枚連続が無いので純粋なワンペア
    const pair = hand('As Ah Kc 9h 5s', HOUSE_HANDS);
    expect(mini.rankingId).toBe('mini_straight');
    expect(pair.rankingId).toBe('one_pair');
    expect(compareHands(mini, pair)).toBeGreaterThan(0);
  });

  it('役を足すと、今までワンペアだった手がミニストレートになる', () => {
    // Q-K-A が3枚連続になるので、標準ならただのAペアでも独自役が成立する。
    // 役を足すというのはこういう影響の出方をする、という記録。
    expect(hand('As Ah Kc Qh 9s', STANDARD_RULESET).rankingId).toBe('one_pair');
    expect(hand('As Ah Kc Qh 9s', HOUSE_HANDS).rankingId).toBe('mini_straight');
  });

  it('ペア＋三連がツーペアより強い', () => {
    const combo = hand('As Ah 5c 6h 7s', HOUSE_HANDS);
    expect(combo.rankingId).toBe('pair_plus_run');
    expect(compareHands(combo, hand('Ks Kh Qc Qh 2s', HOUSE_HANDS))).toBeGreaterThan(0);
  });

  it('標準の役はそのまま残っている', () => {
    expect(hand('As Ks Qs Js Ts', HOUSE_HANDS).rankingId).toBe('royal_flush');
    expect(hand('As Ah Ad Kc Kh', HOUSE_HANDS).rankingId).toBe('full_house');
  });

  it('標準ルールでは独自役が成立しない', () => {
    expect(hand('5h 6s 7d Kc 2s', STANDARD_RULESET).rankingId).toBe('high_card');
  });
});
