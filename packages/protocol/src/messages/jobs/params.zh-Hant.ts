import type { JobsParamsMessages } from './params.ts';

export const zhHant: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `未知的參數 ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `參數 ${p.key} ${p.problem}`,
  mustBeNonEmptyString: '必須是非空字串',
  atMostChars: (p: { max: number }) => `最多 ${p.max} 字`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `必須是 ${p.min} 到 ${p.max} 之間的整數`,
  mustBeOneOf: (p: { values: string }) => `必須是 ${p.values} 其中之一`,
  mustBeArray: '必須是陣列',
  atLeastItems: (p: { min: number }) => `至少要有 ${p.min} 項`,
  atMostItems: (p: { max: number }) => `最多 ${p.max} 項`,
  mustBeBoolean: '必須是 true 或 false',
  mustBeLanguageTag: '必須是 BCP 47 語言標籤',
  mustBeAbsolutePath: '必須是絕對路徑',
  itemsMustBeAbsolutePaths: '只能包含絕對路徑',
  onlyOneOf: (p: { other: string }) => `不能與 ${p.other} 同時指定`,
  createExcludesVideoId: '會建立新影片，不能與 videoId 同時指定',
  targetShape: '必須是 { videoId }、{ entryId } 或 { create }',
};
