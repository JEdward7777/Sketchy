import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { speech } from './narrator/speech';
import { registerServiceWorker } from './register-sw';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
// Listen for the first tap from the start, so the Create or Join tap unlocks speech on iOS (12.1.3).
speech();
