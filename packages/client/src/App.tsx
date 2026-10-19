import { useState } from 'react';
import { SetupScreen } from './components/SetupScreen.js';
import { HotSeatTable, type HotSeatSettings } from './modes/HotSeatTable.js';
import { OnlineTable, type OnlineSettings } from './modes/OnlineTable.js';
import { SoloTable, type SoloSettings } from './modes/SoloTable.js';

type Screen =
  | { readonly kind: 'setup' }
  | { readonly kind: 'hotseat'; readonly settings: HotSeatSettings }
  | { readonly kind: 'online'; readonly settings: OnlineSettings }
  | { readonly kind: 'solo'; readonly settings: SoloSettings };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'setup' });
  const toSetup = () => setScreen({ kind: 'setup' });

  switch (screen.kind) {
    case 'setup':
      return (
        <SetupScreen
          onStartHotSeat={(settings) => setScreen({ kind: 'hotseat', settings })}
          onStartOnline={(settings) => setScreen({ kind: 'online', settings })}
          onStartSolo={(settings) => setScreen({ kind: 'solo', settings })}
        />
      );
    case 'hotseat':
      return <HotSeatTable settings={screen.settings} onExit={toSetup} />;
    case 'online':
      return <OnlineTable settings={screen.settings} onExit={toSetup} />;
    case 'solo':
      return <SoloTable settings={screen.settings} onExit={toSetup} />;
  }
}
