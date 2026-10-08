import type { ThreadMessages } from './thread-copy.ts';

export const ko: ThreadMessages = {
  videoTools: {
    videos_list: '영상 목록',
    videos_create: '새 영상',
    videos_inspect: '영상 읽기',
    edits_apply: '영상 편집',
    edits_undo: '편집 실행 취소',
  },
  toolTitle: (action: string, label: string) => `${action}: ${label}`,
  steps: { command: '명령 실행', read: '파일 읽기', edit: '파일 편집', search: '검색', other: '기타 도구' },
  phrase: {
    command: '명령 실행함',
    read: (count: number) => `파일 ${count}개 읽음`,
    edit: (count: number) => `파일 ${count}개 편집함`,
    search: '검색함',
    video: (count: number) => `영상 편집 ${count}건 커밋함`,
    tool: '도구 호출함',
  },
  summary: (phrases: readonly string[]) => phrases.join(', '),
  thinking: '생각',
  stepsFallback: '단계',
};
