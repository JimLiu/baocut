import type { JobsSpeakersMessages } from './speakers.ts';

export const ko: JobsSpeakersMessages = {
  label: '화자 식별',
  description:
    '영상에 있는 기존 전사본의 화자를 목소리로 구분합니다(로컬 모델, 다시 전사하지 않음). 결과는 제안이며, 확인한 뒤 edits.applySpeakers로 적용합니다.',
  stepDiarize: '화자 구분',
  stepPropose: '결과 정리',
  videoNotOpen: '영상이 열려 있지 않습니다',
  notFromAsset: '이 전사본은 영상의 소재에 속하지 않아 목소리로 화자를 구분할 수 없습니다',
  modelMissing: '이 컴퓨터에 화자 분리 모델이 없습니다',
  modelNotInstalled: '화자 분리 모델이 아직 설치되지 않았습니다. 먼저 다운로드하세요.',
  transcriptUnreadable: '전사본을 읽지 못했습니다',
  videoClosed: '영상이 닫혔습니다',
  transcriptGone: '전사본이 더 이상 영상에 없습니다',
  noWords: '전사본에 단어가 없습니다',
  untimedWords: '전사본에 타이밍이 없는 단어가 있어 목소리로 화자를 구분할 수 없습니다',
  sourceMissing: '소재의 원본 파일을 찾지 못했습니다',
  hashMismatch: 'speakers.json의 해시가 Worker가 보고한 값과 일치하지 않습니다',
  wordCountMismatch: 'speakers.json의 단어 수가 전사본과 다릅니다',
  transcriptChanged: '화자를 식별한 뒤 전사본이 바뀌었습니다. 화자를 다시 식별하세요.',
  translationChanged: '화자를 식별한 뒤 번역이 바뀌었습니다. 화자를 다시 식별하세요.',
  unknownSpeaker: '이 화자는 제안에 없습니다',
  nameInvalid: (p: { max: number }) => `화자 이름은 비워 둘 수 없으며 최대 ${p.max}자까지 쓸 수 있습니다`,
  applyFailed: '제안을 적용하지 못했습니다',
};
