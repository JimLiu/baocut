import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

const outputWrong: Record<CheckSubject, string> = {
  transcribe: '모델은 실행되지만 샘플의 말소리를 인식하지 못합니다',
  synthesize: '모델은 실행되지만 만들어 낸 목소리가 올바르지 않습니다',
  image: '모델은 실행되지만 그려 낸 이미지가 올바르지 않습니다',
  separate: '모델은 실행되지만 사람 목소리와 배경음을 분리하지 못했습니다',
};

const checkSentences: Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence> = {
  APP_FILE_MISSING: () => ({
    text: 'BaoCut에 포함된 파일이 없습니다. 모델의 문제는 아닙니다',
    todo: 'BaoCut을 다시 설치하면 해결됩니다. 이미 다운로드한 모델에는 영향이 없습니다.',
  }),
  MODEL_FILES_DAMAGED: () => ({ text: '모델 파일이 손상되었습니다', todo: '복구하면 손상된 파일을 다시 다운로드합니다.' }),
  MODEL_OUTPUT_WRONG: (subject) => ({
    text: outputWrong[subject],
    todo: '먼저 복구하세요. 복구한 뒤에도 같은 문제가 생기면 기술 세부 정보를 복사해 저희에게 보내 주세요.',
  }),
  MODEL_OUT_OF_MEMORY: () => ({
    text: '메모리가 부족해 모델을 불러오지 못했습니다',
    todo: '다른 큰 모델이나 메모리를 많이 쓰는 앱을 닫은 뒤 다시 검사하세요.',
  }),
  MODEL_WORKER_FAILED: () => ({
    text: '모델을 실행하는 백그라운드 프로세스에서 오류가 발생했습니다',
    todo: '다시 검사하세요. 계속 발생하면 BaoCut을 다시 시작하거나 기술 세부 정보를 복사해 저희에게 보내 주세요.',
  }),
};

function trySubject(verb: string, noun: string, noMemoryTodo: string): TrySubject {
  return {
    noMemory: { text: `메모리가 부족해 ${verb}을 마치지 못했습니다`, todo: noMemoryTodo },
    modelError: { text: `모델에서 오류가 발생해 ${verb} 결과가 없습니다`, todo: '모델을 검사해 무엇이 문제인지 확인하세요.' },
    other: (message) => ({
      text: `${verb}에 실패했습니다: ${message}`,
      todo: '다시 시도할 수 있습니다. 계속 발생하면 백그라운드 작업에서 세부 정보를 확인하세요.',
    }),
    notStarted: (message) => ({ text: `${verb}을 시작하지 못했습니다: ${message}`, todo: '' }),
    noticeTodo: (todo) => `${todo} 지금 ${noun}도 실패할 가능성이 높습니다.`,
  };
}

export const ko: ModelCheckMessages = {
  label: {
    check: '검사',
    checkFull: '모델 검사',
    recheck: '다시 검사',
    repair: '복구…',
    repairSub: '손상된 파일만 다시 다운로드합니다',
    details: '기술 세부 정보',
    hideDetails: '기술 세부 정보 숨기기',
    copy: '기술 세부 정보 복사',
    copied: '기술 세부 정보를 복사했습니다',
    copyFailed: '복사하지 못했습니다. 위의 텍스트를 선택해 직접 복사하세요.',
    cancel: '취소',
    retry: '다시 시도',
    pickRef: '다른 녹음 선택…',
    useSample: '샘플 녹음 사용',
  },
  caption: '검사는 모델이 제대로 작동하는지 확인하고, 복구는 손상된 파일만 다시 다운로드합니다. 모델을 삭제할 때 다른 모델이 아직 사용하는 공용 구성 요소는 남겨 둡니다.',
  head: {
    running: '검사 중…',
    repairing: '복구 중…',
    failed: '검사 실패:',
    notStarted: '검사를 시작하지 못했습니다:',
  },
  sentence: (text) => `${text}.`,
  phase: {
    queued: '대기 중',
    loading: '모델 불러오는 중',
    running: '짧은 샘플 실행 중',
    verifying: '결과 확인 중',
    repairing: '손상된 파일을 다시 다운로드하는 중 · 고쳐지면 자동으로 다시 검사합니다',
  },
  checkSentences,
  unknown: {
    text: '모델이 제대로 작동하지 않았습니다',
    todo: '다시 검사하세요. 계속 발생하면 기술 세부 정보를 복사해 저희에게 보내 주세요.',
  },
  notStarted: {
    RUNTIME_UNREACHABLE: { text: 'BaoCut 백그라운드 서비스가 응답하지 않습니다', todo: '잠시 후 다시 검사하세요. 계속 발생하면 BaoCut을 다시 시작하세요.' },
    MODEL_IN_USE: {
      text: '다른 작업이 이 모델을 사용하고 있습니다',
      todo: '그 작업이 끝날 때까지 기다리거나 백그라운드 작업에서 취소한 뒤 다시 검사하세요.',
    },
    MODEL_UNAVAILABLE: { text: '지금은 이 모델을 사용할 수 없습니다', todo: '먼저 복구하거나 다시 켠 뒤 검사하세요.' },
    RESOURCE_ADMISSION_UNSATISFIABLE: { text: '이 컴퓨터의 메모리가 이 모델을 실행하기에 부족합니다', todo: '더 작은 모델로 바꾸세요.' },
    WEB_METHOD_NOT_ALLOWED: { text: '브라우저에서는 로컬 모델을 검사할 수 없습니다', todo: '데스크톱 앱에서 검사하세요.' },
    OFFLINE_STRICT: { text: '엄격한 오프라인 모드가 켜져 있습니다', todo: '설정에서 엄격한 오프라인 모드를 끈 뒤 다시 검사하세요.' },
  },
  notStartedUnknown: {
    text: 'BaoCut이 이번 검사를 받아들이지 않았습니다',
    todo: '잠시 후 다시 검사하세요. 계속 발생하면 기술 세부 정보를 복사해 저희에게 보내 주세요.',
  },
  detail: {
    code: (code) => `코드 ${code}`,
    model: (id, when) => `모델 ${id} · ${when}`,
    message: (message) => `메시지 ${message}`,
    passed: (when) => `검사 통과 · ${when}`,
  },
  noticeText: (what) => `이 모델은 마지막 검사를 통과하지 못했습니다: ${what}`,
  refUnreadable: (file) => ({
    text: `“${file}” 녹음을 읽지 못했습니다. 파일이 손상되었거나 오디오 파일이 아닐 수 있습니다`,
    todo: '다른 녹음으로 시도하거나, 먼저 샘플 녹음으로 어떻게 들리는지 확인하세요.',
  }),
  refUnknown: '녹음',
  trySpeech: trySubject('합성', '미리 듣기', '다른 큰 모델이나 메모리를 많이 쓰는 앱을 닫은 뒤 다시 시도하세요.'),
  tryImage: trySubject('이미지 생성', '테스트 이미지 생성', '다른 큰 모델을 닫은 뒤 다시 시도하거나 단계 수를 낮추세요.'),
};
