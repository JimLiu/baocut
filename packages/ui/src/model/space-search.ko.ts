import type { SpaceSearchMessages } from './space-search.ts';

export const ko: SpaceSearchMessages = {
  documentKind: { speech: '전사본', caption: '자막', translation: '번역', chapter: '챕터' },
  pendingVideos: (count: number) =>
    `영상 ${count}개의 콘텐츠 인덱스가 아직 업데이트 중이라 결과에서 일부 영상이 빠졌거나 오래된 내용일 수 있습니다`,
  indexUpdating: '콘텐츠 인덱스를 업데이트하는 중이라 결과가 오래된 내용일 수 있습니다',
  truncated: (count: number) => `일치하는 항목이 너무 많아 처음 ${count}개만 표시합니다`,
  notes: (notes: readonly string[]) => `${notes.join('. ')}.`,
  sourceTime: (clock: string) => `소재 시간 ${clock}`,
};
