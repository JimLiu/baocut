import type { EditorOpsMessages } from './editor-ops.ts';

const DUB_STATUS = {
  failed: '未合成',
  'needs-fit': '過長',
  stale: '譯文已過期',
  draft: '未放置',
} as const;

export const zhHant: EditorOpsMessages = {
  dubStatus: DUB_STATUS,
  dubStatusCount: (n, status) => `${n} 句${DUB_STATUS[status]}`,
  stemVocals: '分離出的人聲',
  stemBackground: '分離出的背景',
  background: '背景',
  sentenceN: (n: number) => `第 ${n} 句`,
  dub: '配音',
  files: (n: number) => `${n} 個檔案`,
  sentences: (n: number) => `${n} 句`,
  muted: (n: number) => `${n} 句已靜音`,
  dubTitle: (language: string | null) => `配音 · ${language ?? '未知語言'}`,
  aside: (groups: number, files: number) => (groups ? `${groups} 組配音 · ${files} 個檔案` : `${files} 個檔案`),
};
