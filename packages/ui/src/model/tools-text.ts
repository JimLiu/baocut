import {
  defineMessages,
  intlLocale,
  type GenerateTextRequest,
  type JobRecord,
  type SpaceEntry,
  type TextCapabilityParameters,
  type TextJobResult,
  type TextModelInfo,
} from '@baocut/protocol';
import { EFFORT_LABEL } from './models-text.ts';
import { codePoints, modelKeyOf, type ToolModelOption } from './tools-models.ts';
import { zhHans } from './tools-text.zh-Hans.ts';
import { zhHant } from './tools-text.zh-Hant.ts';
import { ja } from './tools-text.ja.ts';
import { ko } from './tools-text.ko.ts';
import { es } from './tools-text.es.ts';
import { fr } from './tools-text.fr.ts';
import { de } from './tools-text.de.ts';
import { nl } from './tools-text.nl.ts';
import { ptBR } from './tools-text.pt-BR.ts';
import { it } from './tools-text.it.ts';
import { ru } from './tools-text.ru.ts';
import { pl } from './tools-text.pl.ts';
import { tr } from './tools-text.tr.ts';
import { vi } from './tools-text.vi.ts';

/** 文本生成工作台的文案（译文在 `tools-text.<语言>.ts`）。数字已按界面语言写好。 */
const en = {
  emptyInput: 'Enter what to generate first',
  tooLong: (max: string) => `Up to ${max} characters at a time`,
  /** 「填入示例」：填进输入框，也原样发给模型。 */
  sample: 'Write a 30-second voice-over for a city walk video. Keep the tone natural and feature the streets, cafés and dusk.',
  counter: (n: string, max: string) => `${n} / ${max} characters`,
  connectTextModel: 'Connect a text model first',
  connectFirst: (provider: string) => `Connect ${provider} first`,
  effortFixed: 'Reasoning effort · not adjustable for this model',
  effort: (label: string) => `Reasoning effort · ${label} (default set on the Models page)`,
  auto: 'Auto',
  headerChip: (provider: string) => `Online · ${provider} · billed by token`,
  /** 下载的文件名开头。 */
  fileStem: 'Generated text',
  chars: (n: string) => `${n} characters`,
  outputTokens: (n: string) => `${n} output tokens`,
  truncated: 'Reached the output limit; the rest was cut off',
};
export type ToolsTextMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

function num(n: number): string {
  return n.toLocaleString(intlLocale());
}

/**
 * 文本生成工作台（设计稿 tool-llm.jsx `LlmToolPage kind='text'`、model-llm-tools.js `request`）：
 * 一次文本模型调用，不建 Agent 会话、不调工具。只有一条 user 消息；推理强度用模型页设的默认（`models.setCapabilityParameters`）。
 * 结果是 `models.generateText` 任务的产物，Runtime 把它列成 Space 里的一份文档（runtime-core space/space-derive.ts）。
 */

export type TextOption = ToolModelOption<TextModelInfo>;

/** 一次最多输入的字符数（设计稿 model-llm-tools.js `request`：16,000）。按码点数。 */
export const MAX_TEXT_INPUT = 16_000;

/** 设计稿 model-llm-tools.js `request` 的几句原话。 */
export function emptyInput(): string {
  return M.emptyInput;
}
export function tooLong(): string {
  return M.tooLong(num(MAX_TEXT_INPUT));
}

/** 「填入示例」（设计稿 tool-llm.jsx `sample`）。 */
export function textSample(): string {
  return M.sample;
}

export interface TextDraft {
  input: string;
  /** `providerId/modelId`；null 为还没选。 */
  model: string | null;
}

export const BLANK_TEXT: TextDraft = { input: '', model: null };

// ---- 校验与请求 ----

export function textProblems(draft: Pick<TextDraft, 'input'>): string[] {
  const input = draft.input.trim();
  if (!input) return [emptyInput()];
  if (codePoints(input) > MAX_TEXT_INPUT) return [tooLong()];
  return [];
}

/** 字数那一行（设计稿 `${n} / 16,000 字符`）；超了标红。 */
export function textCounter(draft: Pick<TextDraft, 'input'>): { text: string; over: boolean } {
  const n = codePoints(draft.input.trim());
  return { text: M.counter(num(n), num(MAX_TEXT_INPUT)), over: n > MAX_TEXT_INPUT };
}

/**
 * `models.generateText` 的参数：一条 user 消息，指名服务商与模型；推理强度、输出上限都不给（用模型页的默认与模型的上限）。
 * 附了 Space 条目（`material`）时 Runtime 把它的文字接在这条消息后面（架构设计 §7.9「Space 条目作输入」）；生成要求照样要写。
 */
export function textRequest(
  draft: Pick<TextDraft, 'input'>,
  option: Pick<TextOption, 'providerId' | 'modelId'>,
  material: { entryId: string } | null = null,
): Omit<GenerateTextRequest, 'commandId'> {
  return {
    messages: [{ role: 'user', content: draft.input.trim() }],
    provider: option.providerId,
    model: option.modelId,
    ...(material ? { material: { entryId: material.entryId } } : {}),
  };
}

/** 主按钮旁那句：门、问题，或这次会用谁。 */
export function textStatus(draft: Pick<TextDraft, 'input'>, option: TextOption | null, tried: boolean): { text: string; bad: boolean } {
  if (!option) return { text: M.connectTextModel, bad: true };
  if (!option.usable) return { text: option.connected ? `${option.provider} · ${option.why}` : M.connectFirst(option.provider), bad: true };
  const empty = emptyInput();
  const problem = textProblems(draft).find((p) => tried || p !== empty);
  if (problem) return { text: problem, bad: true };
  return { text: `${option.provider} · ${option.modelId}`, bad: false };
}

// ---- 模型 ----

/**
 * 推理强度那一句：工具页不单独选，用模型页设的默认（`models.setCapabilityParameters`）；模型不能调时照实说。
 * 默认那一档这只模型没有时 Runtime 换成最接近的一档，结果里会注明。
 */
export function textEffortLine(parameters: Pick<TextCapabilityParameters, 'effort'>, info: Pick<TextModelInfo, 'efforts'>): string {
  if (!info.efforts.length) return M.effortFixed;
  return M.effort(parameters.effort ? EFFORT_LABEL[parameters.effort] : M.auto);
}

/** 页头那枚标签：走谁的服务。文本按 token 计费（设计稿 settings-cloud.jsx 的说法）。 */
export function textHeaderChip(option: Pick<TextOption, 'provider'> | null): string | null {
  return option ? M.headerChip(option.provider) : null;
}

// ---- 记录 ----

type TextGeneration = Extract<NonNullable<JobRecord['generation']>, { capability: 'generateText' }>;

function generationOf(job: Pick<JobRecord, 'generation'>): TextGeneration | null {
  return job.generation?.capability === 'generateText' ? job.generation : null;
}

/** 这条记录的生成要求：第一条 user 消息。 */
export function textPrompt(job: Pick<JobRecord, 'generation'>): string {
  return generationOf(job)?.messages.find((m) => m.role === 'user')?.content ?? '';
}

/** 完成了的结果摘要；没有时 null。 */
export function textResultOf(job: Pick<JobRecord, 'result'>): TextJobResult | null {
  return job.result?.text ?? null;
}

/** 到了输出上限被截断（Runtime 给 `output-truncated` 警告，结果照样完成）。 */
export function textTruncated(job: Pick<JobRecord, 'warnings' | 'result'>): boolean {
  return job.warnings.some((w) => w.code === 'output-truncated') || job.result?.text?.finishReason === 'length';
}

/**
 * 下载的文件名：与 Space 里那份文档同名（runtime-core space/space-derive.ts `fileNameOf`：「生成文本-20261003-101500.txt」），
 * 结构化输出是 `.json`。
 */
export function textFileName(job: Pick<JobRecord, 'endedAt' | 'createdAt' | 'result'>): string {
  const at = (job.endedAt ?? job.createdAt).replace(/\.\d+Z$/, '').replace(/Z$/, '').replace(/[-:]/g, '').replace('T', '-');
  const ext = job.result?.text?.mediaType === 'application/json' ? 'json' : 'txt';
  return `${M.fileStem}-${at}.${ext}`;
}

/** Space 里这条结果的文档（按产物 ID 找，进了废纸篓的不算）。 */
export function textSpaceEntry(entries: readonly SpaceEntry[], job: Pick<JobRecord, 'result'>): SpaceEntry | null {
  const artifactId = job.result?.artifactId;
  if (!artifactId) return null;
  return entries.find((e) => !e.user.trashedAt && e.ref && 'artifactId' in e.ref && e.ref.artifactId === artifactId) ?? null;
}

/** 结果卡的一行事实：多少字、结构化输出、用了多少 token、截断了没有。 */
export function textFacts(job: Pick<JobRecord, 'warnings' | 'result'>): string {
  const text = textResultOf(job);
  if (!text) return '';
  const usage = text.usage;
  return [
    M.chars(num(text.length)),
    text.mediaType === 'application/json' ? 'JSON' : null,
    usage && usage.outputTokens !== null ? M.outputTokens(num(usage.outputTokens)) : null,
    textTruncated(job) ? M.truncated : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 「带回左边再改一版」：这一条的要求与模型回到表单。 */
export function againTextDraft(job: JobRecord): Partial<TextDraft> | null {
  const g = generationOf(job);
  if (!g) return null;
  return { input: textPrompt(job), model: modelKeyOf(job.providerId, job.modelId) };
}

/**
 * 「再试一次」：照冻结的参数原样再提交（同一个 Provider 与模型）。推理强度交回当初请求的那一档（`requestedEffort`），
 * 不是换档后的 `effort`——换档由 Runtime 再按模型决定。
 */
export function retryTextRequest(job: JobRecord): Omit<GenerateTextRequest, 'commandId'> | null {
  const g = generationOf(job);
  if (!g) return null;
  return {
    messages: g.messages.map((m) => ({ ...m })),
    responseFormat: g.responseFormat,
    maxOutputTokens: g.maxOutputTokens,
    ...(g.temperature !== null ? { temperature: g.temperature } : {}),
    ...(g.requestedEffort !== null ? { effort: g.requestedEffort } : {}),
    ...(g.seed !== null ? { seed: g.seed } : {}),
    provider: job.providerId,
    model: job.modelId,
  };
}
