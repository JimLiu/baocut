import type { JobsParamsMessages } from './params.ts';

export const ko: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `알 수 없는 매개변수 ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `매개변수 ${p.key}: ${p.problem}`,
  mustBeNonEmptyString: '비어 있지 않은 문자열이어야 합니다',
  atMostChars: (p: { max: number }) => `${p.max}자 이하여야 합니다`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `${p.min}~${p.max} 사이의 정수여야 합니다`,
  mustBeOneOf: (p: { values: string }) => `다음 중 하나여야 합니다: ${p.values}`,
  mustBeArray: '배열이어야 합니다',
  atLeastItems: (p: { min: number }) => `항목이 ${p.min}개 이상이어야 합니다`,
  atMostItems: (p: { max: number }) => `항목이 ${p.max}개 이하여야 합니다`,
  mustBeBoolean: 'true 또는 false여야 합니다',
  mustBeLanguageTag: 'BCP 47 언어 태그여야 합니다',
  mustBeAbsolutePath: '절대 경로여야 합니다',
  itemsMustBeAbsolutePaths: '절대 경로만 포함해야 합니다',
  onlyOneOf: (p: { other: string }) => `${p.other} 매개변수와 함께 지정할 수 없습니다`,
  createExcludesVideoId: '새 영상을 만들므로 videoId와 함께 지정할 수 없습니다',
  targetShape: '{ videoId }, { entryId }, { create } 중 하나여야 합니다',
};
