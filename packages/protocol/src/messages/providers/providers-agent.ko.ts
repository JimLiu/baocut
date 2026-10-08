import type { ProvidersAgentMessages } from './providers-agent.ts';

export const ko: ProvidersAgentMessages = {
  codexUpgradeHint: 'Codex CLI를 업데이트한 다음(예: npm install -g @openai/codex@latest) 다시 확인하세요',
  codexImageModel: 'Codex 이미지 생성(모델은 Codex와 계정에 따라 결정됨)',
  codexImageNotes:
    '이 컴퓨터에 로그인된 Codex 계정으로 생성합니다. 한 번에 PNG 한 장, 한 번에 작업 하나씩 생성하며 보통 1–2분 걸립니다. ' +
    '크기와 seed는 지정할 수 없고(지정하면 요청이 거부됨) 픽셀 크기는 결과에 따라 달라집니다. 구독 할당량을 사용하며 남은 할당량은 알 수 없습니다. ' +
    '켜면 프롬프트를 Codex 계정으로 보내는 데 동의하는 것입니다.',
  imagesOnly: (p) => `${p.label}은(는) 이미지만 생성할 수 있습니다`,
  onePngOnly: (p) => `${p.label}은(는) 한 번에 PNG 한 장만 생성하며 크기나 seed를 받지 않습니다`,
  unavailable: (p) => `${p.label}을(를) 사용할 수 없습니다: ${p.message}`,
  sessionNotStarted: (p) => `${p.label} 세션이 시작되지 않았습니다: ${p.error}`,
  timedOut: (p) => `${p.label}이(가) ${p.minutes}분 안에 끝나지 않아 중단되었습니다`,
  exited: (p) => `${p.label}이(가) 예기치 않게 종료되었습니다: ${p.message}`,
  notCompleted: (p) => `${p.label}이(가) 이번 생성을 끝내지 못했습니다: ${p.reason}`,
  turnInterrupted: '턴이 중단되었습니다',
  noImage: (p) => `${p.label}이(가) 이미지를 생성하지 않았습니다`,
  noImageReply: (p) => `${p.label}이(가) 이미지를 생성하지 않았습니다: ${p.reply}`,
  unknownError: '알 수 없는 오류',
  processExited: '프로세스가 종료되었습니다',
  turnNotStarted: (p) => `턴이 시작되지 않았습니다: ${p.error}`,
};
