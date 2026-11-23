import { useEffect, useRef, useState } from 'react';
import { RpcError, type ArtifactOpenResult, type Id } from '@baocut/protocol';
import { embedArtifact, type EmbeddedArtifact, type HostToShell } from '@open-artifact/harness-kit/embed';
import { Button, ProgressCircle, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ARTIFACTS } from '../../model/artifacts-copy.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { onShellMessage, takePreopened, useArtifacts } from '../../state/artifacts-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { startDraftKey } from '../start/open-home.ts';

const frame = style({ flexGrow: 1, width: 'full', minHeight: 0, borderWidth: 0, backgroundColor: 'gray-25' });
const centered = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  flexGrow: 1,
  padding: 24,
  font: 'ui',
  color: 'gray-600',
  textAlign: 'center',
});
const detail = style({ font: 'ui-sm', color: 'gray-600', maxWidth: 480, overflowWrap: 'anywhere' });
const actions = style({ display: 'flex', gap: 8 });

type State = { status: 'opening' } | { status: 'open'; open: ArtifactOpenResult } | { status: 'failed'; message: string; viewUrl: string | null };

/** 界面当前的明暗：跟着设置里的外观，「跟随系统」时看系统。 */
function useScheme(): 'light' | 'dark' {
  const setting = useShell((s) => s.colorScheme);
  const [systemDark, setSystemDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return setting === 'system' ? (systemDark ? 'dark' : 'light') : setting;
}

/**
 * 功能区的作品标签（docs/design/artifacts §5）：`artifacts.open` 拿到 Shell 页面带一次性视图票据的地址，放进 iframe。
 * 页面与宿主之间的消息走 Runtime（Open Artifact 的 view 模式）：发给页面的用 `artifacts.shellCommand`，页面说的从 `artifacts`
 * 主题的 `artifacts.shell` 事件回来；握手、主题与「新会话」「打开会话」交给 `@open-artifact/harness-kit/embed`。
 * 智能体刚打开的作品（`artifacts.show`）已经带着票据，先用那一份。Runtime 重启或 daemon 换了端口后点「重试」重新打开。
 */
export function ArtifactPane({ url, conversationId, active }: { url: string; conversationId: Id | null; active: boolean }) {
  const runtime = useRuntime();
  const scheme = useScheme();
  const available = useArtifacts((s) => s.available);
  const [state, setState] = useState<State>({ status: 'opening' });
  const [attempt, setAttempt] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const embedRef = useRef<EmbeddedArtifact | null>(null);
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;

  // 打开：先用智能体刚给的那一份，否则问 Runtime 要一个新视图。
  useEffect(() => {
    let cancelled = false;
    const ready = attempt === 0 ? takePreopened(url) : null;
    if (ready) {
      setState({ status: 'open', open: ready });
      return;
    }
    setState({ status: 'opening' });
    runtime.client
      .request('artifacts.open', { url, ...(conversationId ? { conversationId } : {}) })
      .then(
        (open) => !cancelled && setState({ status: 'open', open }),
        (error: unknown) => {
          if (cancelled) return;
          const message = error instanceof RpcError || error instanceof Error ? error.message : String(error);
          setState({ status: 'failed', message, viewUrl: null });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [runtime, url, conversationId, attempt]);

  // daemon 重新连上了而这个标签打开失败过：自动再试一次。
  useEffect(() => {
    if (available && state.status === 'failed') setAttempt((n) => n + 1);
    // 只在连上的那一刻。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  // 和页面握手：view 模式，消息经 Runtime 往来。
  const view = state.status === 'open' ? state.open.view : null;
  const embedUrl = state.status === 'open' ? state.open.embedUrl : null;
  useEffect(() => {
    if (!view || !embedUrl) return;
    const embedded = embedArtifact(
      {
        send: (command: HostToShell) =>
          runtime.client.request('artifacts.shellCommand', { view, command: command as unknown as Record<string, unknown> }).then(() => undefined),
        onEvent: (listener) => onShellMessage(view, listener),
      },
      {
        url: embedUrl,
        agentName: 'BaoCut',
        harness: 'baocut',
        theme: { scheme: schemeRef.current },
        onOpenSession: ({ session }) => {
          if (session) useShell.getState().go({ tab: 'home', conversationId: session, projectId: null });
        },
        onNewSession: ({ prompt }) => {
          // 页面上「新会话」里写的话放进新会话的输入框，由用户自己发（docs/design/artifacts §5）。
          if (prompt) useShell.getState().setDraft(startDraftKey(null), prompt);
          useShell.getState().go({ tab: 'home', conversationId: null, projectId: null });
        },
        onOpenExternal: (link) => openOutside(runtime.host.openExternal, link),
        onError: () => {},
      },
    );
    embedRef.current = embedded;
    return () => {
      embedded.destroy();
      if (embedRef.current === embedded) embedRef.current = null;
    };
  }, [runtime, view, embedUrl]);

  useEffect(() => {
    embedRef.current?.setTheme({ scheme });
  }, [scheme]);

  if (state.status === 'opening')
    return (
      <div className={centered}>
        <ProgressCircle isIndeterminate aria-label={ARTIFACTS.opening} />
        <span>{ARTIFACTS.opening}</span>
      </div>
    );
  if (state.status === 'failed')
    return (
      <div className={centered} role="alert">
        <span>{available ? ARTIFACTS.openFailed : ARTIFACTS.unavailable}</span>
        <span className={detail}>{state.message}</span>
        <div className={actions}>
          <Button variant="secondary" onPress={() => setAttempt((n) => n + 1)}>
            {ARTIFACTS.retry}
          </Button>
        </div>
      </div>
    );
  return (
    <iframe
      ref={iframeRef}
      className={frame}
      src={state.open.embedUrl}
      title={state.open.title || ARTIFACTS.kind}
      // 隐藏的标签不抢焦点；页面自己的快捷键只在显示时有用。
      tabIndex={active ? 0 : -1}
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  );
}

/** 交给系统浏览器：桌面端走宿主（只收 http/https），浏览器里直接开新窗口。 */
function openOutside(open: ((url: string) => Promise<void>) | undefined, url: string): void {
  if (open) void open(url).catch((error: Error) => ToastQueue.negative(error.message, { timeout: 5000 }));
  else window.open(url, '_blank', 'noopener,noreferrer');
}
