import { bench, describe } from 'vitest';
import { buildDeck, shuffle } from '../src/deck.js';
import { evaluateExactFive, evaluateHand } from '../src/rules/evaluate.js';
import { STANDARD_RULESET } from '../src/rules/presets.js';

/**
 * 役評価の速度。
 *
 * カスタムルール下では「何が強い手か」をヒューリスティックで書けないため、
 * CPU相手は勝率のモンテカルロ推定に頼ることになる。1手の判断で数百回の
 * 評価が走るので、ここの速度がそのまま CPU の思考時間になる。
 */
const deck = buildDeck(STANDARD_RULESET.deck);
const sevens = Array.from({ length: 500 }, (_, i) => shuffle(deck, i).slice(0, 7));
const fives = sevens.map((h) => h.slice(0, 5));

describe('役評価', () => {
  bench('7枚から最強の5枚を選ぶ（ショーダウンと勝率推定）', () => {
    for (const h of sevens) evaluateHand(h, STANDARD_RULESET);
  });

  bench('ちょうど5枚を評価する', () => {
    for (const h of fives) evaluateExactFive(h, STANDARD_RULESET);
  });
});
