import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const racine = document.getElementById('racine');
if (!racine) throw new Error('Élément #racine introuvable');
createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
