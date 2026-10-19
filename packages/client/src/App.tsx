import { useState } from 'react';
import { SetupScreen } from './components/SetupScreen.js';
import { HotSeatTable, type HotSeatSettings } from './modes/HotSeatTable.js';

export function App() {
  const [settings, setSettings] = useState<HotSeatSettings | null>(null);

  if (!settings) return <SetupScreen onStart={setSettings} />;
  return <HotSeatTable settings={settings} onExit={() => setSettings(null)} />;
}
