import { useCallback, useEffect, useRef } from 'react';
import { localizeText, type Id, type RecordingState, type RecordingSummary } from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import type { RecordingSessionRequest, RecordingShortcutKey } from '../../host.ts';
import { autoOpenWaiting, recordingEntry, shouldOpenAfter, type RecordingBlock, type RecordingEntry, type SourcesState } from '../../model/recording.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useDirectory } from '../../state/directory-store.ts';
import { useRecordingPrefs, useRecordings } from '../../state/recordings-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useHomeProjectId } from '../start/use-home-project.ts';
import { RC } from './recording-copy.ts';

/*
 * 屏幕录制在应用窗口里的根（屏幕录制设计 §11）：挂在外壳上，是应用窗口里 `recordings` 主题唯一的订阅者。
 * - 连上之后问一次能录什么（`recordings.sources`），入口据此显示或置灰。
 * - 入口（Home、Space「新建」、编辑器素材面板、工具总览）打开主进程的录制启动器，带上落点与落点那一行的字。
 * - 智能体在这条会话里发起的录制停在 `waiting`：正看着这条会话时自动打开预先填好的启动器（关掉就是 `recordings.cancel`）。
 * - 看着一次录制走到「已进时间线」、选项要求打开时，打开编辑器到那个视频（录进当前视频的，编辑器本来就开着）。
 * - 把设置 › 通用 › 屏幕录制的几项与 Home 此刻的落点交给宿主（菜单栏、全局快捷键打开启动器时用）。
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

/** 入口要打开的落点：Home 的项目（null 时开始时新建）、某个项目里的新视频、加进某个视频，或智能体发起的那次。 */
export interface RecordingOpen {
  target: { home: { projectId: Id | null } } | { create: { projectId?: Id; conversationId?: Id } } | { videoId: Id; at?: number };
  recordingId?: Id;
}

/** 启动器要的请求：落点那一行的字按此刻的项目名写好（启动器在另一扇窗里，看不到目录）。 */
export function sessionRequest(open: RecordingOpen): RecordingSessionRequest {
  const projects = useDirectory.getState().projects;
  const projectName = (id: Id | null | undefined) => (id ? (projects.find((p) => p.id === id)?.name ?? '') : '');
  const t = open.target;
  if (open.recordingId) {
    const r = useRecordings.getState().recordings.find((x) => x.recordingId === open.recordingId);
    const conversation = r?.requestedBy ? useDirectory.getState().conversations.find((c) => c.id === r.requestedBy!.conversationId) : undefined;
    const target = 'home' in t ? { create: t.home.projectId ? { projectId: t.home.projectId } : {} } : t;
    return { target, recordingId: open.recordingId, landing: conversation?.title ? { kind: 'agent', text: RC.landingAgent, note: conversation.title } : { kind: 'agent', text: RC.landingAgent } };
  }
  if ('videoId' in t) return { target: t, landing: { kind: 'into', text: RC.landingInto } };
  if ('home' in t) {
    const name = projectName(t.home.projectId);
    return { target: { home: { projectId: t.home.projectId, name: RC.defaultProject } }, landing: { kind: 'new', text: RC.landingNew(name || RC.defaultProject) } };
  }
  return { target: t, landing: { kind: 'new', text: RC.landingNew(projectName(t.create.projectId)) } };
}

/** 入口此刻的样子（Home、Space「新建」、编辑器素材面板、工具总览共用）。 */
export function useRecordingEntry(): { entry: RecordingEntry; open(request: RecordingOpen): void } {
  const runtime = useRuntime();
  const hostCapable = useRecordingCapable();
  const sources = useRecordings((s) => s.sources);
  const recordings = useRecordings((s) => s.recordings);
  const entry = recordingEntry({ platform: runtime.host.platform, hostCapable, sources, recordings });
  const open = useCallback((request: RecordingOpen) => runtime.host.recording?.open(sessionRequest(request)), [runtime]);
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

const SHORTCUT_NAME: Record<RecordingShortcutKey, () => string> = {
  launcher: () => RC.shortcutLauncher,
  display: () => RC.shortcutDisplay,
  window: () => RC.shortcutWindow,
  area: () => RC.shortcutArea,
  stop: () => RC.shortcutStop,
  pause: () => RC.shortcutPause,
  restart: () => RC.shortcutRestart,
};

export function RecordingHost() {
  const runtime = useRuntime();
  const capable = useRecordingCapable();
  const connected = useConnection((s) => s.state.status === 'connected');
  const route = useShell((s) => s.route);
  const conversationId = route.tab === 'home' ? route.conversationId : null;
  const recordings = useRecordings((s) => s.recordings);
  const sessionOpen = useRecordings((s) => s.sessionOpen);
  const dismissed = useRecordings((s) => s.dismissed);
  const shortcuts = useRecordingPrefs((s) => s.shortcuts);
  const mainWindow = useRecordingPrefs((s) => s.mainWindow);
  const afterDiscard = useRecordingPrefs((s) => s.afterDiscard);
  const trayIcon = useRecordingPrefs((s) => s.trayIcon);
  const { entry } = useRecordingEntry();
  const homeProjectId = useHomeProjectId(route.tab === 'home' || route.tab === 'space' ? (route.projectId ?? null) : null);
  const homeName = useDirectory((s) => (homeProjectId ? (s.projects.find((p) => p.id === homeProjectId)?.name ?? '') : ''));
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

  // 菜单栏与快捷键打开启动器时的落点：Home 此刻用的项目；入口置灰（远程、不支持、正在录）时交 null。
  const homeReady = entry.kind === 'ready';
  useEffect(() => {
    if (!capable) return;
    const home = homeReady ? sessionRequest({ target: { home: { projectId: homeProjectId } } }) : null;
    runtime.host.recording?.configure({ shortcuts, mainWindow, afterDiscard, trayIcon, home });
  }, [runtime, capable, shortcuts, mainWindow, afterDiscard, trayIcon, homeReady, homeProjectId, homeName]);

  useEffect(() => {
    if (!capable || !runtime.host.recording?.onShortcutFailed) return;
    return runtime.host.recording.onShortcutFailed((failed) => {
      const names = failed.map((key) => SHORTCUT_NAME[key]()).join(', ');
      ToastQueue.negative(RC.shortcutFailed(names), { timeout: 6000 });
    });
  }, [runtime, capable]);

  // 启动器开着、关了：智能体那次被关掉就是取消了，这次启动里不再自动打开它。
  useEffect(() => {
    if (!capable || !runtime.host.recording?.onSession) return;
    return runtime.host.recording.onSession((event) => {
      const store = useRecordings.getState();
      if (event.type === 'opened') return void store.setSessionOpen(true);
      store.setSessionOpen(false);
      if (event.recordingId && event.outcome !== 'started') store.dismiss(event.recordingId);
      if (event.recordingId && event.outcome === 'cancelled') ToastQueue.neutral(RC.cancelled, { timeout: 4000 });
    });
  }, [runtime, capable]);

  // 启动器的齿轮：主进程已把窗口带到前台。
  useEffect(() => {
    if (!capable || !runtime.host.recording?.onOpenSettings) return;
    return runtime.host.recording.onOpenSettings(() => useShell.getState().go({ tab: 'settings', section: 'general' }));
  }, [runtime, capable]);

  // 智能体发起、正等着这条会话的：自动打开预先填好的启动器。
  const waiting = capable ? autoOpenWaiting({ recordings, conversationId, dismissed, sessionOpen }) : null;
  useEffect(() => {
    if (!waiting) return;
    // 已经开着时主进程只把它带到前面。
    runtime.host.recording?.open(sessionRequest({ target: waiting.target, recordingId: waiting.recordingId }));
  }, [runtime, waiting]);

  return null;
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
