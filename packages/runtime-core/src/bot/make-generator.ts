// i18n-ignore-file: prompt text for the text model (English)
import type { TextGenerator } from '@baocut/models';
import type { MakeCandidate, MakeGenerator, MakeInput } from './bot-service.ts';

/*
 * Make 的文本能力（技术方案 §11.3 第 3 步）：把收集好的事实交给文本模型，要它回结构化的候选。模型只看得到事实的编号与一行描述，
 * 依据只能引用编号；之后的过滤（白名单、去重、忽略表、限额、事实核对）都在 BotService 里做，模型说什么都过一遍。
 */

const SYSTEM = [
  'You suggest a few small, useful next tasks for a video editing workspace.',
  'Only suggest local work that can be undone: cutting, captions, transcripts, translations drafts, chapters, highlights, tidying.',
  'Never suggest publishing, uploading, sending, buying or anything that leaves the computer.',
  'Each suggestion must rest on the numbered facts you were given; cite them by number in evidence.',
  'Do not suggest things already in the open or recently finished tasks.',
  'Write titles and reasons in the language given, plain, without links or numbers longer than ten digits.',
  'Return at most three suggestions. Return an empty list when nothing is clearly worth doing.',
].join('\n');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'reason', 'kindTag', 'evidence'],
        properties: {
          title: { type: 'string', maxLength: 140 },
          reason: { type: 'string', maxLength: 280 },
          kindTag: { type: 'string', maxLength: 40 },
          evidence: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: 5 },
        },
      },
    },
  },
} as const;

export function makePrompt(input: MakeInput): string {
  const list = (label: string, rows: readonly string[]) => [`${label}:`, ...(rows.length ? rows.map((r) => `- ${r}`) : ['- (none)'])].join('\n');
  return [
    `Channel: ${input.channelName}`,
    `Purpose: ${input.purpose || '(none)'}`,
    `Language for titles and reasons: ${input.language ?? 'the language of the user messages'}`,
    list('Channel memory', input.memory.trim() ? input.memory.trim().split('\n').slice(0, 60) : []),
    list('Open tasks', input.openTasks),
    list('Recently finished', input.recentlyResolved),
    list('Recent user messages', input.userMessages.slice(-15)),
    list(
      'Facts (cite by number)',
      input.facts.map((f) => `[${f.index}] ${f.line}`),
    ),
    'kindTag is one short lowercase word or phrase for the kind of work, for example "captions", "chapters", "highlights", "translate-draft", "tidy".',
  ].join('\n\n');
}

export function textMakeGenerator(text: () => TextGenerator): MakeGenerator {
  return {
    async suggest(input: MakeInput): Promise<MakeCandidate[]> {
      const result = await text().generate({
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: makePrompt(input) },
        ],
        responseFormat: { type: 'json', schema: SCHEMA as unknown as Record<string, unknown>, name: 'suggestions' },
        maxOutputTokens: 1200,
      });
      const value = (result.json ?? JSON.parse(result.text)) as { suggestions?: unknown };
      if (!Array.isArray(value.suggestions)) return [];
      return value.suggestions
        .filter((s): s is MakeCandidate => !!s && typeof s === 'object' && typeof (s as MakeCandidate).title === 'string')
        .map((s) => ({
          title: String(s.title),
          reason: String(s.reason ?? ''),
          kindTag: String(s.kindTag ?? ''),
          evidence: Array.isArray(s.evidence) ? s.evidence.filter((n) => Number.isInteger(n) && n >= 0 && n < input.facts.length) : [],
        }));
    },
  };
}
