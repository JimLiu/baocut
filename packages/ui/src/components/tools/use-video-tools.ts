import { useCallback, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  grantCreateParamsFor,
  newId,
  type GrantRequestItem,
  type Id,
  type LinkCookieBrowser,
  type TranscribeDestination,
} from '@baocut/protocol';
import { ToastQueue } from '@react-spectrum/s2';
import type { ToolId, ToolTargetKey, VideoToolId } from '../../model/tool-catalog.ts';
import {
  grantLoopText,
  grantAndRestart,
  grantKey,
  pendingGrantsOf,
  startTool,
  type OriginalAudio,
  type PipelineRequest,
  type RunMeta,
  type StartOutcome,
} from '../../model/tool-runs.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useSubmitFailed } from './use-tool-records.ts';
import { RUN_COPY } from './tools-copy.ts';

/**
 * 视频工具页的本机状态（不持久化）：每个工具正在看哪一次运行、这台电脑提交时记下的名字（摘要里只有 ID）、
 * 「接着做」带过去的视频，以及各页填到一半的表单（离开再回来还在）。转录用哪个语音模型存在 tools-store（持久化）。
 */

/** 来源：本机文件、Space（媒体条目或可编辑的视频）、链接。 */
export type TranscribeSource = 'file' | 'space' | 'link';
/** 来源：Space（有文稿的视频或字幕条目）、本机字幕文件。 */
export type TranslateSource = 'space' | 'file';

export interface TranscribeDraft {
  source: TranscribeSource;
  path: string | null;
  url: string;
  entryId: Id | null;
  projectId: Id | null;
  /** 不写进视频时：只生成文稿和字幕（`none`，缺省），或新建视频放进项目（`create`）。 */
  target: 'none' | 'create';
  /** 视频已有文稿时选的落点与新视频的名字（产品设计：重新转录）；只对 `entryId` 那部视频有效，换了视频回到缺省。 */
  dest: { entryId: Id; destination: TranscribeDestination; name: string } | null;
  /** 「重试转录…」带来的失败任务：这部视频还选着时显示上次失败的说明。 */
  retry: { entryId: Id; jobId: Id } | null;
}

export interface TranslateDraft {
  source: TranslateSource;
  entryId: Id | null;
  /** 选的文稿；没选时用最近的一份。 */
  documentId: Id | null;
  /** 字幕文件的本机路径。 */
  file: string | null;
  lang: string | null;
  bilingual: boolean;
  /** 文本模型（`providerId/modelId`）；没选时用生效的默认值。 */
  model: string | null;
}

export interface DubDraft {
  entryId: Id | null;
  /** 用哪份已有的译文；`new` 是先翻译一份；null 时按有没有译文取缺省。 */
  translation: Id | 'new' | null;
  lang: string | null;
  original: OriginalAudio;
  /** 配音引擎（语音合成模型，`providerId/modelId`）；没选时用生效的默认值。 */
  engine: string | null;
  /** 先翻译时用的文本模型。 */
  textModel: string | null;
}

export interface LinkDraft {
  url: string;
  /** 「网站登录」勾选的浏览器；提交时按检测到的顺序排（就是尝试的顺序），都不勾是匿名下载。 */
  cookieBrowsers: LinkCookieBrowser[];
  target: ToolTargetKey;
  entryId: Id | null;
  projectId: Id | null;
  transcribe: boolean;
}

interface Drafts {
  transcribe: TranscribeDraft;
  'translate-subtitles': TranslateDraft;
  dub: DubDraft;
  'link-import': LinkDraft;
}

export interface ToolPreset {
  tool: ToolId;
  entryId: Id;
  retryJobId?: Id;
}

interface VideoToolsState extends Drafts {
  /** 每个工具正在看的运行（父任务 ID）；null 是表单。 */
  views: Partial<Record<VideoToolId, Id | null>>;
  meta: Record<Id, RunMeta>;
  /** 「接着做」「用工具处理…」：进下一个工具时预选的 Space 条目；`retryJobId` 是「重试转录…」那条失败的任务。 */
  preset: ToolPreset | null;
  /** 「再做一次 / 重试」（Space 查看器、后台任务详情）：进工具页时照这条任务的参数填好表单。 */
  rerun: { tool: ToolId; jobId: Id } | null;
  /** 新建视频上一次放进的项目。 */
  lastProject: Id | null;
  setView(tool: VideoToolId, jobId: Id | null): void;
  remember(jobId: Id, meta: RunMeta): void;
  setPreset(preset: ToolPreset | null): void;
  setRerun(rerun: { tool: ToolId; jobId: Id } | null): void;
  setLastProject(projectId: Id): void;
  patch<K extends keyof Drafts>(tool: K, patch: Partial<Drafts[K]>): void;
}

export const useVideoTools = create<VideoToolsState>()((set) => ({
  transcribe: { source: 'file', path: null, url: '', entryId: null, projectId: null, target: 'none', dest: null, retry: null },
  'translate-subtitles': { source: 'space', entryId: null, documentId: null, file: null, lang: null, bilingual: true, model: null },
  dub: { entryId: null, translation: null, lang: null, original: 'duck', engine: null, textModel: null },
  'link-import': { url: '', cookieBrowsers: [], target: 'none', entryId: null, projectId: null, transcribe: false },
  views: {},
  meta: {},
  preset: null,
  rerun: null,
  lastProject: null,
  setView: (tool, jobId) => set((s) => ({ views: { ...s.views, [tool]: jobId } })),
  remember: (jobId, meta) => set((s) => ({ meta: { ...s.meta, [jobId]: meta } })),
  setPreset: (preset) => set({ preset }),
  setRerun: (rerun) => set({ rerun }),
  setLastProject: (projectId) => set({ lastProject: projectId }),
  patch: (tool, patch) => set((s) => ({ [tool]: { ...s[tool], ...patch } }) as Partial<VideoToolsState>),
}));

/** 新建视频放进哪个项目的缺省：上次用的还在就用它，否则第一个。 */
export function defaultProject(projects: readonly { id: Id }[], last: Id | null): Id | null {
  if (last && projects.some((p) => p.id === last)) return last;
  return projects[0]?.id ?? null;
}

interface Ask {
  /** 提交时表单的样子：表单改了，这次授权请求作废。 */
  key: string;
  request: PipelineRequest;
  commandId: string;
  items: GrantRequestItem[];
  meta: RunMeta;
  /** 这一轮（同一个 commandId）发放过的项。 */
  granted: Set<string>;
}

export interface ToolStart {
  /** 当前表单被当场授权拒绝、等用户同意的那几项；表单改了就没了。 */
  asking: GrantRequestItem[] | null;
  busy: boolean;
  start(request: PipelineRequest, meta: RunMeta, key: string): void;
  /** 同意：逐项发放，再用同一个 commandId 重提。 */
  agree(): void;
  /** 取代被改过的文稿被拒（`TRANSCRIPT_EDITED`）、等用户确认；表单改了就没了。 */
  edited: boolean;
  /** 仍要取代：带上 `acceptEdited: true` 重新提交。 */
  acceptEdited(): void;
}

/**
 * 视频工具的提交：每次开始一个新的 commandId；被当场授权拒绝时把待批准项交给页面（授权卡），用户同意后发放并用同一个
 * commandId 重提。启动成功就切到这次运行的页面。`key` 是表单的样子（不同的输入、参数），改了就作废这次授权请求。
 */
export function useToolStart(tool: VideoToolId, key: string): ToolStart {
  const session = useRuntime();
  const setView = useVideoTools((s) => s.setView);
  const remember = useVideoTools((s) => s.remember);
  const failed = useSubmitFailed('pipeline', RUN_COPY.submitFailed);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [edited, setEdited] = useState<Omit<Ask, 'items'> | null>(null);
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  const settle = useCallback(
    (outcome: StartOutcome, base: Omit<Ask, 'items'>) => {
      setEdited(null);
      if (outcome.kind === 'started') {
        setAsk(null);
        remember(outcome.jobId, base.meta);
        setView(tool, outcome.jobId);
        ToastQueue.positive(RUN_COPY.started, { timeout: 3000 });
      } else if (outcome.kind === 'grants') {
        setAsk({ ...base, items: outcome.items });
      } else if (outcome.kind === 'edited') {
        setAsk(null);
        setEdited(base);
      } else {
        setAsk(null);
        failed(outcome.error);
      }
    },
    [failed, remember, setView, tool],
  );

  const run = useCallback(
    (work: () => Promise<StartOutcome>, base: Omit<Ask, 'items'>) => {
      if (inflight.current) return;
      inflight.current = true;
      setBusy(true);
      void work()
        .then((outcome) => settle(outcome, base))
        .finally(() => {
          inflight.current = false;
          setBusy(false);
        });
    },
    [settle],
  );

  const start = useCallback(
    (request: PipelineRequest, meta: RunMeta, formKey: string) => {
      const base = { key: formKey, request, commandId: newId('cmd'), meta, granted: new Set<string>() };
      run(() => startTool(session, request, base.commandId), base);
    },
    [run, session],
  );

  const agree = useCallback(() => {
    if (!ask || ask.key !== key) return;
    const { items, ...base } = ask;
    run(() => grantAndRestart(session, base.request, base.commandId, items, base.granted), base);
  }, [ask, key, run, session]);

  const acceptEdited = useCallback(() => {
    if (!edited || edited.key !== key) return;
    const request = { ...edited.request, params: { ...edited.request.params, acceptEdited: true } };
    const base = { ...edited, request, commandId: newId('cmd'), granted: new Set<string>() };
    run(() => startTool(session, request, base.commandId), base);
  }, [edited, key, run, session]);

  return {
    asking: ask && ask.key === key ? ask.items : null,
    busy,
    start,
    agree,
    edited: edited !== null && edited.key === key,
    acceptEdited,
  };
}

export interface RunRetry {
  busy: boolean;
  /** 重试被当场授权拒绝、等用户同意的那几项。 */
  asking: GrantRequestItem[] | null;
  retry(): void;
  agree(): void;
}

/**
 * 从停下的那一步重试（`pipelines.retry`，任务 ID 不变、做完的步骤不重做）。被当场授权拒绝时交回待批准项；
 * 用户同意后逐项发放再重试，发放过还被拒时说明、不再循环。
 */
export function useRunRetry(jobId: Id): RunRetry {
  const session = useRuntime();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<GrantRequestItem[] | null>(null);
  const granted = useRef(new Set<string>());
  const attempt = useCallback(async () => {
    try {
      await session.retryPipeline(jobId);
      setAsking(null);
      ToastQueue.positive(RUN_COPY.retried, { timeout: 3000 });
    } catch (error) {
      const items = pendingGrantsOf(error);
      if (items && !items.every((item) => granted.current.has(grantKey(item)))) {
        setAsking(items);
        return;
      }
      setAsking(null);
      ToastQueue.negative(RUN_COPY.retryFailed(items ? grantLoopText() : error instanceof Error ? error.message : String(error)), { timeout: 6000 });
    }
  }, [jobId, session]);
  const guard = useCallback(
    (work: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      void work().finally(() => setBusy(false));
    },
    [busy],
  );
  const retry = useCallback(() => guard(attempt), [attempt, guard]);
  const agree = useCallback(() => {
    const items = asking;
    if (!items) return;
    guard(async () => {
      try {
        for (const item of items) {
          await session.createGrant(grantCreateParamsFor(item));
          granted.current.add(grantKey(item));
        }
      } catch (error) {
        setAsking(null);
        ToastQueue.negative(RUN_COPY.retryFailed(error instanceof Error ? error.message : String(error)), { timeout: 6000 });
        return;
      }
      await attempt();
    });
  }, [asking, attempt, guard, session]);
  return { busy, asking, retry, agree };
}
