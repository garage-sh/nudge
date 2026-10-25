import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import '@fontsource-variable/instrument-sans';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Element #root not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
