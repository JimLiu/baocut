import { useEffect, useState } from 'react';
import { ProgressCircle } from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { ConnectionState } from '@baocut/client';
import type { WebBuildNote } from '@baocut/protocol';
import { useRuntime } from '../runtime/context.tsx';
import { useConnection } from '../state/connection-store.ts';
import { S } from './shell-copy.ts';

/** 贴着内容区顶边的整条横幅：不占卡片位，不把页面内容挤成两栏。 */
const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  minHeight: 40,
  paddingX: 16,
  paddingY: 8,
  boxSizing: 'border-box',
  backgroundColor: { default: 'notice-subtle', isNegative: 'negative-subtle' },
  font: 'ui',
  color: 'neutral',
});
const noticeIcon = iconStyle({ size: 'S', color: 'notice' });
const negativeIcon = iconStyle({ size: 'S', color: 'negative' });
const title = style({ fontWeight: 'bold', flexShrink: 0 });
const detail = style({ color: 'neutral-subdued', minWidth: 0, flexGrow: 1 });

export interface BannerContent {
  title: string;
  text: string;
  negative: boolean;
  retrying: boolean;
}

/**
 * 横幅上写什么。连接的问题在先；页面的构建与源码不一致时（CLI 独立使用与发布 §7.4，只有从源码运行的 Runtime 报）写明原因与重建命令：
 * 协议版本不同、握手被拒时换掉笼统的「不兼容」，连上了也一直提示，画面画不对或画不出来时知道是构建的问题。
 */
export function bannerContent(state: ConnectionState, builds: readonly WebBuildNote[]): BannerContent | null {
  const c = S.connectionBanner;
  if (state.status === 'incompatible') {
    const protocol = builds.find((note) => note.component === 'web' && note.reason === 'protocol');
    return { title: c.title, text: protocol ? c.buildProtocol(protocol.rebuild) : c.incompatible(state.reason), negative: true, retrying: false };
  }
  if (state.status === 'connected' || (state.status === 'connecting' && state.attempt === 0)) {
    // 服务按 `preview.wasm` 在前排：它的重建命令连 Web 客户端一起重建。
    const note = builds.find((item) => item.state === 'stale') ?? builds[0];
    if (!note) return null;
    const part = note.component === 'preview-wasm' ? 'preview' : 'web';
    return {
      title: c.buildTitle,
      text: note.state === 'stale' ? c.buildStale(part, note.rebuild) : c.buildUnverified(part, note.rebuild),
      negative: false,
      retrying: false,
    };
  }
  const retrying = state.status === 'connecting' || (state.status === 'disconnected' && state.retryInMs !== null);
  const text =
    state.status === 'closed'
      ? c.closed
      : state.status === 'disconnected'
        ? c.lost(state.reason, state.retryInMs !== null)
        : c.reconnectingEllipsis;
  return { title: c.title, text, negative: false, retrying };
}

/** 与 Runtime 断开时如实说明；「已连接」之前不允许提交（产品设计 §2.4）。 */
export function ConnectionBanner() {
  const { host } = useRuntime();
  const state = useConnection((s) => s.state);
  const [builds, setBuilds] = useState<readonly WebBuildNote[]>([]);
  useEffect(() => {
    // 页面载入时问一次：比的是这个页面来自的那份构建；重建之后要刷新页面才用得上，横幅也这样说。
    let cancelled = false;
    void host.buildNotes?.().then((notes) => {
      if (!cancelled) setBuilds(notes);
    });
    return () => {
      cancelled = true;
    };
  }, [host]);
  const content = bannerContent(state, builds);
  if (!content) return null;
  const isNegative = content.negative;
  return (
    <div className={bar({ isNegative })} role={isNegative ? 'alert' : 'status'}>
      <AlertTriangle styles={isNegative ? negativeIcon : noticeIcon} aria-hidden />
      <span className={title}>{content.title}</span>
      <span className={detail}>{content.text}</span>
      {content.retrying && <ProgressCircle size="S" isIndeterminate aria-label={S.connectionBanner.reconnecting} />}
    </div>
  );
}
