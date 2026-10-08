import type { DriversCommonMessages } from './drivers-common.ts';

export const ko: DriversCommonMessages = {
  executableMissing: (p) => `지정한 ${p.command} 실행 파일(${p.path})이 없거나 실행할 수 없습니다.`,
  commandMissing: (p) => `${p.command} 명령을 찾지 못했습니다. ${p.hint}. 또는 설정에서 위치를 지정하세요.`,
  commandNotFound: (p) => `${p.command} 명령을 찾지 못했습니다`,
  installItFirst: '먼저 설치하세요',
  versionFailed: (p) => `${p.command} --version 명령이 정상적으로 종료되지 않았습니다.`,
  outdated: (p) => `${p.name} ${p.version} 버전은 너무 오래되었습니다. BaoCut에는 ${p.min} 이상 버전이 필요합니다.`,
  startFailed: (p) => `${p.name} 시작에 실패했습니다: ${p.error}`,
  openSessionFailed: (p) => `${p.name} 세션을 열지 못했습니다: ${p.error}`,
  confinedUnsupported: (p) => `${p.name}은(는) 제한된 일회성 호출을 지원하지 않습니다`,
  resumeFailed: (p) =>
    `${p.name} 네이티브 세션을 재개하지 못했습니다${p.error ? `(${p.error})` : ''}. 새 세션을 시작했으므로 Agent는 이전 대화를 볼 수 없습니다.`,
  sessionClosed: (p) => `${p.name} 세션이 닫혔습니다`,
  sessionNotReady: (p) => `${p.name} 세션이 아직 준비되지 않았습니다`,
  turnInProgress: '이전 턴이 아직 끝나지 않았습니다',
  modelSwitchFailed: (p) => `${p.name}이(가) ${p.model} 모델로 전환하지 못했습니다: ${p.error}`,
  timedOut: (p) => `${p.label} 시간 초과(${p.seconds}초)`,
  unknownError: '알 수 없는 오류',
  unknownReason: '알 수 없는 이유',
  imagePlaceholder: '[이미지]',
  officialScript: '공식 스크립트',
};
