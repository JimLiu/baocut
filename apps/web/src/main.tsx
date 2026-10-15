import '@react-spectrum/s2/page.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, localeReady } from '@baocut/ui';
import { webHost } from './web-host.ts';

// 访问链接的路径与查询是启动时要去的界面（`/home?video=…` 直达一个视频的编辑器）；一次性代码由登录页用掉。
// 交给界面之后地址栏回到根路径：界面不跟着路由改地址栏，留着旧地址会与实际所在的页面对不上；已登录时又打开了访问链接，
// fragment 里的代码也随之从地址栏与历史记录里去掉。
const initialHref = location.pathname + location.search;
if (initialHref !== '/' || location.hash) history.replaceState(null, '', '/');

// 开发服务器按需载入当前语言的译文（tools/lazy-locales.ts），取齐再画第一帧；出货包里立即画。
void localeReady().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App host={webHost} initialHref={initialHref === '/' ? undefined : initialHref} />
    </StrictMode>,
  ),
);
