import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './text-generation.zh-Hans.ts';
import { zhHant } from './text-generation.zh-Hant.ts';
import { ja } from './text-generation.ja.ts';
import { ko } from './text-generation.ko.ts';
import { es } from './text-generation.es.ts';
import { fr } from './text-generation.fr.ts';
import { de } from './text-generation.de.ts';
import { nl } from './text-generation.nl.ts';
import { ptBR } from './text-generation.pt-BR.ts';
import { it } from './text-generation.it.ts';
import { ru } from './text-generation.ru.ts';
import { pl } from './text-generation.pl.ts';
import { tr } from './text-generation.tr.ts';
import { vi } from './text-generation.vi.ts';

/** `packages/models/src/text-generation.ts` 给人看的文字：文本生成的参数检查、输出检查与说明。 */
const en = {
  noMessage: 'At least one non-empty user or assistant message is required',
  badRole: 'A message role must be system, user, or assistant',
  inputTooLong: (p: { chars: number; modelId: string; contextTokens: number }) => `The input has ${p.chars} characters, far beyond the ${p.contextTokens}-token context of model ${p.modelId}`,
  maxOutput: (p: { modelId: string; max: number }) => `Model ${p.modelId} outputs at most ${p.max} tokens per call`,
  noTemperature: (p: { modelId: string }) => `Model ${p.modelId} doesn't accept temperature`,
  temperatureRange: 'temperature must be between 0 and 2',
  noSeed: (p: { modelId: string }) => `Model ${p.modelId} doesn't accept seed`,
  noStructured: (p: { modelId: string }) => `Model ${p.modelId} doesn't support structured output`,
  effortIgnored: (p: { modelId: string; requested: string }) => `Model ${p.modelId} can't adjust reasoning effort; ignored ${p.requested}`,
  effortChanged: (p: { modelId: string; requested: string; applied: string }) => `Model ${p.modelId} has no ${p.requested} reasoning effort; used ${p.applied} instead`,
  contentFiltered: (p: { provider: string }) => `${p.provider}'s content filter blocked this output`,
  truncatedJson: (p: { provider: string; max: number }) => `${p.provider}'s output hit the limit (${p.max} tokens) and was cut off; the structured output is incomplete`,
  truncatedProblem: (p: { max: number }) => `Output cut off (maxOutputTokens ${p.max})`,
  notJson: (p: { provider: string }) => `${p.provider}'s output isn't valid JSON`,
  notJsonProblem: 'Not valid JSON',
  schemaMismatch: (p: { provider: string }) => `${p.provider}'s output doesn't match the given JSON Schema`,
  limitBeforeText: (p: { provider: string }) => `${p.provider} hit the output limit before writing any text`,
  emptyOutput: (p: { provider: string }) => `${p.provider} returned empty output`,
  limitBeforeTextProblem: (p: { max: number }) => `No text yet when the ${p.max}-token output limit ran out`,
  emptyProblem: 'Output is empty',
  cancelled: 'Call cancelled',
};

export type ModelsTextGenerationMessages = typeof en;

export const ModelsTextGeneration = defineCatalog('modelsTextGeneration', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
