import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const ko: RuntimeStorageCredentialsMessages = {
  denied: '액세스가 거부되었습니다',
  unavailable: '자격 증명 저장소를 사용할 수 없습니다',
  unsupported: '이 플랫폼은 시스템 보안 저장소를 지원하지 않습니다',
  internal: '자격 증명을 읽거나 쓰는 중 오류가 발생했습니다',
  problem: (p) => `${p.reason}: ${p.message}`,
  fileWriteFailed: (p) => `자격 증명 파일을 쓰지 못했습니다(${p.code})`,
  fileUnreadable: (p) => `자격 증명 파일을 읽을 수 없어 그대로 두었습니다(${p.code})`,
  helperBadResponse: '자격 증명 도우미가 잘못된 응답을 반환했습니다',
  helperNotFound: '자격 증명 도우미 프로그램을 찾지 못했습니다',
  helperTimedOut: (p) => `자격 증명 도우미가 ${p.seconds}초 안에 응답하지 않았습니다`,
  helperMissing: '자격 증명 도우미 프로그램이 없습니다',
  helperStartFailed: (p) => `자격 증명 도우미를 시작하지 못했습니다(${p.code})`,
  helperResponseTooLong: '자격 증명 도우미의 응답이 너무 깁니다',
  helperExitedSilently: '자격 증명 도우미가 응답 없이 종료되었습니다',
  helperReportedError: '자격 증명 도우미가 오류를 보고했습니다',
  redacted: '[가려짐]',
};
