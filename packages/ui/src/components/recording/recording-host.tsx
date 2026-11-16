import { useCallback, useEffect, useRef } from 'react';
import { localizeText, type Id, type RecordingState, type RecordingSummary } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import { autoOpenWaiting, recordingEntry, shouldOpenAfter, type RecordingBlock, type RecordingEntry, type SourcesState } from '../../model/recording.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useRecordingPrefs, useRecordings, type RecordingPanelRequest } from '../../state/recordings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { RC } from './recording-copy.ts';
import { RecordingPanel } from './recording-panel.tsx';

/*
 * 屏幕录制在界面里的根（屏幕录制设计 §11）：挂在外壳上，是 `recordings` 主题唯一的订阅者。
 * - 连上之后问一次能录什么（`recordings.sources`），入口据此显示或置灰；面板打开时再问一次。
 * - 智能体在这条会话里发起的录制停在 `waiting`：正看着这条会话时自动弹出预先填好的面板（关掉就是 `recordings.cancel`）。
 * - 看着一次录制走到「已进时间线」、选项要求打开时，打开编辑器到那个视频（录进当前视频的，编辑器本来就开着）。
 * - 把设置 › 录制的几项交给宿主（主进程的控制条、菜单栏图标与全局快捷键）。
 * Web 没有这些：主题与方法都不对 Web 开放，宿主也没有录制能力。
 */

/** 宿主有录制能力（桌面端）。 */
export function useRecordingCapable(): boolean {
  const runtime = useRuntime();
  return runtime.host.platform !== 'web' && !!runtime.host.recording;
}

/** 问一次能录什么，写进 store；被拒绝时记下 Runtime 给的代码与原因（远程、平台不支持）。 */
export async function loadSources(runtime: RuntimeSession): Promise<void> {
  const store = useRecordings.getState();
  const prev = store.sources;
  store.setSources({ status: 'loading', last: prev.status === 'ready' ? prev.sources : prev.status === 'loading' ? prev.last : null });
  try {
    const sources = await runtime.client.request('recordings.sources', {});
    useRecordings.getState().setSources({ status: 'ready', sources });
  } catch (error) {
    useRecordings.getState().setSources(sourcesError(error));
  }
}

function sourcesError(error: unknown): SourcesState {
  const details = (error as { details?: unknown } | null)?.details as { code?: unknown; reason?: unknown } | undefined;
  return {
    status: 'error',
    code: typeof details?.code === 'string' ? details.code : null,
    reason: typeof details?.reason === 'string' ? details.reason : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** 入口此刻的样子（Home、Space「新建」、编辑器素材面板共用）。 */
export function useRecordingEntry(): { entry: RecordingEntry; open(request: RecordingPanelRequest): void } {
  const runtime = useRuntime();
  const hostCapable = useRecordingCapable();
  const sources = useRecordings((s) => s.sources);
  const recordings = useRecordings((s) => s.recordings);
  const entry = recordingEntry({ platform: runtime.host.platform, hostCapable, sources, recordings });
  const open = useCallback((request: RecordingPanelRequest) => useRecordings.getState().openPanel(request), []);
  return { entry, open };
}

/** 入口置灰时的说明。 */
export function blockText(block: RecordingBlock): string {
  if (block.kind === 'remote') return RC.blockRemote;
  if (block.kind === 'busy') return RC.blockBusy;
  return unsupportedText(block.code, block.text);
}

/** 录不了的说明：认得的原因码用自己的文字，认不出时用 Runtime 给的原因，都没有时用通用的一句。 */
export function unsupportedText(code: string | null, text: string | null): string {
  if (code === 'remote') return RC.blockRemote;
  if (code === 'no-worker') return RC.unavailableNoWorker;
  if (code === 'no-window') return RC.unavailableNoWindow;
  if (code === 'unsupported' || code === 'unsupported-platform') return RC.blockUnsupported;
  return text || RC.blockUnsupported;
}

export function RecordingHost() {
  const runtime = useRuntime();
  const capable = useRecordingCapable();
  const connected = useConnection((s) => s.state.status === 'connected');
  const route = useShell((s) => s.route);
  const conversationId = route.tab === 'home' ? route.conversationId : null;
  const recordings = useRecordings((s) => s.recordings);
  const panel = useRecordings((s) => s.panel);
  const dismissed = useRecordings((s) => s.dismissed);
  const shortcuts = useRecordingPrefs((s) => s.shortcuts);
  const hideWindow = useRecordingPrefs((s) => s.hideWindow);
  const onUpdate = useOpenAfter(runtime);

  useEffect(() => {
    if (!capable || !connected) return;
    const store = useRecordings.getState();
    const stop = runtime.client.subscribeRecordings({
      snapshot: (snapshot) => {
        store.replace(snapshot.recordings);
        for (const r of snapshot.recordings) onUpdate.current(r, true);
      },
      event: (event) => {
        useRecordings.getState().apply(event);
        if (event.type === 'recording.upsert') onUpdate.current(event.recording, false);
      },
    });
    void loadSources(runtime);
    return stop;
  }, [runtime, capable, connected, onUpdate]);

  useEffect(() => {
    if (capable) runtime.host.recording?.configure({ shortcuts, hideWindow });
  }, [runtime, capable, shortcuts, hideWindow]);

  useEffect(() => {
    if (!capable || !runtime.host.recording?.onShortcutFailed) return;
    return runtime.host.recording.onShortcutFailed((failed) => {
      const names = failed.map((w) => (w === 'stop' ? RC.shortcutStop : RC.shortcutPause)).join(', ');
      ToastQueue.negative(RC.shortcutFailed(names), { timeout: 6000 });
    });
  }, [runtime, capable]);

  // 智能体发起、正等着这条会话的：自动弹出预先填好的面板。
  const waiting = capable ? autoOpenWaiting({ recordings, conversationId, dismissed, panelOpen: !!panel }) : null;
  useEffect(() => {
    if (waiting) useRecordings.getState().openPanel({ target: waiting.target, recordingId: waiting.recordingId });
  }, [waiting]);

  if (!capable || !connected) return null;
  return panel ? <RecordingPanel key={panel.recordingId ?? 'new'} request={panel} /> : null;
}

/**
 * 录完之后打开编辑器：只认这个界面看着从录制中走到「已进时间线」的（快照里早已导入完的不算），选项要求打开，
 * 落点是新视频时打开那个视频；录进当前视频的不用再开。
 */
function useOpenAfter(runtime: RuntimeSession) {
  const seen = useRef(new Map<Id, RecordingState>());
  const handler = useRef<(r: RecordingSummary, snapshot: boolean) => void>(() => {});
  handler.current = (r, snapshot) => {
    const before = snapshot ? undefined : seen.current.get(r.recordingId);
    seen.current.set(r.recordingId, r.state);
    // 看着失败的（不是智能体发起的；那些在会话的卡片上）：窗口放回来时说一声为什么，例如什么都没录下。
    if (r.state === 'failed' && before !== undefined && before !== 'failed' && !r.requestedBy) {
      ToastQueue.negative(RC.cardFailed(r.error ? localizeText(r.error.message, r.error.messageRef) : ''), { timeout: 8000 });
      return;
    }
    if (!shouldOpenAfter(before, r) || !r.result) return;
    if ('videoId' in r.target) return;
    const from = r.target.create.conversationId
      ? { conversationId: r.target.create.conversationId, projectId: null }
      : { conversationId: null, projectId: r.target.create.projectId ?? null };
    runtime.client.request('videos.target', { videoId: r.result.videoId }).then(
      ({ target }) => useShell.getState().openVideo(target, from),
      () => {},
    );
  };
  return handler;
}
