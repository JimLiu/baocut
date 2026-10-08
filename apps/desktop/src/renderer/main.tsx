import '@react-spectrum/s2/page.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type HostBridge } from '@baocut/ui';

declare global {
  interface Window {
    baocut: HostBridge;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App host={window.baocut} />
  </StrictMode>,
);
