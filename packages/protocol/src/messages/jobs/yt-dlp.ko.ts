import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const ko: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `실행할 수 있는 yt-dlp를 찾을 수 없습니다(${p.code})`,
  remedyUnsupported:
    '다운로드 도구가 이 링크를 지원하지 않습니다: 영상 페이지 자체의 링크를 사용하세요(재생목록, 라이브 스트림, 검색 페이지 제외)',
  remedyLoginRequired: '브라우저에서 사이트에 로그인한 뒤 “웹사이트 로그인”에서 그 브라우저를 선택하고 다시 다운로드하세요',
  remedyCookiesUnavailable:
    '브라우저 쿠키를 읽을 수 없습니다: 브라우저에 로그인되어 있는지 확인하세요. 데이터베이스가 사용 중이면 브라우저를 완전히 종료하세요(백그라운드 프로세스 포함). 키체인 접근이 거부되었으면 허용하세요. Safari에는 전체 디스크 접근 권한이 필요합니다. Windows에서는 Chrome, Edge, Brave가 앱 바인딩 암호화로 보호하는 쿠키를 yt-dlp가 읽을 수 없으니 Firefox를 사용하세요. 또는 다른 브라우저를 시도하세요',
  remedyToolUpdateRequired: '사이트 분석에 실패했거나 도구가 오래되었습니다: yt-dlp를 업데이트하고 다시 감지한 뒤 다시 시도하세요',
  remedyUnavailable: '영상을 사용할 수 없습니다(삭제됨, 지역 제한, 또는 다운로드할 수 있는 형식 없음)',
  remedyNetworkError: '연결할 수 없거나 다운로드가 중단되었습니다: 네트워크를 확인하고 다시 시도하세요(다운로드한 부분부터 이어 받음)',
  remedyDiskFull: '다운로드 폴더나 Runtime Home의 디스크 공간이 부족합니다: 공간을 확보한 뒤 다시 시도하세요',
  remedyDownloadFailed:
    '다운로드 도구가 오류를 보고했습니다: details.stderr를 확인하세요. yt-dlp를 업데이트해야 할 수 있습니다(baocut external-tools detect)',
  exited: (p: { code: number | null }) => `yt-dlp 프로세스가 ${p.code} 코드로 종료되었습니다`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}: 사이트에서 여전히 로그인을 요구합니다`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}: 쿠키를 읽을 수 없습니다`,
  reasonSeparator: '; ',
  cookieAttemptsFailed: (p: { count: number; reasons: string }) =>
    `브라우저 ${p.count}개의 쿠키를 시도했지만 모두 실패했습니다(${p.reasons})`,
  metadataUnreadable: '다운로드 도구의 메타데이터를 읽을 수 없습니다',
  metadataNotObject: '다운로드 도구의 메타데이터가 객체가 아닙니다',
  playlist: '링크가 재생목록입니다. 영상을 하나씩 가져오세요',
  live: '라이브 스트림은 가져올 수 없습니다',
};
