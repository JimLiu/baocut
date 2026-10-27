import type { VideoBarMessages } from './video-bar-copy.ts';

export const ko: VideoBarMessages = {
  closeToSpace: '영상 닫기 · Space로 돌아가기',
  untitled: '영상',
  rename: '영상 이름 변경',
  details: '영상 정보',
  actions: '영상 동작',
  showInSpace: 'Space에서 보기',
  revealVideoFolder: '영상 폴더 보기',
  close: '영상 닫기',
  nameLabel: '이름',
  save: '저장',
  openFailed: '열 수 없음',
  stale: '최신 상태 아님 · 지금은 편집할 수 없음',
  openingAria: '여는 중',
  opening: '여는 중…',
  savingAria: '저장 중',
  saving: '저장 중…',
  agentChanged: (label: string) => `Agent가 영상을 변경했습니다: ${label}`,
  savedByAgent: (label: string) => `저장됨 · Agent: ${label}`,
  saved: '저장됨',
};
