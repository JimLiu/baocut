import type { GeneralSettingsMessages } from './general-settings-copy.ts';

export const zhHans: GeneralSettingsMessages = {
  interfaceGroup: '界面',
  language: '界面语言',
  languageDesc: '改完立即生效，不用重启。',
  languageSystem: (current: string) => `跟随系统（${current}）`,
  appearance: '外观',
  appearanceDesc: '只影响这台电脑上的 BaoCut 窗口。',
  schemeSystem: '跟随系统',
  schemeLight: '浅色',
  schemeDark: '深色',

  saveFailed: (message: string) => `没能保存：${message}`,

  editingGroup: '编辑与转录',
  autoOpen: '转录完成后自动打开视频',
  autoOpenDesc: '用于本地导入；链接导入在后台完成时只通知，保留你当前的页面。',
  autoOpenNote: '还没接上：现在转录完成后都留在你当前的页面，不会自动打开视频。',
  lineLength: '字幕行长',
  lineLengthDesc: '影响自动断行的目标长度，不影响已经手工改过的行。',
  lineLengthNote: (maxChars: number, custom: string | null) =>
    `还没接上：自动断行现在固定按每行 ${maxChars} 个半角字符宽（一个中日韩文字算两个）。${custom ? `存着的是自定义值（${custom}）。` : ''}`,
  cueShading: '文稿里的 cue 底纹',
  cueShadingDesc: '给每条字幕的范围铺一层浅底，看得出断在哪。',
  cueShadingNote: '还没做：文稿还不会给字幕范围铺底纹。',

  downloadsGroup: '下载与更新',
  autoUpdateOn: '已开启自动检查并下载更新',
  autoUpdateOff: '已关闭自动下载更新',
  downloader: '视频下载工具',
  downloaderWeb: '浏览器里不检测这台电脑上的下载工具：请在 BaoCut 桌面应用里查看。',
  checking: '正在检测…',
  checkFailed: (message: string) => `没能检测：${message}`,
  checkAgain: '重新检测',

  sourcesGroup: '下载来源与离线',
  modelsEndpoint: '模型下载来源',
  modelsEndpointDesc: '本地模型从这里下载。留空用公共模型仓库（Hugging Face）；连不上时可以填镜像的基址。环境变量 BAOCUT_MODELS_ENDPOINT 优先于这里。',
  toolsEndpoint: '工具下载来源',
  toolsEndpointDesc: 'yt-dlp 这类外部工具从这里下载，文件在「基址/工具/版本/文件名」。留空用工具的官方发布地址。环境变量 BAOCUT_TOOLS_ENDPOINT 优先于这里。',
  toolsEndpointPlaceholder: '官方发布地址',
  strictOffline: '严格离线',
  strictOfflineDesc: '开着时不下载模型与外部工具，也不从链接下载视频。云端模型与 Agent 引擎是否联网不受它影响。',
  strictOfflineOn: '已开启严格离线',
  strictOfflineOff: '已关闭严格离线',
  endpointChanged: (endpoint: string) => `已改用 ${endpoint}`,
  endpointReset: (label: string) => `${label}已恢复默认`,
  save: '保存',
  resetDefault: '恢复默认',

  trashDays: '回收站保留天数',
  trashDaysDesc: (fallback: number | null) =>
    `移进回收站超过这么多天、没有被引用的条目与删除的视频会被永久删除（启动时与之后每 6 小时检查一次）；还被引用的留着。清空恢复默认${fallback ? ` ${fallback} 天` : ''}。`,
};
