import type { LinkCookiesMessages } from './link-cookies.ts';

export const ko: LinkCookiesMessages = {
  noneChecked: '모두 체크하지 않으면 익명으로 다운로드합니다. 사이트에서 로그인이나 인증을 요구하면 먼저 브라우저에서 그 사이트에 로그인한 뒤 해당 브라우저를 체크하세요.',
  oneChecked: (name: string) => `${name} 쿠키를 사용해 사이트에 접속합니다.`,
  manyChecked: (names: readonly string[]) =>
    `${names.join(' → ')} 순서로 시도합니다. 브라우저의 쿠키를 읽을 수 없거나 사이트가 여전히 로그인을 요구하면 다음 브라우저로 넘어가며, 처음으로 성공한 브라우저에서 멈춥니다. 결과에 어떤 브라우저를 사용했는지 표시됩니다.`,
  privacy: '체크한 브라우저만 읽습니다. yt-dlp가 이 컴퓨터의 쿠키를 읽어 사이트 접속에만 사용하며, BaoCut은 브라우저 이름만 기억하고 쿠키는 저장하지 않습니다.',
  keychain: (names: readonly string[]) =>
    `macOS가 ${names.length > 1 ? `${names.join(', ')} 각각에 대해` : `${names[0]}에 대해`} 키체인 접근을 한 번 요청합니다. “항상 허용”을 선택하면 다시 묻지 않습니다.`,
  safariAccess: 'Safari 쿠키를 읽으려면 먼저 시스템 설정 › 개인정보 보호 및 보안 › 전체 디스크 접근 권한에서 BaoCut을 허용하세요.',
  chromiumLocked: (names: readonly string[]) =>
    `${names.join(', ')} 브라우저가 열려 있는 동안에는 쿠키 데이터베이스가 잠겨 읽을 수 없습니다. 다운로드하기 전에 백그라운드에서 실행 중인 것까지 포함해 ${names.length > 1 ? '이 브라우저들을' : '이 브라우저를'} 완전히 종료하세요.`,
  appBound: (names: readonly string[]) =>
    `Windows에서는 ${names.join(', ')} 브라우저가 보통 앱 바인딩 암호화로 쿠키를 보호하므로, 브라우저를 종료해도 yt-dlp가 읽지 못할 수 있습니다.`,
  firefoxTip: ' 로그인이 필요하면 Firefox에서 사이트에 로그인한 뒤 대신 Firefox를 체크하세요.',
  noBrowsers: '이 컴퓨터에서 브라우저 쿠키를 찾지 못해 익명으로만 다운로드할 수 있습니다. 브라우저에서 사이트에 로그인한 뒤 “브라우저 다시 감지”를 클릭하세요.',
  used: (name: string) => `${name} 쿠키 사용함`,
};
