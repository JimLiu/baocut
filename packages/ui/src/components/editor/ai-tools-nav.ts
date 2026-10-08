import type { Id } from '@baocut/protocol';
import { create } from 'zustand';
import type { AiToolId } from '../../model/ai-tools.ts';
import { useEditor, type PanelTab } from '../../state/editor-store.ts';

/** 别的面板推进来时带的上下文：刷新过期译文从哪一份译文来。 */
export interface AiToolPreset {
  /** 译文的语言名（「英语」）。 */
  language?: string | null;
}

export interface AiToolPage {
  tool: AiToolId;
  preset: AiToolPreset | null;
  /** 从哪一页打开的：返回时回到那里（原型 `ctx.closeAi`）。 */
  from?: PanelTab;
}

/**
 * 打开着的那一个工具页，按视频记（不持久化）。编辑器没有「AI 工具」这一页（产品设计 §5.10）：工具从所在面板的入口打开
 * （原型 `ctx.requestAi`），盖在右侧面板上，返回时回到来的那一页。
 */
export const useAiToolsNav = create<{ pages: Record<Id, AiToolPage> }>(() => ({ pages: {} }));

export function setAiToolPage(videoId: Id, page: AiToolPage | null): void {
  useAiToolsNav.setState((s) => {
    const { [videoId]: _drop, ...rest } = s.pages;
    return { pages: page ? { ...rest, [videoId]: page } : rest };
  });
}

/** 从别的面板打开一个工具页，记下来的那一页。 */
export function openAiTool(videoId: Id, tool: AiToolId, preset: AiToolPreset | null = null): void {
  const editor = useEditor.getState();
  const from = editor.panelTab === 'aitools' ? (useAiToolsNav.getState().pages[videoId]?.from ?? 'transcript') : editor.panelTab;
  setAiToolPage(videoId, { tool, preset, from });
  editor.showPanel('aitools');
}

/** 关掉工具页：回到来的那一页（`to` 给了就去那一页）。面板收着时不自己展开。 */
export function closeAiTool(videoId: Id | null, to?: PanelTab): void {
  const from = videoId ? useAiToolsNav.getState().pages[videoId]?.from : undefined;
  if (videoId) setAiToolPage(videoId, null);
  if (useEditor.getState().panelTab === 'aitools') useEditor.setState({ panelTab: to ?? from ?? 'transcript' });
}
