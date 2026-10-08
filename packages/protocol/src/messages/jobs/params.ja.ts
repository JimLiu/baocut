import type { JobsParamsMessages } from './params.ts';

export const ja: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `不明なパラメータ：${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `パラメータ ${p.key} ${p.problem}`,
  mustBeNonEmptyString: 'は空でない文字列である必要があります',
  atMostChars: (p: { max: number }) => `は ${p.max} 文字以内である必要があります`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `は ${p.min} から ${p.max} までの整数である必要があります`,
  mustBeOneOf: (p: { values: string }) => `は ${p.values} のいずれかである必要があります`,
  mustBeArray: 'は配列である必要があります',
  atLeastItems: (p: { min: number }) => `には少なくとも ${p.min} 個の項目が必要です`,
  atMostItems: (p: { max: number }) => `の項目は ${p.max} 個までです`,
  mustBeBoolean: 'は true または false である必要があります',
  mustBeLanguageTag: 'は BCP 47 言語タグである必要があります',
  mustBeAbsolutePath: 'は絶対パスである必要があります',
  itemsMustBeAbsolutePaths: 'の項目はすべて絶対パスである必要があります',
  onlyOneOf: (p: { other: string }) => `は ${p.other} と同時に指定できません`,
  createExcludesVideoId: 'は新しい動画を作成するため、videoId と同時に指定できません',
  targetShape: 'は { videoId }、{ entryId }、{ create } のいずれかである必要があります',
};
