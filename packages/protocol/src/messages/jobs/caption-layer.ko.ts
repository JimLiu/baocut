import type { JobsCaptionLayerMessages } from './caption-layer.ts';

export const ko: JobsCaptionLayerMessages = {
  label: '자막 레이어 추가',
  noSource: '자막 레이어를 추가할 문서가 없습니다',
  videoClosed: '영상이 닫혀 자막 레이어를 추가하지 않았습니다. 영상을 연 뒤 다시 시도하세요.',
  empty: '문서에 표시할 자막이 없어 자막 레이어를 추가하지 않았습니다',
  notOnTimeline: '타임라인에 이 소재를 사용하는 클립이 없어 자막을 화면에 표시할 수 없습니다. 자막 레이어를 추가하지 않았습니다.',
  noDocumentId: '자막 레이어를 추가했지만 문서 ID가 반환되지 않았습니다',
  rejected: '자막 레이어를 추가하는 트랜잭션이 거부되었습니다',
  documentGone: '자막 레이어의 문서가 더 이상 영상에 없습니다',
  needsOutputStore: 'Speech Worker의 자막을 읽으려면 결과물 저장소가 필요합니다',
  notSpeech: '문서가 전사본이 아닙니다',
  speechUnreadable: '전사본 본문을 읽지 못했습니다',
  translationUnreadable: '번역본 본문을 읽지 못했습니다',
  unaligned: (p: { count: number }) =>
    `번역 단위 ${p.count}개가 정렬되지 않아(alignment가 null) 타이밍을 계산할 수 없습니다`,
  noSourceSpeech: '이 번역의 원본 전사본을 찾지 못했습니다',
  subtitlesName: '자막',
  translationName: '번역',
  styleName: '자막 스타일',
};
