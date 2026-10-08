import type { AiToolsMessages } from './ai-tools.ts';

const SOON_TAIL = 'Runtime에는 아직 이 워크플로가 없고 영상 위에서 프레이밍을 조정할 오버레이도 없어서, 여기에는 아직 입력할 양식이 없습니다.';

export const ko: AiToolsMessages = {
  groups: {
    frame: '화면',
    transcript: '전사본',
    translate: '번역',
    writing: '글쓰기',
    publish: '게시',
  },
  tools: {
    crop: {
      name: '스마트 크롭',
      desc: '화자, 화이트보드 같은 핵심 대상을 화면 안에 유지하면서 화면 비율을 바꿉니다',
      why: `스마트 크롭은 영상 내내 화자, 화이트보드 같은 핵심 대상을 따라가며 새 화면 비율로 크롭해야 합니다. ${SOON_TAIL}`,
    },
    shortscut: {
      name: '쇼츠로 만들기',
      desc: '이 영상에서 몇 구간을 골라 각각 세로형 쇼츠로 만듭니다',
      why: `쇼츠로 만들려면 몇 구간을 골라 각각 세로로 크롭하고, 영상 위에서 구간마다 프레이밍을 조정해야 합니다. ${SOON_TAIL}`,
    },
    polish: {
      name: '전사본 다듬기',
      desc: '오타를 고치고 문장 부호를 넣고 문단을 나눕니다. 표현은 다시 쓰지 않습니다',
      setup: [
        '명백한 오타를 고치고, 빠진 문장 부호를 넣고, 주제별로 문단을 나눕니다.',
        '표현을 다시 쓰거나 내용을 지우지 않습니다. 분명한 실수만 고칩니다.',
      ],
    },
    chapters: {
      name: '챕터 생성',
      desc: '긴 영상을 제목이 있는 챕터로 나눕니다',
      setup: ['문단을 주제별로 묶어 챕터를 만들고 챕터마다 제목을 붙입니다.', '내보내기와 공유 페이지도 같은 챕터를 사용합니다.'],
    },
    speakers: {
      name: '화자 식별',
      desc: '누가 말하는지 구분하고 자막과 전사본에 이름을 표시합니다',
    },
    retranscribe: {
      name: '다시 전사',
      desc: '다른 모델로 오디오를 다시 처리합니다. 원하면 챕터나 구간 하나만 처리할 수 있습니다',
      setup: [
        '다른 음성 모델로 다시 실행해 이 범위의 단어 단위 데이터를 교체합니다.',
        '범위 밖의 전사본, 자막, 번역은 그대로 유지됩니다.',
      ],
    },
    cleanup: {
      name: '잘라낼 곳 찾기',
      desc: '군말, 긴 멈춤, 잘못된 테이크를 찾습니다. 제안을 검토한 뒤에 잘라냅니다',
      setup: [
        '군말, 0.8s 이상의 멈춤, 반복된 문장 시작을 찾습니다.',
        '잘라내기 전에 잘라낼 후보 목록을 먼저 확인할 수 있습니다.',
      ],
    },
    translate: {
      name: '자막 번역',
      desc: '문장 단위로 번역하고 단어 단위 데이터로 타임코드를 맞춥니다',
    },
    stale: {
      name: '오래된 번역 새로 고침',
      desc: '원문이 수정되었거나 잘린 문장만 다시 번역합니다',
      setup: [
        '원문이 바뀐 문장만 다시 번역합니다. 직접 수정한 문장과, 잘라내기로 문장 일부가 잘린 문장이 대상입니다.',
        '잘린 뒤의 원문을 기준으로 번역합니다. 문장 전체가 잘렸다면 그 번역도 함께 잘립니다. 나머지는 바뀌지 않습니다.',
      ],
    },
    dub: {
      name: '번역 더빙',
      desc: '언어를 고르면 영상이 그 언어로 말합니다. 원래 화자처럼 또는 원어민처럼 들리게 할 수 있으며, 기본값만으로도 시작할 수 있습니다',
    },
    summary: {
      name: '요약 쓰기',
      desc: '본문과 타임스탬프가 있는 핵심 요점. 시간을 클릭하면 그 지점으로 이동합니다',
    },
    blog: {
      name: '블로그 글 쓰기',
      desc: '작성자 또는 시청자의 시점에서 한 편의 글로 다시 씁니다',
    },
    title: {
      name: '제목 제안',
      desc: '서로 다른 관점의 후보를 여러 개 받은 뒤 하나를 고릅니다',
    },
    desc: {
      name: '설명 쓰기',
      desc: '챕터 타임코드와 태그가 포함된 게시용 설명',
    },
    cover: {
      name: '커버 만들기',
      desc: '주요 프레임으로 커버 후보를 몇 장 만든 뒤 하나를 고릅니다',
    },
  },
  unknownTool: (id: string) => `해당 AI 도구가 없습니다: ${id}`,
  cleanup: {
    fillers: {
      label: '군말',
      sub: '“음”, “어”, “그러니까”, “뭐랄까” 같은 말',
      off: '군말',
    },
    pauses: {
      label: '긴 멈춤 ≥ 0.8s',
      sub: '단어 단위 타이밍으로 찾습니다',
      off: '긴 멈춤',
    },
    repeats: {
      label: '반복된 문장 시작',
      sub: '같은 문장을 두 번 시작한 경우 뒤의 것을 남깁니다',
      off: '반복된 문장 시작',
    },
  },
  cleanupOff: (offs: readonly string[]) => `${offs.join(', ')} 항목은 찾지 말아 주세요`,
  lengths: { short: '짧게', medium: '보통', long: '길게' },
  styles: {
    plain: '담백하게',
    pop: '쉽게 풀어서',
    sharp: '신랄하게',
    light: '가볍게',
    pro: '전문적으로',
    custom: '사용자 지정…',
  },
  views: {
    auto: '자동',
    author: '작성자입니다',
    viewer: '시청자입니다',
  },
  coverText: {
    none: '텍스트 없음',
    phrase: '짧은 문구',
    'phrase-sub': '문구와 작은 글씨 한 줄',
  },
  viewName: { author: '작성자', viewer: '시청자' },
  extraScope: (scope: string) => `${scope}만 다뤄 주세요`,
  extraLength: (label: string) => `분량: ${label}`,
  extraStyle: (style: string) => `스타일: ${style}`,
  extraLanguage: (language: string) => `작성 언어: ${language}`,
  extraView: (view: string) => `시점: ${view}`,
  extraPlatform: (platform: string) => `게시할 곳: ${platform}. 해당 플랫폼의 규칙에 맞춰 쓰고, 다 쓰면 확인하라고 알려 주세요`,
  extraIdea: (idea: string) => `커버가 전달할 한 가지: ${idea}`,
  extraRatio: (ratio: string) => `화면 비율 ${ratio}`,
  extraCoverText: (label: string) => `커버 문구: ${label}`,
  titled: (title: string) => `“${title}”`,
  thisVideo: '이 영상',
  sourceEdited: (n: number | null) => (n === null ? '원문 수정됨' : `원문에서 ${n}문장 수정됨`),
  sourceCut: (n: number | null) => (n === null ? '원문 잘림' : `원문에서 ${n}문장 잘림`),
  sourceJoin: (parts: readonly string[]) => parts.join(', '),
  intents: {
    stale: (o) =>
      `${o.p}의 일부 번역이 ${o.why ? `오래되었습니다(${o.why})` : '원문 수정으로 오래되었습니다'}. 해당 문장만 다시 번역해 주세요${o.cut ? '. 잘린 문장은 잘린 뒤의 원문으로 다시 번역하고, 문장 전체가 잘린 경우 그 번역도 함께 삭제해 주세요' : ''}. 나머지는 그대로 유지해 주세요.`,
    polish: (o) =>
      `${o.p}의 ${o.scope || '전체'} 전사본을 다듬어 주세요. 오타를 고치고, 문장 부호를 넣고, 주제별로 문단을 나누되 제 표현은 다시 쓰지 말아 주세요.`,
    chapters: (o) => `${o.p}의 내용을 주제별 챕터로 나누고 챕터마다 짧은 제목을 붙여 주세요.`,
    speakers: (o) => `${o.p}의 ${o.scope || '전체'} 구간에서 화자를 식별해 주세요. 영상에 기록하기 전에 결과를 먼저 보여 주시면 확인하겠습니다.`,
    retranscribe: (o) => `다른 음성 모델로 ${o.p}의 ${o.scope || '전체'} 구간을 다시 전사하고, 범위 밖은 그대로 유지해 주세요.`,
    cleanup: (o) =>
      `${o.p}의 ${o.scope || '전체'} 구간에서 군말, 긴 멈춤, 반복된 문장 시작을 찾아 주세요. 먼저 목록으로 보여 주시고, 제가 확인하기 전에는 아무것도 잘라내지 말아 주세요.`,
    summary: (o) => `${o.p}의 전사본에서 타임코드가 포함된 핵심 요점 요약을 작성해 주세요.`,
    blog: (o) => `${o.p}의 내용을 바로 게시할 수 있는 블로그 글로 다시 써 주세요.`,
    title: (o) =>
      `${o.p}의 제목 후보를 ${o.count}개 제안해 주세요. 후보마다 관점을 다르게 하고 한 줄 이유를 붙인 뒤, 하나를 추천해 주세요.`,
    desc: (o) => `${o.p}의 게시용 설명을 써 주세요. 챕터 타임코드와 태그 한 줄을 포함해 주세요.`,
    cover: (o) =>
      `${o.p}의 커버 후보를 ${o.count}장 만들어 주세요. 먼저 주요 프레임을 고르고, 장마다 다른 바탕 이미지 방식을 쓰고, 보여 주기 전에 작은 크기로 확인해 주세요.`,
  },
  endSentence: (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`),
  joinPrompt: (head: string, extra: readonly string[]) => [head, ...extra].join(' '),
};
