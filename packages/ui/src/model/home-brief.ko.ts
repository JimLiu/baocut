import type { HomeBriefMessages } from './home-brief.ts';

export const ko: HomeBriefMessages = {
  about: (minutes: number, seconds: number) => `약 ${[minutes ? `${minutes}분` : '', seconds ? `${seconds}초` : ''].filter(Boolean).join(' ')}`,
  fromMaterials: '첨부한 자료로 영상을 만들어 주세요.',
  materials: (paths: readonly string[]) => `자료: ${paths.join(', ')}`,
  connectFirst: '먼저 AI 연결',
  sayFirst: '무엇을 만들지 말하거나 자료를 첨부하세요',
  agentOffTitle: '설치된 코딩 Agent가 모두 꺼져 있습니다',
  agentOffBody: '이 컴퓨터에 코딩 Agent가 설치되어 있지만 설정에서 꺼져 있습니다. 하나를 켜면 여기서 바로 시작할 수 있습니다.',
  enableNamed: (name: string) => `${name} 켜기`,
  enableAgent: 'Agent 켜기',
  agentMissingTitle: '코딩 Agent가 필요합니다',
  agentMissingBody: 'Claude Code 또는 Codex CLI를 설치하고 본인 구독으로 로그인한 뒤, 여기로 돌아와 시작하세요.',
  connectAgent: 'Agent 연결',
  nameEmpty: '프로젝트 이름을 입력하세요',
  nameInvalid: '프로젝트 이름에는 슬래시나 제어 문자를 넣을 수 없습니다',
};
