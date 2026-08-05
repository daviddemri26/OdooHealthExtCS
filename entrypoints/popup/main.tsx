import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Popup } from './Popup';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root is missing.');

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
