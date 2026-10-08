import type { AudioGenMessages, GeneratedMarkMessages, ImageGenMessages } from './media-gen-copy.ts';

export const koMark: GeneratedMarkMessages = { generated: '생성됨' };

export const koAudioGen: AudioGenMessages = {
  generate: '음성 생성',
  clone: '목소리 복제',
  generateTip: '클라우드 모델로 텍스트를 읽어 소재 라이브러리에 추가합니다',
  cloneTip: '내 목소리에서 복제한 목소리로 텍스트를 읽습니다',
  back: '오디오로 돌아가기',
  running: '백그라운드에서 실행 중',
  textPlaceholder: '합성할 텍스트. 마침표나 줄바꿈에서 구간이 나뉩니다…',
  clonePlaceholder: '이 목소리로 말할 내용…',
  cta: '생성',
  cloneCta: '이 목소리로 생성',
  hint: (provider: string) =>
    `온라인으로 ${provider}에 보내 합성하며, 해당 공급자의 규칙에 따라 요금이 부과됩니다. 진행 상황은 상단 바와 백그라운드 작업에 표시되고, 완료되면 소재 라이브러리에 추가됩니다. 타임라인에 배치하는 것은 별도 단계입니다. 기다리기를 중지해도 이미 보낸 요청은 회수되지 않습니다.`,
  readOnly: '지금은 이 영상이 읽기 전용이라 소재를 생성해 넣을 수 없습니다',
  noVoicesTitle: '내 목소리에 아직 목소리가 없습니다',
  noVoicesBody:
    '목소리를 복제하려면 먼저 모델 › 음성 합성 › 내 목소리에서 녹음하거나 파일에서 가져온 뒤, 목소리를 복제할 수 있는 공급자(ElevenLabs)에 업로드하세요. 그런 다음 돌아와 아래 목소리 목록에서 선택하세요.',
  goVoices: '내 목소리 열기',
  runTitle: (title: string) => `${title}…`,
  runNote: '계속 편집해도 됩니다 · 합성은 백그라운드에서 실행되며, 완료되면 소재 라이브러리에 추가됩니다.',
  cancel: '취소',
  cancelled: '취소됨',
  done: (meta: string) => `생성됨 · ${meta}`,
  inLibrary: (name: string) => `소재 라이브러리에 추가됨 · ${name}`,
  importing: '소재 라이브러리에 추가하는 중…',
  add: '타임라인에 추가',
  addTip: '재생 헤드 위치에 배치',
  again: '하나 더 생성',
  backToAudio: '오디오로 돌아가기',
  doneNote:
    '소재는 오디오 라이브러리에 “생성됨” 표시와 함께 있습니다. 타임라인으로 끌어 놓거나 “+”를 클릭해 배치하세요. 원하는 만큼 여러 번 쓸 수 있습니다.',
  failed: (message: string) => `생성하지 못했습니다 · ${message}`,
  edit: '수정 후 다시 생성',
  retried: '다시 제출됨',
};

export const koImageGen: ImageGenMessages = {
  title: '이미지',
  segments: '이미지 출처',
  project: '영상 소재',
  gen: 'AI 생성',
  noModelTitle: '아직 이미지 모델이 없습니다',
  noModelBody:
    '클라우드 공급자를 연결하거나(모델 › 이미지 생성 › 클라우드 모델) Qwen-Image-2.1을 다운로드하세요(모델 › 이미지 생성 › 로컬 모델). 둘 중 하나면 됩니다.',
  connect: '클라우드 공급자 연결',
  downloadLocal: '로컬 모델 다운로드',
  fit: '영상 캔버스와 동일',
  recent: '최근',
  all: (n: number) => `전체 묶음 ${n}개`,
  fewer: '최근 묶음 3개만',
  empty:
    '이 영상에서 아직 생성한 이미지가 없습니다. 생성한 이미지는 바로 소재 라이브러리에 들어가며(“생성됨” 표시), 캔버스에 배치하는 것은 별도 단계입니다.',
  place: '캔버스에 배치',
  placeTip: '재생 헤드 위치에 배치',
  inLibrary: '소재 라이브러리에 있음',
  importing: '소재 라이브러리에 추가하는 중…',
  useAsRef: '참고 이미지로 사용',
  foot: '생성한 이미지는 바로 이 영상의 소재 라이브러리에 들어가며, 출처(모델, 파라미터, 작업)가 소재와 함께 기록됩니다. 프롬프트는 작업 기록에만 남습니다. 캔버스에 배치하는 것은 별도 단계입니다.',
  readOnly: '지금은 이 영상이 읽기 전용이라 소재를 생성해 넣을 수 없습니다',
  charCount: (chars: number, max: number) => `${chars} / ${max}자`,
  charCountPlain: (chars: number) => `${chars}자`,
};
