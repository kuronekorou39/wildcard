import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { CardAppearanceProvider } from './cardAppearance.js';
import './styles.css';
import './layout.css';
import './cards.css';
import './game.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つからない');

createRoot(root).render(
  <StrictMode>
    <CardAppearanceProvider>
      <App />
    </CardAppearanceProvider>
  </StrictMode>,
);
