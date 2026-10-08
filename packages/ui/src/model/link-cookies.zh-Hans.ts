import type { LinkCookiesMessages } from './link-cookies.ts';

export const zhHans: LinkCookiesMessages = {
  noneChecked: '都不勾就匿名下载。网站要求登录或验证时，先在浏览器里登录这个网站，再勾选那个浏览器。',
  oneChecked: (name: string) => `用 ${name} 的 Cookie 访问目标网站。`,
  manyChecked: (names: readonly string[]) =>
    `按 ${names.join(' → ')} 的顺序逐个试：读不到某个浏览器的 Cookie、或网站仍要求登录时换下一个，用上一个就停，结果里写明用的是哪个。`,
  privacy: '只读取你勾选的浏览器。Cookie 由 yt-dlp 在本机读取，只用于访问目标网站；BaoCut 只记下浏览器名称，不保存 Cookie 内容。',
  keychain: (names: readonly string[]) => `macOS 会为 ${names.join('、')}${names.length > 1 ? ' 各' : ' '}弹出一次钥匙串授权，选「始终允许」以后就不再问。`,
  safariAccess: '读取 Safari 的 Cookie 要先在「系统设置 › 隐私与安全性 › 完全磁盘访问权限」里允许 BaoCut。',
  chromiumLocked: (names: readonly string[]) =>
    `${names.join('、')} 开着时 Cookie 库被占用、读不到，下载前先完全退出${names.length > 1 ? '这些' : '这个'}浏览器，包括在后台运行的。`,
  appBound: (names: readonly string[]) => `${names.join('、')} 在 Windows 上通常用应用绑定加密保护 Cookie，yt-dlp 目前可能读不到，退出浏览器也不行。`,
  firefoxTip: '需要登录时，建议在 Firefox 里登录目标网站后改勾 Firefox。',
  noBrowsers: '这台电脑上没有找到浏览器的 Cookie，只能匿名下载。在浏览器里登录过目标网站后，点「重新检测浏览器」。',
  used: (name: string) => `用了 ${name} 的 Cookie`,
};
