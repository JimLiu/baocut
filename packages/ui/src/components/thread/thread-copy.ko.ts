import type { ThreadMessages } from './thread-copy.ts';

export const ko: ThreadMessages = {
  withDetail: (text, detail) => `${text}(${detail})`,
  copy: '복사',
  copied: '복사했습니다',
  copyFailed: '복사하지 못했습니다. 다시 시도하세요',
  copyCode: '코드 복사',
  copyReply: '이 응답 복사',
  change: {
    added: (n) => `추가 ${n}`,
    updated: (n) => `변경 ${n}`,
    deleted: (n) => `삭제 ${n}`,
    duration: (clock) => `길이 ${clock}`,
    durationChange: (before, after) => `길이 ${before} → ${after}`,
    revision: (before, after) => `버전 ${before} → ${after}`,
    locked: '지금은 영상을 변경할 수 없습니다',
    undoStep: (videoName, label) => `“${videoName}” 영상에서 한 단계를 실행 취소했습니다: ${label}`,
    changed: (videoName, label) => `“${videoName}” 영상을 변경했습니다: ${label}`,
    aria: (label) => `영상 변경: ${label}`,
  },
  message: {
    contextTitle: '메시지와 함께 보낸 편집기 상태',
    context: (videoName, revision, playhead, selected) =>
      `“${videoName}” · 버전 ${revision} · 재생 헤드 ${playhead}${selected ? ` · 클립 ${selected}개 선택됨` : ''}`,
  },
  output: {
    aria: (name, detail) => `${name}, ${detail}`,
  },
  steps: {
    working: (summary) => `진행 중 · ${summary}`,
    failed: (n) => `${n}개 실패`,
    thinking: '생각 중',
    viewFile: (name) => `${name} 보기`,
    input: '입력',
    error: '오류',
    output: '출력',
    waiting: '출력 대기 중',
    noOutput: '출력 없음',
  },
};
