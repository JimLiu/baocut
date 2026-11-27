import type { DownloaderSettingsMessages } from './downloader-settings-copy.ts';

export const zhHans: DownloaderSettingsMessages = {
  lead: '从链接下载视频用 yt-dlp。下载视频工具、从链接转录和智能体都按这里的设置下载。',
  toolGroup: '下载工具',
  cookiesLead: '下载时带上你在浏览器里的登录状态，要登录才能看的视频也能下载。默认用所有检测到的浏览器。',
  autoUpdate: "自动更新 yt-dlp",
  autoUpdateDesc:
    "每天检查一次有没有新的稳定版。有新版本时，核对校验和之后替换 BaoCut 下载的那一份，替换完成前照常用现在这一份下载。你自己安装的 yt-dlp 不受影响。",
  autoUpdateChecked: (when: string, version: string) => `上次检查：${when} · 最新版本 ${version}`,
};
