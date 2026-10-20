import { useEffect, useRef, useState } from 'react';
import type { Card } from '@wildcard/engine';
import { BACK_STYLES, FACE_STYLES, useCardAppearance } from '../cardAppearance.js';
import { PlayingCard } from './PlayingCard.js';

// 固定のサンプル。プレイヤーの手札や未公開の場札は参照しない。
const SAMPLE_CARDS: readonly Card[] = [
  { rank: 'A', suit: 'spades' },
  { rank: 'K', suit: 'hearts' },
  { rank: 'Q', suit: 'clubs' },
  { rank: '10', suit: 'diamonds' },
];

export function CardAppearancePicker() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-muted btn-small card-appearance-trigger" onClick={() => setOpen(true)}>
        <span aria-hidden="true">▧</span> カードのデザイン
      </button>
      {open && <AppearanceDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AppearanceDialog({ onClose }: { readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { appearance, updateAppearance, saveFailed } = useCardAppearance();

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="card-appearance-dialog" aria-labelledby="card-appearance-title"
      onClose={() => {
        // StrictMode の再セットアップで再び開いている場合、古い close イベントは無視する。
        if (!dialog.current?.open) onClose();
      }}>
      <div className="appearance-head">
        <div>
          <p className="eyebrow">YOUR DECK</p>
          <h2 id="card-appearance-title">カードのデザイン</h2>
        </div>
        <button type="button" className="btn btn-muted btn-small" onClick={() => dialog.current?.close()} autoFocus>
          閉じる
        </button>
      </div>
      <p className="appearance-intro">表と裏を自由に組み合わせて、自分の見やすい一組に。</p>
      <div className="appearance-preview" aria-label="選択中のデザインのプレビュー">
        <span className="appearance-preview-label">PREVIEW</span>
        <div className="appearance-preview-cards">
          {SAMPLE_CARDS.map((card) => <PlayingCard key={card.suit} card={card} size="lg" />)}
          <PlayingCard card={null} size="lg" />
        </div>
        <span className="appearance-preview-note">表示用のサンプルカード</span>
      </div>

      <fieldset className="appearance-fieldset">
        <legend>表面 <span>FACE</span></legend>
        <div className="appearance-options">
          {FACE_STYLES.map((style) => (
            <label key={style.id} className="appearance-option">
              <input type="radio" name="card-face" value={style.id} checked={appearance.face === style.id}
                onChange={() => updateAppearance({ face: style.id })} />
              <span className="appearance-option-cards" aria-hidden="true">
                <PlayingCard card={SAMPLE_CARDS[0]!} faceStyle={style.id} size="lg" />
                <PlayingCard card={SAMPLE_CARDS[style.id === 'four-color' ? 2 : 1]!} faceStyle={style.id} size="lg" />
              </span>
              <span className="appearance-option-name">{style.name}</span>
              <span className="appearance-option-description">{style.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="appearance-fieldset">
        <legend>裏面 <span>BACK</span></legend>
        <div className="appearance-options">
          {BACK_STYLES.map((style) => (
            <label key={style.id} className="appearance-option">
              <input type="radio" name="card-back" value={style.id} checked={appearance.back === style.id}
                onChange={() => updateAppearance({ back: style.id })} />
              <span className="appearance-option-cards" aria-hidden="true">
                <PlayingCard card={null} backStyle={style.id} size="lg" />
              </span>
              <span className="appearance-option-name">{style.name}</span>
              <span className="appearance-option-description">{style.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="appearance-save-status" role="status">
        {saveFailed
          ? '表示に反映しました。このブラウザへの保存はできませんでした。'
          : '選ぶとすぐに反映・自動保存されます。このブラウザでの表示に適用します。'}
      </p>
    </dialog>
  );
}
