import '@react-spectrum/s2/page.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, localeReady, type HostBridge } from '@baocut/ui';

declare global {
  interface Window {
    baocut: HostBridge;
  }
}

// 开发服务器按需载入当前语言的译文（tools/lazy-locales.ts），取齐再画第一帧；出货包里立即画。
void localeReady().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App host={window.baocut} />
    </StrictMode>,
  ),
);
