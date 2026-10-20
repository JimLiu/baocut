import './app.css';
import { useEffect, useState } from 'react';
import { intlLocale } from '@baocut/protocol';
import { Provider, ToastContainer, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AppShell } from './components/app-shell.tsx';
import { ReviewShell } from './components/review-shell.tsx';
import type { HostBridge } from './host.ts';
import { RuntimeContext } from './runtime/context.tsx';
import { RuntimeSession } from './runtime/session.ts';
import { useLanguageSync, useLocale } from './state/locale.ts';
import { useShell } from './state/shell-store.ts';
import { installToastAutoDismiss, type ToastQueueLike } from './toast-timing.ts';

// toast 只停几秒，带按钮的也一样（toast-timing.ts）。
installToastAutoDismiss(ToastQueue as unknown as ToastQueueLike);

const rootStyle = style({ height: 'screen', overflow: 'hidden' });

/**
 * 桌面端界面的根。宿主只提供连接信息与少量原生能力，其余都经 Runtime。
 * `initialHref` 是启动时要去的界面内链接（`hrefFor` 的形状）：Web 客户端从地址栏取（访问链接可以直达一个视频的编辑器，
 * `webVideoHref`），桌面端不给。
 * `review` 是 Web 的审片页（`/review/<videoId>`，架构设计 §12.8）：会话只订阅设置，界面只有这一部视频的编辑器。
 */
export function App({ host, initialHref, review }: { host: HostBridge; initialHref?: string; review?: { videoId: string } }) {
  // 只在第一次渲染时去一次；路由不持久化，之后的去向由界面自己决定。
  useState(() => {
    if (initialHref) useShell.getState().navigate(initialHref);
  });
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const navigate = useShell((s) => s.navigate);
  const scheme = useShell((s) => s.colorScheme);
  const locale = useLocale();
  const reviewMode = review !== undefined;

  // 会话随 effect 建立和释放：StrictMode 下 effect 会先跑一遍再清理，关掉的客户端不能复用。
  useEffect(() => {
    const next = new RuntimeSession(host, { review: reviewMode });
    next.start();
    setSession(next);
    return () => next.dispose();
  }, [host, reviewMode]);

  if (!session) return null;
  return (
    <RuntimeContext.Provider value={session}>
      <Provider
        locale={intlLocale(locale)}
        background="base"
        colorScheme={scheme === 'system' ? undefined : scheme}
        router={{ navigate }}
        styles={rootStyle}>
        <LanguageSync />
        {/* 换语言时整棵界面重画：文案目录在读的时候取当前语言，局部状态随之复位，跨屏状态在 store 里。 */}
        {review ? <ReviewShell key={locale} videoId={review.videoId} /> : <AppShell key={locale} platform={host.platform} />}
        <ToastContainer placement="bottom" />
      </Provider>
    </RuntimeContext.Provider>
  );
}

function LanguageSync() {
  useLanguageSync();
  return null;
}
