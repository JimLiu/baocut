import type { JobsYtDlpMessages } from './yt-dlp.ts';

export const zhHans: JobsYtDlpMessages = {
  toolNotFound: (p: { code: string }) => `找不到可以执行的 yt-dlp（${p.code}）`,
  remedyUnsupported: '下载工具不支持这个链接：换成视频页面本身的链接（不是播放列表、直播或搜索页）',
  remedyLoginRequired: '先在浏览器中登录目标网站，再在「网站登录」里勾选该浏览器后重新下载',
  remedyCookiesUnavailable: '读取不到浏览器 Cookie：确认浏览器已登录；数据库被占用时完全退出浏览器（包括在后台运行的），系统密钥权限被拒时允许访问，Safari 要允许完全磁盘访问；Windows 上 Chrome、Edge、Brave 用应用绑定加密保护 Cookie 时 yt-dlp 读不到，改用 Firefox；或换一个浏览器',
  remedyToolUpdateRequired: '网站解析失败或工具版本过旧：更新 yt-dlp 后重新检测并重试',
  remedyUnavailable: '视频不可用（已删除、地区限制，或没有可下载的格式）',
  remedyNetworkError: '网络连不上或下载中断：检查网络后重试（已经下载的部分会续传）',
  remedyDiskFull: '下载目录或 Runtime Home 所在的磁盘空间不足：清理出空间后重试',
  remedyDownloadFailed: '下载工具报错：看 details.stderr；可能需要更新 yt-dlp（baocut external-tools detect）',
  exited: (p: { code: number | null }) => `yt-dlp 以 ${p.code} 退出`,
  cookieLoginRequired: (p: { browser: string }) => `${p.browser}：网站仍要求登录`,
  cookieUnreadable: (p: { browser: string }) => `${p.browser}：读不到 Cookie`,
  reasonSeparator: '；',
  cookieAttemptsFailed: (p: { count: number; reasons: string }) => `试了 ${p.count} 个浏览器的 Cookie 都没成功（${p.reasons}）`,
  metadataUnreadable: '读不出下载工具给的元数据',
  metadataNotObject: '下载工具给的元数据不是对象',
  playlist: '链接是一个播放列表，一次只导入一个视频',
  live: '不能导入直播',
};
