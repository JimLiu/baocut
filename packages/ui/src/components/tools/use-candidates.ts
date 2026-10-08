import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { TOOL_CANDIDATES_MAX_LIMIT, type Id, type ToolCandidate, type ToolCandidatesResult } from '@baocut/protocol';
import type { VideoToolId } from '../../model/tool-catalog.ts';
import { documentsByEntry, pickerRows, type PickerRow } from '../../model/tool-targets.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { useSpace } from '../../state/space-store.ts';

/*
 * 视频工具的候选视频（产品设计 §2.7「选已有的，不要求先打开」）：读 `tools.candidates`（Space 目录与内容索引，不打开视频），
 * 几个页面之间共用，Space 目录变了、又有任务做完时重读。筛选、排序与置灰原因在 model/tool-targets.ts。
 */

export const PAGE = 100;

export interface CandidatePage {
  list: ToolCandidate[];
  nextCursor: string | null;
  total: number;
  complete: boolean;
  pendingVideos: number;
  scanning: boolean;
}

interface CandidateState {
  pages: Partial<Record<string, CandidatePage>>;
  errors: Partial<Record<string, string>>;
}

/** 每个工具的候选（几个页面之间共用，回到同一页不闪）。转录另读一份有文稿规则的候选（`docs:` 前缀）补标注。 */
const useCandidateStore = create<CandidateState>()(() => ({ pages: {}, errors: {} }));

function pageOf(result: ToolCandidatesResult, list: ToolCandidate[]): CandidatePage {
  return {
    list,
    nextCursor: result.nextCursor,
    total: result.total,
    complete: result.complete,
    pendingVideos: result.pendingVideos,
    scanning: result.scanning,
  };
}

/** 重读第一页（已经多列过的照样多列，最多 `TOOL_CANDIDATES_MAX_LIMIT`）。 */
function reload(session: RuntimeSession, key: string, toolId: string, limit: number): void {
  session.toolCandidates({ toolId, limit: Math.min(TOOL_CANDIDATES_MAX_LIMIT, Math.max(PAGE, limit)) }).then(
    (result) =>
      useCandidateStore.setState((s) => ({ pages: { ...s.pages, [key]: pageOf(result, result.candidates) }, errors: { ...s.errors, [key]: undefined } })),
    (e: Error) => useCandidateStore.setState((s) => ({ errors: { ...s.errors, [key]: e.message } })),
  );
}

export interface Candidates {
  /** 第一次还没读到。 */
  loading: boolean;
  error: string | null;
  page: CandidatePage | null;
  /** 不带搜索词的全部行（页面用它找选中的那一行、算预选）。 */
  rows: PickerRow[];
  /** 带搜索词的行。 */
  rowsFor(query: string): PickerRow[];
  more(): void;
}

/**
 * 某个视频工具的候选：挂载时读，Space 目录变了、又有任务做完了（文稿可能多了一份）时稍等一下重读。
 * 「正在转录 / 在队列里 / 上次失败」从 `jobs` 推。
 */
export function useCandidates(tool: VideoToolId): Candidates {
  const session = useRuntime();
  const page = useCandidateStore((s) => s.pages[tool] ?? null);
  const docs = useCandidateStore((s) => (tool === 'transcribe' ? (s.pages[`docs:${tool}`] ?? null) : null));
  const error = useCandidateStore((s) => s.errors[tool] ?? null);
  const entries = useSpace((s) => s.entries);
  const jobs = useJobs((s) => s.jobs);
  const finished = useMemo(() => jobs.filter((j) => j.state === 'completed').length, [jobs]);
  const shown = page?.list.length ?? 0;

  useEffect(() => {
    const timer = setTimeout(
      () => {
        reload(session, tool, tool, shown);
        // `videos` 规则不列文稿：用翻译字幕（有文稿的视频）的候选补上标注与「不覆盖」提示。
        if (tool === 'transcribe') reload(session, `docs:${tool}`, 'translate-subtitles', TOOL_CANDIDATES_MAX_LIMIT);
      },
      useCandidateStore.getState().pages[tool] ? 400 : 0,
    );
    return () => clearTimeout(timer);
    // `shown` 只决定重读几条，不触发重读。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, tool, entries, finished]);

  const extra = useMemo(() => (docs ? documentsByEntry(docs.list) : undefined), [docs]);
  const list = page?.list;
  const rows = useMemo(() => pickerRows(tool, list ?? [], jobs, '', extra), [tool, list, jobs, extra]);
  const rowsFor = (query: string) => (query.trim() ? pickerRows(tool, list ?? [], jobs, query, extra) : rows);
  const more = () => {
    const cursor = page?.nextCursor;
    if (!cursor) return;
    session.toolCandidates({ toolId: tool, cursor, limit: PAGE }).then(
      (result) =>
        useCandidateStore.setState((s) => {
          const prev = s.pages[tool]?.list ?? [];
          const seen = new Set(prev.map((c) => c.entryId));
          return { pages: { ...s.pages, [tool]: pageOf(result, [...prev, ...result.candidates.filter((c) => !seen.has(c.entryId))]) } };
        }),
      (e: Error) => useCandidateStore.setState((s) => ({ errors: { ...s.errors, [tool]: e.message } })),
    );
  };
  return { loading: !page && !error, error, page, rows, rowsFor, more };
}

/**
 * Space 视频条目菜单的「转录… / 重新转录…」（产品设计 §4.4）：这部视频有没有文稿。读有文稿规则的候选（与转录工具页共用
 * `docs:transcribe`），Space 目录变了、又有任务做完时重读。读不出时 null：还没读到、没建索引，或列表不全而条目不在里面。
 */
export function useTranscribedEntries(): (entryId: Id) => boolean | null {
  const session = useRuntime();
  const key = 'docs:transcribe';
  const docs = useCandidateStore((s) => s.pages[key] ?? null);
  const entries = useSpace((s) => s.entries);
  const finished = useJobs((s) => s.jobs.filter((j) => j.state === 'completed').length);
  useEffect(() => {
    const timer = setTimeout(
      () => reload(session, key, 'translate-subtitles', TOOL_CANDIDATES_MAX_LIMIT),
      useCandidateStore.getState().pages[key] ? 400 : 0,
    );
    return () => clearTimeout(timer);
  }, [session, entries, finished]);
  return useMemo(() => {
    if (!docs) return () => null;
    const byEntry = new Map(docs.list.map((c) => [c.entryId, c]));
    const whole = docs.complete && !docs.nextCursor;
    return (entryId: Id) => {
      const c = byEntry.get(entryId);
      if (c) return c.indexed || c.documents.length ? c.documents.length > 0 : null;
      return whole ? false : null;
    };
  }, [docs]);
}
