import type { EditorOpsMessages } from './editor-ops.ts';

const DUB_STATUS = {
  failed: '未合成',
  'needs-fit': '長すぎ',
  stale: '翻訳が古い',
  draft: '未配置',
} as const;

export const ja: EditorOpsMessages = {
  dubStatus: DUB_STATUS,
  dubStatusCount: (n, status) => `${DUB_STATUS[status]} ${n} 文`,
  stemVocals: '分離したボーカル',
  stemBackground: '分離した背景音',
  background: '背景',
  sentenceN: (n: number) => `${n} 文目`,
  dub: '吹き替え',
  files: (n: number) => `ファイル ${n} 個`,
  sentences: (n: number) => `${n} 文`,
  muted: (n: number) => `${n} 文をミュート`,
  dubTitle: (language: string | null) => `吹き替え · ${language ?? '不明な言語'}`,
  aside: (groups: number, files: number) => (groups ? `吹き替え ${groups} 組 · ファイル ${files} 個` : `ファイル ${files} 個`),
};
