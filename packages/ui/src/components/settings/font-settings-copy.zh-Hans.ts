import { intlLocale } from '@baocut/protocol';
import type { FontSettingsMessages } from './font-settings-copy.ts';

export const zhHans: FontSettingsMessages = {
  lead: (total: number | null) =>
    `可选的字体有三种来源：随应用发布的、这台电脑上装的，以及 Google Fonts 字体目录里的（${total === null ? '约两千' : `约 ${total.toLocaleString(intlLocale())}`} 个族，开源许可，按需下载）。 下载只发送族名与字重，不需要账号；字体存在应用数据里，不进视频目录。`,
  download: '下载',
  autoDownload: '自动下载字体',
  autoDownloadDesc:
    '预览、打开视频与导出用到这台电脑上没有的字体时，从 Google Fonts 下载。关掉后先用回退字体显示与导出，选字体时仍可手动下载。严格离线时不下载。',
  cssEndpoint: '样式表地址',
  cssEndpointDesc: '镜像的基址，留空用 https://fonts.googleapis.com。',
  fileEndpoint: '字体文件地址',
  fileEndpointDesc: '只从这个地址下面取字体文件，留空用 https://fonts.gstatic.com。',
  downloaded: '已下载的字体',
  summary: (families: number, size: string) => `${families} 个族 · ${size}`,
  none: '还没有',
  clearAll: '全部清空',
  empty: '选字体时下载的、打开视频与导出时自动下载的字体都会列在这里。',
  clearTitle: '清空下载的字体？',
  clear: '清空',
  cancel: '取消',
  removed: (family: string, size: string) => `已删除「${family}」· 释放 ${size}`,
  inUseTip: '还没结束的导出在用，导出结束后再删',
  removeTip: '删除这个字体下载的文件',
  removeLabel: (tip: string, family: string) => `${tip}：${family}`,
  facts: (weights: string, size: string, licence: string, ago: string | null) =>
    `字重 ${weights} · ${size} · ${licence}${ago ? ` · ${ago}下载` : ''}`,
  inUse: '导出在用',
};
