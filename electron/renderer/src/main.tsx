import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Vendored, not fetched. The app has to work with the network off.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@phosphor-icons/web/regular';

import './styles/nocturne.css';
import './styles/app.css';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
