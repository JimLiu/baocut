import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const ko: FontSettingsMessages = {
  lead: (total: number | null) =>
    `글꼴은 세 가지 출처에서 가져옵니다. 앱에 포함된 글꼴, 이 컴퓨터에 설치된 글꼴, 그리고 Google Fonts 디렉터리(${total === null ? '약 2,000' : `약 ${total.toLocaleString(intlLocale())}`}개 패밀리, 오픈 소스 라이선스, 필요할 때 다운로드)입니다. 다운로드할 때는 패밀리 이름과 굵기만 보내며 계정이 필요하지 않습니다. 글꼴은 영상 폴더가 아닌 앱 데이터에 저장됩니다.`,
  download: '다운로드',
  autoDownload: '글꼴 자동 다운로드',
  autoDownloadDesc:
    '미리 보기, 영상 열기, 내보내기에 이 컴퓨터에 없는 글꼴이 필요하면 Google Fonts에서 다운로드합니다. 끄면 우선 대체 글꼴로 표시하고 내보내며, 글꼴을 고를 때는 직접 다운로드할 수 있습니다. 엄격한 오프라인 모드에서는 아무것도 다운로드하지 않습니다.',
  cssEndpoint: '스타일시트 URL',
  cssEndpointDesc: '미러의 기본 URL입니다. 비워 두면 https://fonts.googleapis.com을 사용합니다.',
  fileEndpoint: '글꼴 파일 URL',
  fileEndpointDesc: '글꼴 파일은 이 URL 아래에서만 가져옵니다. 비워 두면 https://fonts.gstatic.com을 사용합니다.',
  downloaded: '다운로드한 글꼴',
  summary: (families: number, size: string) => `패밀리 ${families}개 · ${size}`,
  none: '아직 없음',
  clearAll: '모두 지우기',
  empty: '글꼴을 고를 때 다운로드했거나 영상을 열거나 내보낼 때 자동으로 다운로드한 글꼴이 여기에 표시됩니다.',
  clearTitle: '다운로드한 글꼴을 지울까요?',
  clear: '지우기',
  cancel: '취소',
  removed: (family: string, size: string) => `“${family}” 글꼴을 삭제했습니다 · ${size} 확보됨`,
  inUseTip: '끝나지 않은 내보내기에서 사용 중입니다. 내보내기가 끝난 뒤 삭제하세요',
  removeTip: '이 글꼴의 다운로드한 파일 삭제',
  removeLabel: (tip: string, family: string) => `${tip}: ${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) =>
    `굵기 ${weights} · ${size} · ${licence}${ago ? ` · ${ago} 다운로드` : ''}`,
  inUse: '내보내기에서 사용 중',
};
