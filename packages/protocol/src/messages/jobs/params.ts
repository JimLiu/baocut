import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './params.zh-Hans.ts';
import { zhHant } from './params.zh-Hant.ts';
import { ja } from './params.ja.ts';
import { ko } from './params.ko.ts';
import { es } from './params.es.ts';
import { fr } from './params.fr.ts';
import { de } from './params.de.ts';
import { nl } from './params.nl.ts';
import { ptBR } from './params.pt-BR.ts';
import { it } from './params.it.ts';
import { ru } from './params.ru.ts';
import { pl } from './params.pl.ts';
import { tr } from './params.tr.ts';
import { vi } from './params.vi.ts';

/** `packages/jobs/src/pipelines/params.ts` 等流程参数校验的文字：`invalid(key, JobsParams.x())` 拼成「参数 key 问题」。 */
const en = {
  unknownParam: (p: { key: string }) => `Unknown parameter ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `Parameter ${p.key} ${p.problem}`,
  mustBeNonEmptyString: 'must be a non-empty string',
  atMostChars: (p: { max: number }) => `must be at most ${p.max} characters`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `must be an integer from ${p.min} to ${p.max}`,
  mustBeOneOf: (p: { values: string }) => `must be one of ${p.values}`,
  mustBeArray: 'must be an array',
  atLeastItems: (p: { min: number }) => `must have at least ${p.min} ${p.min === 1 ? 'item' : 'items'}`,
  atMostItems: (p: { max: number }) => `must have at most ${p.max} ${p.max === 1 ? 'item' : 'items'}`,
  mustBeBoolean: 'must be true or false',
  mustBeLanguageTag: 'must be a BCP 47 language tag',
  mustBeAbsolutePath: 'must be an absolute path',
  itemsMustBeAbsolutePaths: 'must contain only absolute paths',
  onlyOneOf: (p: { other: string }) => `can't be combined with ${p.other}`,
  createExcludesVideoId: "creates a new video and can't be combined with videoId",
  targetShape: 'must be { videoId }, { entryId }, or { create }',
};

export type JobsParamsMessages = typeof en;

export const JobsParams = defineCatalog('jobsParams', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
