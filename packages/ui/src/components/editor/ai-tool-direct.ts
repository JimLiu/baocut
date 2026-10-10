import { AI_TOOL_APPLY_KINDS, AI_TOOL_KINDS, type AiToolKind, type AiToolParams, type Id } from '@baocut/protocol';
import type { AgentToolId } from '../../model/ai-tools.ts';
import { S } from '../shell-copy.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';

/**
 * 工具页「用 › 直接调模型」的纯逻辑（产品设计 §5.10，原型 model-ai-prompt.js `contextPack` / `contextLine` / `hint`）：
 * 哪些工具能直接调模型、做不了的写什么原因，发给模型的上下文那一行、主按钮的字与它下面那行去向。
 * 运行走 Runtime 的 `ai-tool` 流程（`AI_TOOL_PIPELINE`），这里只折参数。
 */

/** 能直接调模型时是哪一种；做不了（只能交给 Agent）时 null。 */
export function directTool(tool: AgentToolId): AiToolKind | null {
  return (AI_TOOL_KINDS as readonly string[]).includes(tool) ? (tool as AiToolKind) : null;
}

/** 「直接调模型」置灰时那一行原因；能直接调模型时 null。 */
export function directBlocked(tool: AgentToolId): string | null {
  if (directTool(tool)) return null;
  switch (tool) {
    case 'retranscribe':
      return C.whyRetranscribe;
    case 'cleanup':
      return C.whyCleanup;
    case 'stale':
      return C.whyStale;
    case 'cover':
      return C.whyCover;
    default:
      return C.whoModelSub;
  }
}

/** 完成即写进视频（一笔可撤销的事务）；其余只给结果。 */
export function directApplies(tool: AiToolKind): boolean {
  return AI_TOOL_APPLY_KINDS.includes(tool);
}

/** 要模型按 JSON Schema 回（润色、章节）：不支持结构化输出的模型不能用。 */
export function needsStructuredOutput(tool: AiToolKind): boolean {
  return tool === 'polish' || tool === 'chapters';
}

/** 章节总是整篇（模型要看全片才分得出章），不接受范围。 */
export function directHasScope(tool: AiToolKind): boolean {
  return tool !== 'chapters';
}

/** 主按钮写这个工具自己的动作。 */
export function directCta(tool: AiToolKind): string {
  switch (tool) {
    case 'polish':
      return C.ctaPolish;
    case 'chapters':
      return C.ctaChapters;
    case 'summary':
      return C.ctaSummary;
    case 'blog':
      return C.ctaBlog;
    case 'title':
      return C.ctaTitle;
    case 'desc':
      return C.ctaDesc;
  }
}

export interface DirectContext {
  tool: AiToolKind;
  /** 范围里的段数（口径同文稿面板）；没有文稿时 0。 */
  paragraphs: number;
  /** 选了某一章时那一章的名字；整篇时 null。 */
  scope: string | null;
  /** 时间线上的章节数（随文稿一起给模型；润色只给词，不带章节）。 */
  chapters: number;
  attachments: number;
  /** 挂着的 skill 的名字，按挂上的顺序。 */
  skills: readonly string[];
}

/** 发给模型的上下文，一项一句（原型 `contextPack`）。 */
export function contextItems(c: DirectContext): string[] {
  const items: string[] = [];
  if (c.paragraphs > 0) items.push(C.contextTranscript(c.paragraphs, c.scope));
  if (c.tool !== 'polish' && c.paragraphs > 0 && c.chapters > 0) items.push(C.contextChapters(c.chapters));
  if (c.attachments > 0) items.push(C.contextAttachments(c.attachments));
  // 并列的名字按产品自己的列举写法（中文「A、B」），不是句子里的「和」。
  if (c.skills.length) items.push(C.contextSkills(S.list(c.skills)));
  return items;
}

/** 「发给模型的：提示词 + …」；什么都不带时只有提示词（原型 `contextLine`）。 */
export function contextLine(items: readonly string[]): string {
  return items.length ? C.contextLine(items.join(' · ')) : C.contextNone;
}

/** 主按钮下那行：直接调哪只模型、结果去哪、花不花钱（原型 `hint`）。 */
export function directHint(o: { tool: AiToolKind; model: string | null; local: boolean }): string {
  return C.modelHint(o.model, directApplies(o.tool), o.local);
}

/** 范围里的段数：段里有词落在范围内（时间线上的秒）就算；整段剪掉的不算。 */
export function scopedParagraphs(
  paragraphs: readonly { words: readonly { placements: readonly { start: number; end: number }[] }[] }[],
  range: { start: number; end: number } | null,
): number {
  return paragraphs.filter((p) =>
    p.words.some((w) => w.placements.some((at) => (range ? at.end > range.start && at.start < range.end : true))),
  ).length;
}

/** `pipelines.start('ai-tool', …)` 的参数（`AiToolParams`）。 */
export function directParams(o: {
  videoId: Id;
  tool: AiToolKind;
  prompt: string;
  range: { start: number; end: number } | null;
  documentId: Id | null;
  attachments: readonly Id[];
  skills: readonly string[];
  model: { providerId: string; modelId: string } | null;
}): AiToolParams {
  return {
    videoId: o.videoId,
    tool: o.tool,
    prompt: o.prompt,
    ...(o.range && directHasScope(o.tool) ? { range: { start: o.range.start, end: o.range.end } } : {}),
    ...(o.documentId ? { documentId: o.documentId } : {}),
    ...(o.attachments.length ? { attachments: [...o.attachments] } : {}),
    ...(o.skills.length ? { skills: o.skills.map((id) => ({ id })) } : {}),
    ...(o.model ? { provider: o.model.providerId, model: o.model.modelId } : {}),
  };
}
