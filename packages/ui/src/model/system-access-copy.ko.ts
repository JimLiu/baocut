import type { SystemAccessMessages } from './system-access-copy.ts';

export const ko: SystemAccessMessages = {
  cardTitle: (names) => `BaoCut이 ${names} 쿠키를 읽도록 허용`,
  cardBody: "macOS에서 먼저 BaoCut에 “전체 디스크 접근 권한”을 허용해야 합니다. “시스템 설정 열기”를 누르면 BaoCut이 해당 페이지로 바로 이동합니다. BaoCut은 선택한 브라우저만 읽고 다른 파일은 읽지 않습니다.",
  openedTitle: "시스템 설정에서 BaoCut을 켠 다음 여기로 돌아오세요",
  openedBody: "BaoCut 옆의 스위치를 켭니다. macOS가 BaoCut을 종료하고 다시 열지 물으면 “종료 및 다시 열기”를 선택하세요. 목록에 BaoCut이 없으면 목록 아래의 “+”로 추가하세요. 다시 열기 안내가 나오지 않으면 아래의 “BaoCut 다시 시작”을 누르세요.",
  open: "시스템 설정 열기",
  openAgain: "시스템 설정 다시 열기",
  restart: "BaoCut 다시 시작",
  askTitle: (names) => `먼저 ${names} 쿠키 접근을 허용할까요?`,
  askBody: (names) => `이번 다운로드는 ${names} 로그인 상태를 사용하며, macOS에서 먼저 BaoCut에 “전체 디스크 접근 권한”을 허용해야 합니다. 시스템 설정에서 켠 뒤 다시 다운로드하거나, 이번에는 건너뛰고 다른 브라우저로 계속하세요.`,
  skip: "이번에는 건너뛰기",
  settingLabel: "전체 디스크 접근 권한",
  settingAllowed: "허용됨. BaoCut은 외장 드라이브, 데스크탑, 문서, 다운로드의 파일과 Safari 쿠키를 읽을 수 있지만, 선택한 미디어, 저장 위치, 체크한 브라우저만 읽습니다.",
  settingMissing: "허용되지 않음. macOS는 기본적으로 앱이 외장 드라이브, 데스크탑, 문서, 다운로드의 파일과 Safari 쿠키를 읽지 못하게 합니다. 허용하면 이 위치에서 권한 때문에 실패하지 않습니다. 선택한 미디어, 저장 위치, 체크한 브라우저만 읽습니다.",
  openFailed: "시스템 설정을 열지 못했습니다. “시스템 설정 › 개인정보 보호 및 보안 › 전체 디스크 접근 권한”을 직접 여세요.",
};
