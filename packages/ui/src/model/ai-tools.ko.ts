import type { AiToolsMessages } from './ai-tools.ts';

const SOON_TAIL = 'Runtime에는 아직 이 워크플로가 없고 영상 위에서 프레이밍을 조정할 오버레이도 없어서, 여기에는 아직 입력할 양식이 없습니다.';

export const ko: AiToolsMessages = {
  shorts: {
    lengths: { auto: '자동', short: '15–30초', medium: '30–60초', long: '60–90초', extended: '1–3분', custom: '직접 설정' },
    ratioSource: '원본 비율 유지',
    focus: {
      auto: { label: '자동', sub: '말하는 사람이 화면 어느 쪽에 있는지 보고 프레임을 그 사람에게 맞춥니다. 사람이 없으면 가운데' },
      manual: { label: '직접 정하기', sub: '나중에 쇼츠마다 프레임 위치를 직접 정합니다' },
      speaker: { label: '말하는 사람 따라가기', sub: '말하는 사람을 프레임이 따라갑니다' },
    },
    speakerOff: '이 버전에는 아직 인물·화자 모델이 없습니다',
    tracks: { both: '원문 + 번역', source: '원문만', translation: '번역만' },
    styles: {
      shorts: { label: '쇼츠 자막', sub: '기본 프리셋으로, 플랫폼 버튼을 피합니다' },
      video: { label: '이 영상의 스타일 유지', sub: '크기와 위치를 그대로 쓰며, 플랫폼 버튼에 가려질 수 있습니다' },
    },
    focusPrompt: { auto: '자동: 구간에서 프레임을 고르게 뽑아 말하는 사람이 화면 어느 쪽에 있는지 보고 자르는 틀을 그 사람에게 맞추기. 사람을 찾지 못하면 가운데로', manual: '일단 가운데로 두고 나중에 하나씩 직접 조정' },
    countN: (n) => `${n}개`,
    autoHint: {
      both: '자동: Agent가 따로 떼어도 성립하는 좋은 주제를 찾아 몇 개를, 각각 얼마나 길게 만들지 주제에 맞춰 정합니다. 개수를 억지로 채우거나 주제를 중간에 자르지 않습니다.',
      count: '자동: 따로 떼어도 성립하는 주제 수만큼 만들고, 약한 구간으로 개수를 채우지 않습니다.',
      length: '자동: 각 쇼츠는 시선을 끄는 첫 문장부터 주제가 마무리되는 곳까지이며, 길이에 맞추려고 늘리거나 자르지 않습니다.',
    },
    lineCount: (count, len) =>
      `${count === null ? '몇 개 만들지는 찾은 주제를 보고 정하기' : `${count}개 만들기`}, ${len ? `각각 ${len.min}–${len.max}초` : '길이는 주제마다 정하기(시선을 끄는 첫 문장부터 요점이 마무리되는 곳까지)'}, 시작과 끝은 문장 경계에 맞추기`,
    lineFrame: (ratio, focus) => (ratio ? `화면 비율 ${ratio}, 프레이밍: ${focus}` : '화면 비율: 원본 유지, 자르지 않기'),
    lineSubtitles: (tracks, style) => `자막: ${tracks}, ${style}`,
    lineSkipDone: '이미 잘라 낸 부분은 다시 찾지 않기',
    lineTopic: (topic) => `“${topic}”에 대해 말하는 부분에서만 찾기: 먼저 speech_relevant로 그 부분을 찾은 뒤 그중에서 고르기`,
    lineDirect: '찾으면 바로 영상으로 만들기, 먼저 묻지 않아도 됨',
  },
  groups: {
    frame: '화면',
    transcript: '전사본',
    translate: '번역',
    writing: '글쓰기',
    publish: '게시',
    sound: '사운드',
  },
  tools: {
    crop: {
      name: '스마트 크롭',
      desc: '화자, 화이트보드 같은 핵심 대상을 화면 안에 유지하면서 화면 비율을 바꿉니다',
      why: `스마트 크롭은 영상 내내 화자, 화이트보드 같은 핵심 대상을 따라가며 새 화면 비율로 크롭해야 합니다. ${SOON_TAIL}`,
    },
    shortscut: {
      name: '쇼츠로 만들기',
      desc: '이 영상에서 좋은 주제를 찾아 각각 쇼츠로 만듭니다',
      setup: ['따로 올릴 만한 주제를 찾아 각각 완결된 쇼츠로 잘라냅니다.'],
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
    soundtrack: {
      name: '배경 음악 생성',
      desc: '이 영상 길이에 맞춰 이 컴퓨터에서 배경음악을 만들어 영상의 음악 트랙에 추가합니다',
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
  extraTopic: (topic: string) => `“${topic}”에 대해서만 쓰기: 먼저 speech_relevant로 그 이야기를 하는 부분을 찾은 뒤 그 부분으로 쓰기`,
  extraLength: (label: string) => `분량: ${label}`,
  extraStyle: (style: string) => `스타일: ${style}`,
  extraLanguage: (language: string) => `작성 언어: ${language}`,
  extraView: (view: string) => `시점: ${view}`,
  extraPlatform: (platform: string) => `게시할 곳: ${platform}. 해당 플랫폼의 규칙에 맞춰 쓰고, 다 쓰면 확인하라고 알려 주세요`,
  extraFrames: '그림이 필요한 곳에는 영상에서 키프레임을 뽑아 본문에 넣고, 장마다 한 줄 캡션을 달아 주세요',
  extraIdea: (idea: string) => `커버가 전달할 한 가지: ${idea}`,
  extraRatio: (ratio: string) => `화면 비율 ${ratio}`,
  extraCoverText: (label: string) => `커버 문구: ${label}`,
  titled: (title: string) => `“${title}”`,
  thisVideo: '이 영상',
  sourceEdited: (n: number | null) => (n === null ? '원문 수정됨' : `원문에서 ${n}문장 수정됨`),
  sourceCut: (n: number | null) => (n === null ? '원문 잘림' : `원문에서 ${n}문장 잘림`),
  sourceJoin: (parts: readonly string[]) => parts.join(', '),
  retranslateOne: (o) => `${o.p}에서 ${o.time ? `${o.time}의 ` : ''}“${o.text}” 문장을 ${o.language}(으)로 다시 번역해 주세요. 이 문장의 번역만 바꾸고 타이밍, 자막 스타일, 다른 문장은 그대로 유지해 주세요.`,
  retranslateStale: (o) => `${o.p}의 ${o.language} 번역에 오래되었거나 아직 번역되지 않은 문장이 ${o.count}개 있습니다. 해당 문장만 다시 번역하고 나머지는 그대로 유지해 주세요.`,
  intents: {
    shortscut: (o) => `${o.scope ? `${o.p}의 ${o.scope}` : o.p}에서 따로 올릴 만한 주제를 찾아 주제마다 완결된 쇼츠로 잘라 주세요. 쇼츠마다 같은 원본을 참조하는 새 영상이며, 원본 영상과 타임라인은 그대로 둡니다.`,
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
  groupSub: { writing: '읽는 사람을 위해: 영상을 보지 않아도 내용을 알 수 있게', publish: '영상을 올리는 사람을 위해: 열어 보고 싶게, 열면 내용이 맞게' },
  laterNote: '자막 번역은 자막 패널에, 더빙 번역은 오디오 패널에 아직 있습니다. 나중에 이곳으로 옮겨집니다. 스마트 크롭은 곧 제공됩니다.',
  effect: {
    shortscut: '새 하위 영상을 만듭니다. 원본 영상과 타임라인은 그대로입니다',
    polish: '전사본을 바꿉니다: 완료되면 적용되고 한 번에 실행 취소할 수 있습니다',
    chapters: '챕터를 바꿉니다: 완료되면 적용되고 한 번에 실행 취소할 수 있습니다',
    speakers: '먼저 확인을 받고, 적용해야 영상에 기록됩니다',
    retranscribe: '이 범위의 전사본을 바꿉니다: 완료되면 적용되고 한 번에 실행 취소할 수 있습니다',
    cleanup: '제안만 하며, 확인하기 전에는 자르지 않습니다',
    stale: '오래된 문장만 다시 번역하고 나머지는 그대로 둡니다',
    summary: '영상은 바꾸지 않습니다: 결과를 읽고 복사해 가세요',
    blog: '영상은 바꾸지 않습니다: 결과를 읽고 복사해 가세요',
    title: '영상은 바꾸지 않습니다: 하나를 골라 사용하세요',
    desc: '영상은 바꾸지 않습니다: 결과를 읽고 복사해 가세요',
    cover: '영상은 바꾸지 않습니다: 한 장을 골라 사용하세요',
  },
  standMarkdown: (language) => (language ? `Markdown으로, ${language}로 작성하세요.` : 'Markdown으로, 전사본과 같은 언어로 작성하세요.'),
  standLanguage: (language) => (language ? `${language}로 작성하세요.` : '전사본과 같은 언어로 작성하세요.'),
  standing: {
    summary: ['결론을 먼저 쓰고 요점을 나열하세요. 요점마다 타임코드(mm:ss)를 붙이세요.', '분량은 적당히, 3~5문단으로 하세요.'],
    blog: ['관점은 영상의 출처로 정하세요: 내 영상이면 작성자 입장에서, 다른 사람의 영상이면 시청자 입장에서 씁니다.', '문체는 담백하게, 광고 투는 쓰지 마세요.'],
    title: ['후보는 한 줄에 하나씩 쓰세요.'],
    desc: ['챕터 타임코드와 태그 한 줄을 넣으세요.'],
    cover: ['표지 글자는 전사본의 언어로 쓰세요.'],
    polish: ['제 표현을 바꾸거나 내용을 지우지 말고, 확실한 오타만 고치세요.'],
    chapters: ['주제별로 묶고 챕터마다 짧은 제목을 붙이세요.'],
  },
  sessionNew: '새 세션',
  sessionNewSub: '이 영상을 컨텍스트로 씁니다. 한 가지 일에 세션 하나라 긴 기록을 다시 보내지 않습니다',
  sessionCurrent: (title) => `“${title}” 이어서`,
  sessionUntitled: '이 영상의 세션',
  sessionCurrentSub: (messages) =>
    messages === null
      ? '세션 기록을 다시 보내므로 프롬프트 캐시가 만료되면 비용이 더 듭니다'
      : `메시지 ${messages}개 · 기록을 다시 보내므로 프롬프트 캐시가 만료되면 비용이 더 듭니다`,
  hintNew: '이 영상을 컨텍스트로 새 세션을 시작합니다. 진행 상황은 세션에서 보고, Agent가 영상에 한 변경은 모두 실행 취소할 수 있습니다.',
  hintCurrent: '이 영상의 현재 세션으로, 이 영상을 컨텍스트로 보냅니다. 진행 상황은 세션에서 보고, Agent가 영상에 한 변경은 모두 실행 취소할 수 있습니다.',
};
