import type { JobsDubMessages } from './dub.ts';

export const ko: JobsDubMessages = {
  label: '번역 더빙',
  description:
    '영상 속 전사본을 다른 언어로 더빙합니다: 번역본이 없으면 먼저 번역하고, 문장별로 음성을 합성해 원래 문장의 타이밍에 맞춘 뒤 더빙 그룹(더빙 트랙 하나)으로 영상에 적용합니다. Agent는 시작하지 않습니다.',
  stepFreezeSource: '원본 읽기',
  stepTranslate: '번역',
  stepAssemble: '번역본 조립',
  stepWrite: '번역본 기록',
  stepCheck: '번역본 확인',
  stepSeparate: '보컬과 배경음 분리',
  stepSynthesize: '문장별 합성',
  stepAlign: '타이밍 맞추기',
  stepApply: '더빙 적용',
  regroupConflict: (p: { params: string }) =>
    `문장 다시 더빙(regroup)은 번역, 언어, 목소리, 원본 오디오 처리 방식을 해당 그룹의 더빙 계획에서 가져오므로 ${p.params} 매개변수와 함께 지정할 수 없습니다`,
  orTranslationId: '이 값이나 translationId 중 하나는 지정해야 합니다',
  translationIdNoTranslate:
    'translationId를 지정하면 번역하지 않으므로 style, glossary, glossaries, textProvider, textModel은 적용되지 않습니다',
  mustBeBooleanValue: '불리언 값이어야 합니다',
  mustBeObject: '객체여야 합니다',
  unitsCount: (p: { max: number }) => `번역 단위 ID는 1~${p.max}개여야 합니다`,
  mustBeUnique: '중복 값을 포함할 수 없습니다',
  seedInvalid: (p: { max: number }) => `'new' 또는 0~${p.max} 사이의 정수여야 합니다`,
  videoNotOpen: '영상이 열려 있지 않습니다',
  translationFromOther: (p: { translationId: string; from: string; expected: string }) =>
    `${p.translationId} 번역의 원문은 ${p.from}입니다(필요한 원문: ${p.expected})`,
  translationLanguage: (p: { translationId: string; language: string; expected: string }) =>
    `${p.translationId} 번역의 언어는 ${p.language}입니다(필요한 언어: ${p.expected})`,
  noDocument: (p: { documentId: string }) => `영상에 ${p.documentId} 문서가 없습니다`,
  notTranslation: (p: { documentId: string; kind: string }) => `${p.documentId} 문서는 번역이 아니라 ${p.kind}입니다`,
  translationNotUsable: (p: { translationId: string; schema: string }) =>
    `${p.translationId} 번역은 ${p.schema} 형식이 아니어서 더빙에 사용할 수 없습니다`,
  noPlan: (p: { groupId: string }) => `영상에 이 더빙 그룹(${p.groupId})의 더빙 계획이 없습니다`,
  groupGone: (p: { groupId: string }) => `이 더빙 그룹(${p.groupId})의 항목이 더 이상 타임라인에 없습니다`,
  planNoTranslation: '더빙 계획에 번역이 기록되어 있지 않습니다',
  unitsNotInPlan: (p: { count: number; units: string }) =>
    `문장 ${p.count}개가 이 더빙 그룹의 계획이나 번역에 없습니다: ${p.units}`,
  planNoVoice: '더빙 계획에 합성에 사용한 공급자, 모델, 목소리가 기록되어 있지 않습니다',
  seedNotAccepted: (p: { model: string }) => `${p.model} 모델은 seed를 받지 않습니다`,
  videoClosed: '영상이 닫혔습니다',
  translationGone: '번역본이 더 이상 영상에 없습니다',
  translationNotSchema: (p: { schema: string }) => `번역본이 ${p.schema} 형식이 아닙니다`,
  translationNotFromTranscript: '이 번역본은 이 전사본에서 만든 것이 아닙니다',
  unitMissingIds: '번역본에 id나 sourceSentenceId가 없는 단위가 있습니다',
  separationNotConfigured:
    '보컬과 배경음 분리를 요청했지만 분리 기능(separateAudio)이 설정되어 있지 않습니다. 이 단계를 건너뛰고 원본 오디오를 그대로 처리합니다',
  unitsStale: (p: { count: number }) =>
    `번역 문장 ${p.count}개가 최신이 아니어서(원문이나 용어집이 바뀌었거나 최신 아님으로 표시됨) 합성하지 않았습니다`,
  nothingToDub: '번역본에 더빙할 문장이 없습니다: 모두 최신이 아니거나 비어 있습니다',
  separationUnavailable: '보컬과 배경음 분리를 더 이상 사용할 수 없습니다',
  noSourceAsset: '전사본에 원본 소재가 없어 분리할 수 없습니다',
  sourceAssetMissing: '전사본의 원본 소재를 사용할 수 없습니다',
  separationInvalid: '분리 결과물이 계약을 충족하지 않습니다',
  inputNoAudio: '입력에 오디오가 없습니다',
  stemNoAudio: (p: { name: string }) => `${p.name}에 오디오가 없습니다`,
  stemSampleRate: (p: { name: string; rate: number; input: number }) =>
    `${p.name}의 샘플 레이트(${p.rate})가 입력의 샘플 레이트(${p.input})와 다릅니다`,
  stemDuration: (p: { name: string; duration: number; input: number }) =>
    `${p.name}의 길이는 ${p.duration}초이고 입력은 ${p.input}초입니다`,
  sentenceJob: (p: { n: number }) => `문장 ${p.n}`,
  audioUndecodable: '합성된 오디오를 디코딩할 수 없습니다',
  outputNoAudio: '합성 결과물에 오디오가 없습니다',
  synthesisStopped: (p: { cause: string; synthesized: number; remaining: number }) =>
    `${p.cause}. 문장 ${p.synthesized}개를 합성했고 ${p.remaining}개가 남았습니다. 다시 시도하면 남은 문장만 합성합니다`,
  synthesisFailed: (p: { failed: number; synthesized: number }) =>
    `문장 ${p.failed}개를 합성하지 못했습니다. 성공한 ${p.synthesized}개는 유지되며, 다시 시도하면 실패한 문장만 합성합니다`,
  voicesUnavailableAll: (p: { speakers: string }) =>
    `화자(${p.speakers})에 연결된 목소리를 사용할 수 없어 문장을 하나도 합성하지 못했습니다. 목소리를 고친 뒤(다시 복제하거나 동의 문구 추가) 다시 시도하세요`,
  voicesUnavailable: (p: { count: number; speakers: string }) =>
    `문장 ${p.count}개는 화자(${p.speakers})에 연결된 목소리를 사용할 수 없어 합성하지 않았습니다. 다른 목소리로 대신하지 않았습니다`,
  mutedUnvoiced: (p: { count: number }) =>
    `음소거한 항목 ${p.count}개에는 목소리를 사용할 수 없어 합성하지 않은 문장도 들어 있어, 그 문장의 원본 오디오도 함께 음소거되었습니다`,
  unitsOverlong: (p: { count: number; tempo: number }) =>
    `문장 ${p.count}개는 ${p.tempo}×까지 빠르게 하고 뒤따르는 무음을 써도 들어가지 않아 타임라인에 배치하지 않았습니다(대본을 다시 써야 함)`,
  unitsOffTimeline: (p: { count: number }) =>
    `번역 문장 ${p.count}개의 원래 문장이 더 이상 타임라인에 없어 배치하지 않았습니다`,
  nothingPlaced: '타임라인에 들어가는 더빙 문장이 없습니다',
  artifactGone: (p: { artifactId: string }) => `${p.artifactId} 결과물이 더 이상 없습니다`,
  stretchNoAudio: '속도를 바꾼 뒤 오디오가 없습니다',
  videoClosedKept: '영상이 닫혔습니다. 합성된 오디오는 결과물에 보관되어 있습니다',
  videoChanged:
    '정렬 후 영상이 바뀌어 아무것도 적용하지 않았습니다. 다시 시도하면 현재 타임라인에 다시 맞춥니다(합성된 오디오는 재사용)',
  sequenceGone: '시퀀스가 더 이상 없습니다',
  backgroundMuted:
    '원본 오디오를 음소거했습니다. 원본 오디오에 목소리, 음악, 주변 소리가 섞여 있으면 배경음도 함께 사라집니다(배경음을 분리하지 않음)',
  noTrackOrPlanId: '적용 후 더빙 트랙이나 더빙 계획의 ID를 받지 못했습니다',
  applyRejected: '더빙 트랜잭션이 거부되었습니다. 합성된 오디오는 결과물에 보관되어 있습니다',
  planGone: '이 더빙 그룹의 계획이 더 이상 영상에 없습니다',
  regroupRejected: '더빙을 다시 생성하는 트랜잭션이 거부되었습니다. 합성된 오디오는 결과물에 보관되어 있습니다',
  planNotSchema: (p: { schema: string }) => `더빙 계획이 ${p.schema} 형식이 아닙니다`,
  transactionLabel: (p: { language: string }) => `더빙(${p.language})`,
  regroupLabel: (p: { language: string }) => `더빙 다시 생성(${p.language})`,
  trackName: (p: { language: string }) => `더빙(${p.language})`,
  assetName: (p: { language: string; n: number }) => `더빙(${p.language}) 문장 ${p.n}`,
  takeAssetName: (p: { language: string; n: number; k: number }) => `더빙(${p.language}) 문장 ${p.n} · 테이크 ${p.k}`,
  itemName: (p: { n: number }) => `더빙 ${p.n}`,
  backgroundName: (p: { language: string }) => `배경음(${p.language})`,
  vocalsName: (p: { language: string }) => `보컬(${p.language})`,
  planName: (p: { language: string }) => `더빙 계획(${p.language})`,
  duckingName: (p: { language: string }) => `더빙(${p.language}) 중 원본 오디오 낮추기`,
};
