import type { EditorOpsMessages } from './editor-ops.ts';

const DUB_STATUS = {
  failed: '합성 안 됨',
  'needs-fit': '너무 김',
  stale: '번역 오래됨',
  draft: '배치 안 됨',
} as const;

export const ko: EditorOpsMessages = {
  dubStatus: DUB_STATUS,
  dubStatusCount: (n, status) => `문장 ${n}개 ${DUB_STATUS[status]}`,
  stemVocals: '분리된 보컬',
  stemBackground: '분리된 배경음',
  background: '배경',
  sentenceN: (n: number) => `문장 ${n}`,
  dub: '더빙',
  files: (n: number) => `파일 ${n}개`,
  sentences: (n: number) => `문장 ${n}개`,
  muted: (n: number) => `문장 ${n}개 음소거됨`,
  dubTitle: (language: string | null) => `더빙 · ${language ?? '알 수 없는 언어'}`,
  aside: (groups: number, files: number) => (groups ? `더빙 그룹 ${groups}개 · 파일 ${files}개` : `파일 ${files}개`),
};
