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
