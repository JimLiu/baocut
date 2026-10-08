import type { VideoInfoMessages } from './video-info-copy.ts';

export const ko: VideoInfoMessages = {
  section: { media: '출처와 미디어', source: '출처 정보' },
  speakers: (count: number) => `화자 ${count}명`,
  chapters: (count: number) => `챕터 ${count}개`,
  paragraphs: (count: number) => `문단 ${count}개`,
  list: (names: readonly string[]) => names.join(', '),
  sourceKind: {
    'link-import': 'URL에서 가져옴',
    'user-import': '로컬 파일',
    generated: '생성됨',
    library: '사용자 라이브러리',
  },
  row: {
    contents: '내용',
    translation: '번역',
    location: '위치',
    file: '원본 파일',
    media: '미디어',
    transcript: '전사',
    channel: '채널',
    published: '게시일',
    platform: '플랫폼',
    mediaId: '영상 ID',
    url: 'URL',
    title: '원래 제목',
    description: '설명',
  },
};
