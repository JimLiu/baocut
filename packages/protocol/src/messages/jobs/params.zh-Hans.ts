import type { JobsParamsMessages } from './params.ts';

export const zhHans: JobsParamsMessages = {
  unknownParam: (p: { key: string }) => `不认识的参数 ${p.key}`,
  invalidParam: (p: { key: string; problem: string }) => `参数 ${p.key} ${p.problem}`,
  mustBeNonEmptyString: '应为非空的字符串',
  atMostChars: (p: { max: number }) => `至多 ${p.max} 个字符`,
  mustBeIntegerBetween: (p: { min: number; max: number }) => `应为 ${p.min} 到 ${p.max} 之间的整数`,
  mustBeOneOf: (p: { values: string }) => `应为 ${p.values} 之一`,
  mustBeArray: '应为数组',
  atLeastItems: (p: { min: number }) => `至少要有 ${p.min} 项`,
  atMostItems: (p: { max: number }) => `至多 ${p.max} 项`,
  mustBeBoolean: '应为 true 或 false',
  mustBeLanguageTag: '应为 BCP 47 语言标签',
  mustBeAbsolutePath: '应为绝对路径',
  itemsMustBeAbsolutePaths: '的每一项应为绝对路径',
  onlyOneOf: (p: { other: string }) => `与 ${p.other} 只能给一个`,
  createExcludesVideoId: '是新建视频，不能同时给 videoId',
  targetShape: '应为 { videoId }、{ entryId } 或 { create }',
};
