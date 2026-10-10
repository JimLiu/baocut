import type { AiToolsMessages } from './ai-tools-copy.ts';

export const ko: AiToolsMessages = {
  back: '뒤로',

  // 设置态
  who: '사용',
  whoAgent: 'Agent에게 맡기기',
  whoModel: '모델 직접 호출',
  whoModelSub: 'Runtime에 아직 이 작업의 워크플로가 없어 Agent만 할 수 있습니다',
  scope: '범위',
  scopeAll: '영상 전체',
  scopeChapter: (index: number, label: string) => `챕터 ${index} · ${label}`,
  scopeNoChapters: '타임라인에 아직 챕터가 없어 영상 전체만 선택할 수 있습니다',
  cta: 'Agent에게 맡기기',
  queued: 'Agent가 작업 중 · 메시지가 대기열에 있으며 이번 턴이 끝나면 보냅니다',
  noConversation: '이 영상은 어떤 프로젝트나 세션에도 속하지 않아 Agent에게 맡길 수 없습니다.',
  createFailed: (message: string) => `세션을 만들지 못했습니다: ${message}`,

  // 勾选项与自定义
  prePolish: '먼저 다듬기(자동 문단 나누기)',
  prePolishOn: '챕터를 문단 단위로 묶습니다',
  prePolishOff: '다듬지 않은 전사본은 문단이 1개뿐이라 챕터가 거칠게 나뉩니다',
  staleEdited: '원문이 수정된 문장',
  staleEditedSub: '전사본에서 단어를 바꿨지만 번역은 아직 이전 그대로입니다',
  staleCut: '원문에서 잘린 문장',
  staleCutSub: '컷이 문장 일부를 제거했습니다. 잘린 원문을 기준으로 다시 번역합니다',
  staleNone: '하나 이상 선택하세요',
  staleOnly: (language: string) => `${language} 번역만`,
  retranscribeModel: '음성 모델은 Agent가 이 컴퓨터에 설치된 모델 중에서 고릅니다. 직접 정하려면 아래 지시에 적으세요.',
  retranscribeSpeakers: '전사 후 화자 식별',

  // 写作与发布
  platform: '게시할 곳',
  platformPlaceholder: '게시할 플랫폼(선택 사항). 그 플랫폼의 규칙에 맞춰 쓰고 확인하도록 알려 드립니다',
  titleCount: '후보 수',
  titleCountNote: (min: number, max: number) => `${min}–${max}개, 각각 다른 관점`,
  coverCount: '개수',
  coverIdea: '전하고 싶은 한 가지',
  coverIdeaPlaceholder: '사람들이 이 영상을 클릭하게 만들 한 가지(선택 사항). 비워 두면 Agent가 전사본에서 찾습니다',
  coverRatio: '화면 비율',
  coverRatioProject: '영상 캔버스와 같게',
  coverText: '표지 텍스트',

  // 还做不了的
  soon: '곧 제공',
  chaptersPolishFirst: '먼저 다듬고 문단을 나눈 뒤 챕터를 생성하세요',

  session: '세션',
  promptLabel: 'Agent에게 전할 말',
  promptPlaceholder: '무엇을 어떻게 할지 적고, @로 챕터나 화자를 참조하세요',
  restoreDefault: '기본값 복원',
  skillNote: '이 도구의 방식',
  noSkill: 'skill가 없습니다. 위 프롬프트만 따릅니다.',
  addSkillBack: '이 도구의 skill 다시 추가',
  sentNew: 'Agent에게 넘겼습니다 · 새 세션',
  sentCurrent: 'Agent에게 넘겼습니다 · 현재 세션에서 계속',
  agentCardTitle: '아래 목록에 없는 일은 한 문장으로 Agent에게',
  agentCardSomeAgent: 'Agent',
  agentCardOutside: '이 영상이 속한 세션을 열고 영상을 맥락으로 씁니다 →',
  noTranscriptTitle: '이 영상에는 아직 스크립트가 없습니다',
  noTranscriptBody: '여기 도구는 모두 스크립트에서 출발합니다. 다듬기, 챕터, 요약, 제목 모두 먼저 전사가 필요합니다.',
  goTranscribe: '스크립트로 이동',
  stateRunning: '실행 중',
  stateReview: '검토 대기',
  agentCardNew: (agent) => `새 세션을 열고 이 영상을 맥락으로 씁니다. 이 컴퓨터의 ${agent}에서 실행되며 쓰기 전에 묻습니다 →`,
  stateChapters: (count) => `${count}개 챕터`,
};
