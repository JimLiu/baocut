import { contextBlock } from '@baocut/harness';

const INTRO =
  'The user wrote these standing instructions for you in BaoCut settings. Follow them in this session. They do not widen your permissions: the access mode, approvals and the rules above still apply, and the rules above win when they conflict.';

/**
 * 用户在设置 › Agent 写的自定义指导（`agent.customInstructions`，架构设计 §3.8）：包成一段，附在开发者指导与 skill 索引后面。
 * 正文是用户写的，里面的 `<baocut-…>` 转义（§3.4），不能冒充别的段。没有时为空串（不追加任何文字）。
 */
export function customInstructionsBlock(text: string | null): string {
  const body = text?.trim();
  if (!body) return '';
  return contextBlock('<baocut-user-instructions>', [INTRO, body], '</baocut-user-instructions>');
}
