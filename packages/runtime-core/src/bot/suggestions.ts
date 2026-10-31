// i18n-ignore-file: 给模型的工具错误；词表里的中日韩词用转义写
import { BOT_LIMITS, newId, type Id, type SuggestionChip, type SuggestionChipKind, type WorkItem } from '@baocut/protocol';
import { ToolError } from '../agent-tools/tool-catalog.ts';
import { hasLinkOrNumber } from './text-rules.ts';

/*
 * 智能提示的校验（技术方案 §12.2）：不合规的整组拒绝，不截断后硬发。纯函数，工具与测试共用。
 */

export interface ChipInput {
  label: string;
  text?: string;
  kind: SuggestionChipKind;
  kindTag?: string | null;
  recommended?: boolean;
  target?: { workItemId: Id } | null;
  action?: { kind: 'resolve'; workItemId: Id } | null;
}

export interface ValidateContext {
  /** forItemId 那条消息的文字。 */
  messageText: string;
  risky: boolean;
  /** 频道记忆「不想要的提示」与 14 天忽略表里的 kindTag。 */
  unwantedKinds: ReadonlySet<string>;
  /** `action: resolve` 能指向的任务（协调者：本频道；线程：自己的任务）。 */
  resolvable: (workItemId: Id) => WorkItem | undefined;
  /** 那条消息是确认任务完成的消息（任务刚转 resolved）。 */
  confirmsDone: boolean;
}

/** 已完成的外部动作（「已发送」）。 */
const COMPLETED_ACTION =
  /\b(sent|published|paid|posted|uploaded|deleted|emailed)\b|已发送|已发布|已付款|已上传|已删除|已發送|已發佈/i;
/** 长期授权（「以后都」「总是」）。 */
const STANDING_GRANT = /\b(always|from now on|every time|forever|never ask)\b|以后都|总是|永远|每次都|以後都|總是/i;
/** 花钱、外发、发布。 */
const SPEND_OR_SEND =
  /\b(buy|pay|purchase|publish|upload|post to|send to|email|share to|order)\b|付费|付款|购买|发布|上传|发送给|分享到|發佈|付費/i;

export function questionCount(text: string): number {
  return (text.match(/[?？]/g) ?? []).length;
}

export function validateChips(chips: ChipInput[], ctx: ValidateContext): SuggestionChip[] {
  const fail = (message: string): never => {
    throw new ToolError('INVALID_SUGGESTIONS', message);
  };
  if (chips.length === 0) fail('Give at least one suggestion, or do not call suggest_replies.');
  if (chips.length > BOT_LIMITS.chips) fail(`At most ${BOT_LIMITS.chips} suggestions.`);
  const questions = questionCount(ctx.messageText);
  const nextSteps = chips.filter((c) => c.kind === 'next-step');
  if (questions > 0 && nextSteps.length) fail('The message asks a question: offer only answers to it, not next steps.');
  if (nextSteps.length > BOT_LIMITS.nextStepChips) fail(`At most ${BOT_LIMITS.nextStepChips} next steps.`);
  if (nextSteps.length && ctx.confirmsDone) fail('Do not attach next steps to the message that confirms a task is done.');
  return chips.map((chip) => {
    const text = chip.kind === 'other' ? '' : (chip.text ?? chip.label);
    if ([...chip.label].length > BOT_LIMITS.chipLabel) fail(`Label "${chip.label}" is longer than ${BOT_LIMITS.chipLabel} characters.`);
    if ([...text].length > BOT_LIMITS.chipText) fail(`Text for "${chip.label}" is longer than ${BOT_LIMITS.chipText} characters.`);
    if (chip.kind !== 'other' && !text.trim()) fail(`Suggestion "${chip.label}" has no text.`);
    if (hasLinkOrNumber(chip.label) || hasLinkOrNumber(text)) fail('Suggestions must not contain links, email addresses or long numbers.');
    if (COMPLETED_ACTION.test(text)) fail('Do not word a suggestion as an outside action already done.');
    if (STANDING_GRANT.test(text) || STANDING_GRANT.test(chip.label)) fail('Do not word a suggestion as a standing permission.');
    if (chip.kind === 'confirm' && questions !== 1) fail('A confirm suggestion needs a message with exactly one question.');
    if (chip.kind === 'next-step' && SPEND_OR_SEND.test(text)) fail('Next steps must not spend money, send things out or publish.');
    if (chip.kindTag && ctx.unwantedKinds.has(chip.kindTag)) fail(`The user does not want "${chip.kindTag}" suggestions.`);
    if (chip.action) {
      if (chip.kind !== 'confirm') fail('A resolve action only goes on a confirm suggestion.');
      const item = ctx.resolvable(chip.action.workItemId);
      if (!item || item.status !== 'active' || item.active?.state !== 'needsReview') fail('A resolve action needs a task that is waiting for review.');
    }
    return {
      id: newId('chip'),
      label: chip.label,
      text,
      kind: chip.kind,
      kindTag: chip.kindTag ?? null,
      fillOnly: chip.kind === 'starter',
      recommended: ctx.risky ? false : (chip.recommended ?? false),
      answers: null,
      target: chip.target ?? null,
      action: chip.action ?? null,
    };
  });
}

/** 提问卡的选项变成答案提示（§12.1 的 question 来源）。 */
export function questionChips(approvalId: Id, options: { label: string }[]): SuggestionChip[] {
  return options.slice(0, BOT_LIMITS.chips).map((option, index) => {
    const label = [...option.label].slice(0, BOT_LIMITS.chipLabel).join('');
    return {
      id: newId('chip'),
      label,
      text: [...option.label].slice(0, BOT_LIMITS.chipText).join(''),
      kind: 'answer' as const,
      kindTag: null,
      fillOnly: false,
      recommended: false,
      answers: { approvalId, optionIndex: index },
      target: null,
      action: null,
    };
  });
}

/** 确认类问句（「要我…吗」）：不支持工具的 Driver 的兜底提示用。 */
export function isConfirmQuestion(text: string): boolean {
  if (questionCount(text) !== 1) return false;
  return /\b(should i|shall i|do you want me to|want me to)\b|要我|需要我|要不要|可以标为完成/i.test(text);
}
