import type { SystemAccessMessages } from './system-access-copy.ts';

export const zhHans: SystemAccessMessages = {
  cardTitle: (names) => `允许 BaoCut 读取 ${names} 的 Cookie`,
  cardBody: "macOS 要求先给 BaoCut「完全磁盘访问权限」。点「打开系统设置」，BaoCut 会直接带你到这一页，不用自己去找。BaoCut 只读取你勾选的浏览器，不读别的文件。",
  openedTitle: "在系统设置里启用 BaoCut，再回到这里",
  openedBody: "启用 BaoCut 旁边的开关；系统问是否退出并重新打开时选「退出并重新打开」。列表里没有 BaoCut 时，点列表下方的「+」把它添加进去。系统没有提示重新打开时，点下面的「重新启动 BaoCut」。",
  open: "打开系统设置",
  openAgain: "再次打开系统设置",
  restart: "重新启动 BaoCut",
  askTitle: (names) => `先允许读取 ${names} 的 Cookie？`,
  askBody: (names) => `这次下载会用到 ${names} 的登录状态，macOS 要先给 BaoCut「完全磁盘访问权限」。打开系统设置启用后，回来再下载；也可以这次先跳过，用其他浏览器的登录状态继续。`,
  skip: "这次跳过",
  settingLabel: "完全磁盘访问权限",
  settingAllowed: "已允许。BaoCut 可以读取外置硬盘、桌面、文稿、下载里的文件与 Safari 的 Cookie，但只读你选的素材、保存位置与勾选的浏览器。",
  settingMissing: "未允许。macOS 默认不让应用读取外置硬盘、桌面、文稿、下载里的文件与 Safari 的 Cookie。允许后，BaoCut 读这些位置时不会再因权限失败；只读你选的素材、保存位置与勾选的浏览器。",
  openFailed: "没能打开系统设置。请自己打开「系统设置 › 隐私与安全性 › 完全磁盘访问权限」。",
};
