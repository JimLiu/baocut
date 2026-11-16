import '@react-spectrum/s2/page.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, localeReady, type HostBridge, type RecordingSurfaceBridge } from '@baocut/ui';

declare global {
  interface Window {
    baocut: HostBridge;
    /** 录制的小窗（`?surface=`）才有：preload `recording-surface.ts`。 */
    recordingSurface?: RecordingSurfaceBridge;
  }
}

const root = document.getElementById('root')!;
if (new URLSearchParams(location.search).has('surface') && window.recordingSurface) {
  // 录制的小窗（屏幕录制设计 §11）：同一个页面，另一棵界面；只在桌面端按需载入，不进 Web。
  const bridge = window.recordingSurface;
  void import('@baocut/ui/recording-surface').then((m) => m.mountRecordingSurface(root, bridge));
} else {
  // 开发服务器按需载入当前语言的译文（tools/lazy-locales.ts），取齐再画第一帧；出货包里立即画。
  void localeReady().then(() =>
    createRoot(root).render(
      <StrictMode>
        <App host={window.baocut} />
      </StrictMode>,
    ),
  );
}
