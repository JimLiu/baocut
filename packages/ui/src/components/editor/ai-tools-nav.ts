import type { Id } from '@baocut/protocol';
import { create } from 'zustand';
import type { AiToolId } from '../../model/ai-tools.ts';
import { useEditor, type PanelTab } from '../../state/editor-store.ts';

/** 别的面板推进来时带的上下文：刷新过期译文从哪一份译文来、翻译配音配哪种语言。 */
export interface AiToolPreset {
  /** 译文的语言名（「英语」）。 */
  language?: string | null;
}

export interface AiToolPage {
  tool: AiToolId;
  preset: AiToolPreset | null;
}

/**
 * AI 工具 Tab 上打开着的那一个工具页，按视频记（不持久化）；没有时 Tab 显示列表页（产品设计 §5.10）。
 * 列表页点一行、或别的面板带着范围的入口（原型 `ctx.requestAi`）都打开它；工具页的「返回」回列表。
 */
export const useAiToolsNav = create<{ pages: Record<Id, AiToolPage> }>(() => ({ pages: {} }));

export function setAiToolPage(videoId: Id, page: AiToolPage | null): void {
  useAiToolsNav.setState((s) => {
    const { [videoId]: _drop, ...rest } = s.pages;
    return { pages: page ? { ...rest, [videoId]: page } : rest };
  });
}

/** 打开一个工具页：切到 AI 工具 Tab（面板收着时展开），带上入口给的上下文。 */
export function openAiTool(videoId: Id, tool: AiToolId, preset: AiToolPreset | null = null): void {
  setAiToolPage(videoId, { tool, preset });
  useEditor.getState().showPanel('aitools');
}

/** 关掉工具页、回到列表；`to` 给了就同时翻到那一页（翻译开跑后去字幕页看进度）。面板收着时不自己展开。 */
export function closeAiTool(videoId: Id | null, to?: PanelTab): void {
  if (videoId) setAiToolPage(videoId, null);
  if (to && useEditor.getState().panelTab === 'aitools') useEditor.setState({ panelTab: to });
}

/** 留在原地的工具页（`agentStaysOnPage`）交出去的那一次：发到哪条会话、哪个任务（排了队的还没有）、什么时候交的。 */
export interface AiToolAgentRun {
  conversationId: Id;
  taskId: Id | null;
  handedAt: string;
}

/**
 * 找可剪的口与刷新过期译文交给 Agent 后，按「视频 · 工具」（`toolDraftKey`）记着那一次，不持久化：有就在工具页原地画进度卡
 * （原型 panel-aitools.jsx `phase === 'agent'`），回列表再进来还在；「重新设置」「完成」清掉，会话不受影响。
 */
export const useAiToolAgentRuns = create<{ runs: Record<string, AiToolAgentRun> }>(() => ({ runs: {} }));

export function setAiToolAgentRun(key: string, run: AiToolAgentRun | null): void {
  useAiToolAgentRuns.setState((s) => {
    const { [key]: _drop, ...rest } = s.runs;
    return { runs: run ? { ...rest, [key]: run } : rest };
  });
}
