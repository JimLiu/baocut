import type { TtsLocalMessages } from './tts-local-copy.ts';

export const ko: TtsLocalMessages = {
  ttsLocal: {
    // 默认模型（语音合成没有出厂默认，菜单里没有「自动选择」）
    unset: '설정 안 됨',
    defaultDesc: '새 합성 작업에 미리 선택됩니다. 기본값이 없으면 매번 모델을 직접 고르며, 직접 고른 모델이 항상 우선합니다.',
    cloudDefault: (name: string) =>
      `기본값은 클라우드 모델(${name})입니다. 설정 › 클라우드 모델에서 바꾸세요. 로컬 모델을 선택하면 그 모델로 바뀝니다.`,
    noInstalled: '아직 설치된 음성 합성 모델이 없습니다. 먼저 아래에서 하나를 다운로드하세요.',
    // 行
    audition: '미리 듣기',
    hideAudition: '미리 듣기 숨기기',
    engine: '엔진',
    license: '라이선스',
    components: '구성 요소',
    // 下载前的许可确认（设计稿 withModelLicense）
    licenseTitle: '라이선스',
    licenseUse: '이 모델로 만든 음성은 비상업적 콘텐츠에만 쓸 수 있습니다. 상업적으로 쓸 영상에는 다른 음성 모델을 고르세요.',
    licenseConfirm: (size: string) => `확인하고 ${size} 다운로드`,
    // 试听面板
    voice: '목소리',
    tone: '어조',
    say: '말할 내용',
    lines: '대사',
    more: '목소리 더 보기',
    cloneNew: '새 목소리 복제…',
    writeOwn: '직접 쓰기',
    ownPlaceholder: '들어 볼 문장을 입력하세요',
    ownLabel: '미리 듣기 텍스트',
    describeLabel: '목소리 설명',
    describePlaceholder: '예: 낮고 느긋한 노년 남성 목소리',
    builtinRef: (label: string, seconds: number | null) =>
      `참조 녹음 · ${label}${seconds !== null ? ` · ${seconds}초` : ''} · 녹음의 전사본은 자동으로 포함됩니다`,
    describedBuiltin: (label: string) => `설명으로 만든 목소리 · “${label}”에 딸린 설명을 사용합니다`,
    describePreset: (text: string) => `설명: ${text}`,
    myVoice: (name: string) => `내 목소리 · ${name} · 참조 녹음과 전사본으로 복제합니다`,
    presetOnly: (models: string | null) =>
      models
        ? `이 모델에는 내장 화자만 있습니다 · “내 목소리”는 복제할 수 있는 모델에서 시험해 보세요: ${models}(각 모델 행의 미리 듣기)`
        : '이 모델에는 내장 화자만 있습니다 · “내 목소리”를 시험하려면 먼저 복제할 수 있는 모델을 다운로드하세요',
    nameList: (names: readonly string[]) => names.join(', '),
    cloneHint: '잡음 없는 음성 5–15초를 넣어 주세요. 한 사람만 말하고 배경 음악이 없어야 합니다. WAV, MP3, M4A, FLAC 또는 영상 파일 모두 쓸 수 있습니다.',
    yourFile: (name: string) => `내 녹음 · ${name}`,
    sampleFile: (label: string) => `샘플 녹음 · ${label} · BaoCut에 포함되어 있어 파일을 찾을 필요가 없습니다`,
    pickFile: '녹음 선택…',
    changeFile: '다른 녹음 선택…',
    useSample: '샘플 녹음 사용',
    crossLang: '언어가 달라도 됩니다. 중국어 녹음으로도 영어를 읽을 수 있습니다.',
    noPicker:
      '브라우저에서는 이 컴퓨터의 파일을 고를 수 없습니다. 녹음을 이번에만 쓰려면 데스크톱 앱에서 고르세요. 또는 샘플 녹음을 쓰거나 먼저 “내 목소리”에 저장하세요.',
    pickTitle: '참조 녹음 선택',
    pickButton: '선택',
    pickFilter: '오디오 또는 영상',
    transcriptLabel: '녹음 전사본(선택 사항)',
    transcriptHint: '녹음에서 하는 말을 적어 두면 더 비슷하게 들립니다',
    fileChip: (name: string, sample: boolean) => (sample ? `샘플 · ${name}` : name),
    generate: '미리 듣기 생성',
    again: '다시 생성',
    cancel: '취소',
    busy: (phase: string) => `합성 중 · ${phase}`,
    stalePrefix: '이전 · ',
    stale: '이 오디오는 이전에 고른 설정으로 만들었습니다. 목소리나 텍스트를 바꾼 뒤 “미리 듣기 생성”을 클릭하면 새로 들을 수 있습니다.',
    download: '다운로드',
    resultLabel: '미리 듣기 결과',
    credit: (credit: string) => `내장 목소리 녹음: ${credit}`,
    loadingAudio: '오디오를 불러오는 중…',
    audioFailed: (message: string) => `오디오를 불러오지 못했습니다: ${message}`,
    downloadFailed: (message: string) => `다운로드하지 못했습니다: ${message}`,
    fileName: (name: string) => `${name.replace(/[^\w.-]+/g, '-')}-미리듣기.wav`,
    // 「我的声音」那一侧：`name` 是发起克隆的那只本地模型的名字
    handoffFrom: (name: string) => `“${name}” 미리 듣기에서 왔습니다 · 녹음하거나 영상에서 가져오세요. 저장하면 다시 돌아갑니다`,
    handoffSaved: (name: string) => `저장됨 · “${name}” 미리 듣기로 돌아가면 이 목소리가 선택되어 있습니다`,
    handoffBack: '돌아가서 사용',
    handoffCancel: '그냥 돌아가기',
    auditionClone: '복제 미리 듣기',
    auditionCloneLabel: (name: string) => `복제 미리 듣기 · ${name}`,
    noCloneModel:
      '복제할 수 있는 로컬 모델이 아직 설치되지 않았습니다. 먼저 로컬 모델 페이지에서 하나를 다운로드하세요(IndexTTS2, Qwen3-TTS Base, GPT-SoVITS…).',
    goLocal: '로컬 모델로 이동',
  },
};
