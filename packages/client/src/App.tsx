import { useEffect, useState } from 'react';
import { SetupScreen, type SetupMode } from './components/SetupScreen.js';
import { RuleEditor } from './components/editor/RuleEditor.js';
import { resolveVariant } from './rules/customVariants.js';
import { VARIANT_PRESETS } from '@wildcard/engine';
import { HotSeatTable, type HotSeatSettings } from './modes/HotSeatTable.js';
import { OnlineTable, type OnlineSettings } from './modes/OnlineTable.js';
import { SoloTable, type SoloSettings } from './modes/SoloTable.js';

type Screen =
  | { readonly kind: 'setup' }
  | { readonly kind: 'editor'; readonly sourceId: string }
  | { readonly kind: 'hotseat'; readonly settings: HotSeatSettings }
  | { readonly kind: 'online'; readonly settings: OnlineSettings }
  | { readonly kind: 'solo'; readonly settings: SoloSettings };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'setup' });
  // 編集画面から戻ったとき、作ったルールが選ばれた状態にしておく。
  const [variantId, setVariantId] = useState('standard');
  // どのモードを見ていたかも保つ。ソロで試そうとして編集に入り、
  // 戻ったらオンラインの画面だった、では流れが切れる。
  const [mode, setMode] = useState<SetupMode>('solo');
  const toSetup = () => setScreen({ kind: 'setup' });
  // 設定の下までスクロールした位置を、新しい卓や編集画面に持ち越さない。
  useEffect(() => { window.scrollTo(0, 0); }, [screen.kind]);

  switch (screen.kind) {
    case 'setup':
    case 'editor':
      return (
        <>
        <div hidden={screen.kind === 'editor'}>
        <SetupScreen
          mode={mode}
          onModeChange={setMode}
          variantId={variantId}
          onVariantChange={setVariantId}
          onEditRules={(sourceId) => setScreen({ kind: 'editor', sourceId })}
          onStartHotSeat={(settings) => setScreen({ kind: 'hotseat', settings })}
          onStartOnline={(settings) => setScreen({ kind: 'online', settings })}
          onStartSolo={(settings) => setScreen({ kind: 'solo', settings })}
        />
        </div>
        {screen.kind === 'editor' &&
        <RuleEditor
          source={resolveVariant(screen.sourceId) ?? VARIANT_PRESETS[0]!}
          onClose={toSetup}
          onPlay={(id) => {
            setVariantId(id);
            toSetup();
          }}
        />
        }
        </>
      );
    case 'hotseat':
      return <HotSeatTable settings={screen.settings} onExit={toSetup} />;
    case 'online':
      return <OnlineTable settings={screen.settings} onExit={toSetup} />;
    case 'solo':
      return <SoloTable settings={screen.settings} onExit={toSetup} />;
  }
}
