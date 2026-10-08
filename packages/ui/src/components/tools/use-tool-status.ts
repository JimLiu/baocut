import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { PipelineInfo, ToolInputKind, ToolStatus } from '@baocut/protocol';
import type { ToolId } from '../../model/tool-catalog.ts';
import { toolBlock } from '../../model/tools-gallery.ts';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useModels } from '../../state/models-store.ts';
import { FORM_COPY } from './tools-copy.ts';

/**
 * 工具此刻能不能用（`tools.list`）与 Runtime 注册了哪些流程（`pipelines.list`）。目录页与各工具页共用一份，
 * 挂载时、模型能力视图变了（连上 / 断开服务商、装好模型）时重读。状态没到时不判断：提交按钮不能按，也不回退到写死的流程名。
 */

interface ToolStatusState {
  tools: ToolStatus[] | null;
  /** `tools.list` 的保存位置；没给（Web 服务）时 null。 */
  saveDirectory: string | null;
  pipelines: PipelineInfo[] | null;
  error: string | null;
}

const useToolStatusStore = create<ToolStatusState>()(() => ({ tools: null, saveDirectory: null, pipelines: null, error: null }));

/** 同一个能力视图只读一次（几个组件同时挂载时不重复请求）。 */
let loadedFor: { session: RuntimeSession; view: unknown } | null = null;

function load(session: RuntimeSession, view: unknown): void {
  if (loadedFor && loadedFor.session === session && loadedFor.view === view) return;
  loadedFor = { session, view };
  void Promise.allSettled([session.listTools(), session.listPipelines()]).then(([tools, pipelines]) => {
    if (loadedFor?.session !== session || loadedFor.view !== view) return;
    useToolStatusStore.setState({
      tools: tools.status === 'fulfilled' ? tools.value.tools : useToolStatusStore.getState().tools,
      saveDirectory: tools.status === 'fulfilled' ? (tools.value.saveDirectory ?? null) : useToolStatusStore.getState().saveDirectory,
      // 读不到流程表（例如网页会话不开放）时不按流程判断，只看 `tools.list`。
      pipelines: pipelines.status === 'fulfilled' ? pipelines.value : null,
      error: tools.status === 'rejected' ? (tools.reason instanceof Error ? tools.reason.message : String(tools.reason)) : null,
    });
  });
}

/**
 * 工具的现状变了、能力视图却没变时（例如下载工具刚装好、同意过）重读一次：清掉「读过了」的记号，下一次挂载或调用时重读。
 * 给了会话就马上重读。
 */
export function invalidateToolStatus(session?: RuntimeSession): void {
  const view = loadedFor?.view;
  loadedFor = null;
  if (session) load(session, view);
}

export interface ToolStatusView {
  /** `tools.list` 到了没有。 */
  ready: boolean;
  byId: ReadonlyMap<string, ToolStatus>;
  /**
   * 保存位置（架构设计 §7.9）：工具没有视频的结果落在这里；Web 服务不给（null）——这时工具页没有保存位置一行，直接任务也不带 `saveDir`。
   */
  saveDirectory: string | null;
  pipelines: readonly PipelineInfo[] | null;
  /** `tools.list` 读失败时的原因。 */
  error: string | null;
}

export function useToolStatus(): ToolStatusView {
  const session = useRuntime();
  const view = useModels((s) => s.capabilities);
  const tools = useToolStatusStore((s) => s.tools);
  const pipelines = useToolStatusStore((s) => s.pipelines);
  const error = useToolStatusStore((s) => s.error);
  const saveDirectory = useToolStatusStore((s) => s.saveDirectory);
  useEffect(() => load(session, view), [session, view]);
  const byId = useMemo(() => new Map((tools ?? []).map((t) => [t.id, t])), [tools]);
  return { ready: tools !== null, byId, saveDirectory, pipelines, error };
}

/**
 * 这个工具从这种输入开始时为什么按不了：`tools.list` 的第一条原因（带补救），或执行它的流程不在 `pipelines.list` 里。
 * 能用时 null；状态还没到时 undefined。
 */
export function blockOf(status: ToolStatusView, id: ToolId, input?: ToolInputKind): string | null | undefined {
  if (!status.ready) return undefined;
  const one = status.byId.get(id);
  if (!one) return FORM_COPY.notInRuntime;
  return toolBlock(one, status.pipelines, input, true);
}
