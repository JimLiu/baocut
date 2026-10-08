import type { SpaceMessages } from './space-copy.ts';

export const ko: SpaceMessages = {
  kind: {
    video: '영상',
    export: '내보내기',
    'video-file': '영상 소재',
    image: '이미지',
    audio: '오디오',
    subtitle: '자막',
    document: '문서',
    package: '영상 패키지',
    template: '템플릿',
  },
  categoryAll: '전체',
  favorite: '즐겨찾기',
  trash: '휴지통',
  sort: { created: '생성 시간', updated: '수정 시간', recent: '최근 활동', name: '이름', kind: '유형' },
  status: {
    generating: '생성 중',
    candidate: '후보',
    applied: '적용됨',
    published: '게시됨',
    'source-changed': '원본 변경됨',
    missing: '없음',
    failed: '실패',
  },
  statusAny: '모든 상태',
  statusNone: '상태 없음',
  noProject: '프로젝트에 속하지 않음',
  removedProject: '제거된 프로젝트',
  conversation: (title: string) => `세션 “${title}”`,
};
