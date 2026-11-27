import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const ko: DownloaderSettingsMessages = {
  lead: '링크에서 영상을 다운로드할 때는 yt-dlp를 사용합니다. 영상 다운로드 도구, 링크에서 전사, Agent 모두 여기 설정대로 다운로드합니다.',
  toolGroup: '다운로드 도구',
  cookiesLead: '다운로드할 때 브라우저의 로그인 상태를 사용하므로 로그인해야 볼 수 있는 영상도 다운로드할 수 있습니다. 기본적으로 감지된 모든 브라우저를 사용합니다.',
  autoUpdate: "yt-dlp 자동 업데이트",
  autoUpdateDesc:
    "하루에 한 번 새 안정 버전이 있는지 확인합니다. 새 버전이 있으면 체크섬을 확인한 뒤 BaoCut이 다운로드한 사본을 교체하며, 교체가 끝날 때까지는 지금 사본으로 계속 다운로드할 수 있습니다. 직접 설치한 yt-dlp는 바뀌지 않습니다.",
  autoUpdateChecked: (when: string, version: string) => `마지막 확인: ${when} · 최신 버전 ${version}`,
};
