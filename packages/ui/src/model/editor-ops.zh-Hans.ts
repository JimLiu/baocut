import type { EditorOpsMessages } from './editor-ops.ts';

const DUB_STATUS = {
  failed: '没合成',
  'needs-fit': '过长',
  stale: '译文过期',
  draft: '没放上',
} as const;

export const zhHans: EditorOpsMessages = {
  dubStatus: DUB_STATUS,
  dubStatusCount: (n, status) => `${n} 句${DUB_STATUS[status]}`,
  stemVocals: '分离出来的人声',
  stemBackground: '分离出来的背景声',
  background: '背景',
  sentenceN: (n: number) => `第 ${n} 句`,
  dub: '配音',
  files: (n: number) => `${n} 个文件`,
  sentences: (n: number) => `${n} 句`,
  muted: (n: number) => `${n} 句静音`,
  dubTitle: (language: string | null) => `配音 · ${language ?? '未知语言'}`,
  aside: (groups: number, files: number) => (groups ? `${groups} 组配音 · ${files} 个文件` : `${files} 个文件`),
};
