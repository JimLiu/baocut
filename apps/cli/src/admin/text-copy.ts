import { TEXT_EFFORTS, defineMessages } from '@baocut/protocol';
import { zhHans } from './text-copy.zh-Hans.ts';
import { zhHant } from './text-copy.zh-Hant.ts';
import { ja } from './text-copy.ja.ts';
import { ko } from './text-copy.ko.ts';
import { es } from './text-copy.es.ts';
import { fr } from './text-copy.fr.ts';
import { de } from './text-copy.de.ts';
import { nl } from './text-copy.nl.ts';
import { ptBR } from './text-copy.pt-BR.ts';
import { it } from './text-copy.it.ts';
import { ru } from './text-copy.ru.ts';
import { pl } from './text-copy.pl.ts';
import { tr } from './text-copy.tr.ts';
import { vi } from './text-copy.vi.ts';

type TokenUsage = { input: number | string; output: number | string } | null;

/** `baocut text` 的文案（英文是键与类型的来源，译文在 `text-copy.<语言>.ts`）。 */
const en = {
  /** `baocut text --help` 与 `baocut help text` 的正文。 */
  help: `Usage:
  baocut text <prompt> [options]   Call a text model once; a prompt of - is read from stdin. The full text goes
                                   to stdout (with --out it goes to the file, and stdout gets the task and
                                   output as JSON); task progress, warnings, and the model version go to stderr
    --system <text>                System message
    --json-schema <file>           Structured output: returned and validated against this JSON Schema (its
                                   root is an object); on a mismatch the task fails with MODEL_OUTPUT_INVALID
    --provider <id>                A catalog provider such as openai, google, or anthropic, or custom:<name>;
                                   the default if omitted (this capability has no built-in default)
    --model <id>                   Model; the provider's default model if omitted
    --max-output-tokens <n>        Output limit; the model's limit if omitted. Truncated plain
                                   text is still printed, with an output-truncated warning
    --effort <${TEXT_EFFORTS.join('|')}>
                                   Reasoning effort; the closest level if the model lacks this
                                   one, ignored if the model can't adjust it (explained on stderr)
    --temperature <0–2>            Only for models that accept it
    --seed <n>                     Only for models that accept it
    --out <file>                   Write the full text to this file`,
  stdinPromptHint: 'Type the prompt, then press Ctrl-D to finish:',
  missingPrompt: 'Missing prompt',
  jsonSchemaUnreadable: (file: string, reason: string) => `Can't read JSON Schema ${file}: ${reason}`,
  jsonSchemaNotObject: 'The --json-schema file must contain a JSON object',
  singleModel: 'text accepts only one --model',
  maxOutputTokensInvalid: '--max-output-tokens must be a positive integer',
  effortChoices: (efforts: readonly string[]) => `--effort must be one of ${efforts.join(', ')}`,
  temperatureRange: '--temperature must be between 0 and 2',
  seedInvalid: '--seed must be an integer',
  noTextResult: 'The task finished but returned no text',
  fetchOutputFailed: (artifactId: string, status: number) => `Couldn't fetch output ${artifactId}: HTTP ${status}`,
  written: (file: string) => `Wrote ${file}`,
  /** stderr 上的模型与用量。 */
  modelLine: (provider: string, model: string, usage: TokenUsage) =>
    `${provider} / ${model}${usage ? `, input ${usage.input} / output ${usage.output} tokens` : ''}`,
};

export type TextMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
