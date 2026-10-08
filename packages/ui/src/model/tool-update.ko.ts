import type { ToolUpdateMessages } from './tool-update.ts';

export const ko: ToolUpdateMessages = {
  standalone: '공식 독립 실행 파일',
  updateInTerminal: '터미널에서 업데이트',
  unknownInstall: '이 yt-dlp가 어떻게 설치되었는지 알 수 없습니다. 설치한 방식에 맞는 명령을 실행한 뒤 “다시 확인”을 클릭하세요.',
  cannotRun: 'BaoCut이 이 명령을 대신 실행할 수 없습니다.',
  thenRecheck: '그런 다음 “다시 확인”을 클릭하세요.',
  runThenRecheck: '터미널에서 이 명령을 실행한 뒤 “다시 확인”을 클릭하세요.',
  updateWith: (method) => `${method}(으)로 업데이트`,
  stoppedTitle: '업데이트 중지됨',
  stoppedBody: '명령이 일부만 실행되었을 수 있습니다. 아래 출력을 확인한 뒤 “다시 확인”을 클릭해 현재 yt-dlp 버전을 확인하세요.',
  failedTitle: (exitCode) => (exitCode === null ? '업데이트를 완료하지 못했습니다' : `업데이트를 완료하지 못했습니다(종료 코드 ${exitCode})`),
  failedBody: (error) =>
    `${error ? `${error.replace(/[。.]$/, '')}. ` : ''}기존 yt-dlp에는 영향이 없습니다. 출력은 아래에 있습니다. 명령을 복사해 터미널에서 실행한 뒤 “다시 확인”을 클릭할 수도 있습니다.`,
  updatedTo: (version) => `${version} 버전으로 업데이트했습니다`,
  upToDate: (version) => (version ? `이미 최신 버전입니다(${version})` : '이미 최신 버전입니다'),
  logTruncated: '…(앞부분 출력 생략. 전체 출력은 작업 기록에 있습니다)\n',
  logStopped: '(중지됨)',
  logExitCode: (exitCode) => `(종료 코드 ${exitCode})`,
};
